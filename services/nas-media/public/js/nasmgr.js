/*
 * nasmgr.js — NAS管理面板: 磁盘使用情况 + 大文件查找 + 目录占用排行
 * 跟backup.js同一个套路: 薄壳+worker线程, 长耗时的扫盘逻辑丢进nasmgr-worker-thread.js
 * 独立线程跑, 这个文件只管派活、收进度, 不直接做耗时的文件系统遍历。
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { execFile } = require('child_process');
const { Worker } = require('worker_threads');

module.exports = function (app, getDb) {
  const tasks = {};
  function newTaskId() { return 'nm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

  function runInWorker(jobType, workerData, taskId) {
    const task = tasks[taskId] || (tasks[taskId] = { type: jobType, status: 'running' });
    const worker = new Worker(path.join(__dirname, 'nasmgr-worker-thread.js'), { workerData });
    task.worker = worker;
    worker.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'progress') Object.assign(task, msg.task || {});
      else if (msg.type === 'done') { task.status = 'done'; task.result = msg.result; }
      else if (msg.type === 'error') { task.status = 'error'; task.error = msg.message; }
    });
    worker.on('error', (e) => { task.status = 'error'; task.error = e.message; });
    worker.on('exit', () => { task.worker = null; });
  }

  function safePath(p) {
    if (!p) return null;
    let real;
    try { real = fs.realpathSync(p); } catch (e) { return null; }
    if (!real.startsWith('/share/')) return null;
    return real;
  }

  // ── 磁盘使用情况: 解析df, 只挑/share下面真正的物理磁盘挂载点(过滤掉容器内部overlay/tmpfs这些噪音) ──
  app.get('/api/nasmgr/disks', (req, res) => {
    execFile('df', ['-B1'], (err, stdout) => {
      if (err) return res.status(500).json({ error: err.message });
      const lines = stdout.split('\n').slice(1);
      const disks = [];
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;
        // df有时候文件系统名太长会自己换行, 下一行才是数字部分, 这里拼回来
        let parts = line.split(/\s+/);
        if (parts.length === 1) {
          i++;
          if (i >= lines.length) break;
          parts = [parts[0]].concat(lines[i].trim().split(/\s+/));
        }
        if (parts.length < 6) continue;
        const [fs_, size, used, avail, pct, mount] = parts;
        // 只要/share下面第一层真实挂载点: /share/CACHEDEV1_DATA 或 /share/external/xxx,
        // 排除更深的路径(那些是容器内部docker/samba的东西, 不是磁盘本身)
        if (!/^\/share\/(CACHEDEV\d+_DATA|external\/[^/]+)$/.test(mount)) continue;
        disks.push({
          mount, fs: fs_,
          size: parseInt(size, 10) || 0,
          used: parseInt(used, 10) || 0,
          avail: parseInt(avail, 10) || 0,
          pct: parseInt(pct, 10) || 0
        });
      }
      res.json(disks);
    });
  });

  // ── 大文件查找 ──
  app.post('/api/nasmgr/bigfiles/start', express.json(), (req, res) => {
    const p = safePath(req.body && req.body.path);
    if (!p) return res.status(400).json({ error: '目录不存在或不在/share下' });
    const minSizeMB = Math.max(0, parseFloat(req.body.minSizeMB) || 100);
    const tid = newTaskId();
    res.json({ ok: true, taskId: tid });
    runInWorker('bigfiles', { jobType: 'bigfiles', path: p, minSize: minSizeMB * 1024 * 1024 }, tid);
  });

  // ── 目录占用排行(只看下一层) ──
  app.post('/api/nasmgr/dirsizes/start', express.json(), (req, res) => {
    const p = safePath(req.body && req.body.path);
    if (!p) return res.status(400).json({ error: '目录不存在或不在/share下' });
    const tid = newTaskId();
    res.json({ ok: true, taskId: tid });
    runInWorker('dirsizes', { jobType: 'dirsizes', path: p }, tid);
  });

  // ── 批量清理(大文件查找/目录占用排行结果表里勾选后"一键处理"用): 挪进回收目录,
  // 不直接删——跟video-migrate.js的套路一致, 留个后悔药。rename是同文件系统内的
  // 元数据操作, 不是真复制, 哪怕批量选了几千个也是瞬间完成, 不用丢worker线程。
  app.post('/api/nasmgr/trash', express.json(), (req, res) => {
    const paths = Array.isArray(req.body && req.body.paths) ? req.body.paths : [];
    if (!paths.length) return res.status(400).json({ error: '没有选中任何项' });
    const results = paths.map((p) => {
      const real = safePath(p);
      if (!real) return { path: p, ok: false, error: '路径不合法' };
      try {
        const trashDir = path.join(path.dirname(real), '.nasmgr_trash');
        fs.mkdirSync(trashDir, { recursive: true });
        let dest = path.join(trashDir, path.basename(real));
        // 回收目录里已经有同名的(比如上次也清理过一个同名文件), 加时间戳避免冲突覆盖
        if (fs.existsSync(dest)) dest = path.join(trashDir, Date.now() + '_' + path.basename(real));
        fs.renameSync(real, dest);
        return { path: p, ok: true, trashPath: dest };
      } catch (e) { return { path: p, ok: false, error: e.message }; }
    });
    const okCount = results.filter(r => r.ok).length;
    res.json({ ok: true, okCount, failCount: results.length - okCount, results });
  });

  // 两种任务共用同一套进度查询/停止接口
  app.get('/api/nasmgr/progress/:taskId', (req, res) => {
    const t = tasks[req.params.taskId];
    if (!t) return res.json({ status: 'unknown' });
    res.json(t);
  });
  app.post('/api/nasmgr/stop/:taskId', (req, res) => {
    const t = tasks[req.params.taskId];
    if (!t) return res.json({ ok: false, error: '任务不存在' });
    if (t.worker) { try { t.worker.terminate(); } catch (e) {} }
    t.status = 'stopped';
    res.json({ ok: true });
  });

  console.log('[nasmgr] 接口挂载完成');
};
