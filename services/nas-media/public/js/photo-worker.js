/*
 * photo-worker.js — NAS 端图片处理模块(纯JS扩展,挂在 routes.js 旁)
 * 功能:扫描入库 + sharp生成缩略图。作为 PC 端 nas_client 的替代。
 * 统一入口 POST /api/process:PC在线→派PC;PC离线→NAS本地用sharp处理。
 * 接收 (app, getDb),由 routes.js 末尾 require 挂载。
 *
 * 2026-09-20重构: 实测批量处理大目录(/share/Person, 2530个含图目录)时, 扫描+生成
 * 缩略图这部分逻辑直接在主线程(也就是HTTP服务本身)里跑, 期间Node单线程事件循环
 * 被完全占死, 网站所有请求(viewer/videoer/media-admin, 不管跟这次处理相不相关)全部
 * 卡住直到超时。真正干活的逻辑已经搬到 photo-worker-thread.js, 用worker_threads
 * 在独立线程里跑——这个文件现在只是个"派活+收进度"的薄壳, 不再直接碰文件系统/sharp。
 */
const fs   = require('fs');
const path = require('path');
const http = require('http');
const { Worker } = require('worker_threads');

module.exports = function (app, getDb) {
  // ── 进度存储(内存) ──
  // taskId -> { status, queued, running, totalFiles, doneFiles, failFiles, worker }
  // worker字段是Worker实例引用, 只在这个文件内部用于收消息/以后可能的终止, 不会被
  // /api/process/progress接口序列化返回(见下面路由里手动挑字段)。
  const tasks = {};
  function newTaskId() { return 'nas_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }

  function cfg() {
    try { return JSON.parse(fs.readFileSync('/data/config.json','utf8')); }
    catch (e) { return { nas_ip:'192.168.0.3', pipe_port:3030 }; }
  }
  // 查PC是否在线
  function pcOnline() {
    return new Promise((resolve) => {
      const c = cfg();
      const req = http.get(`http://${c.nas_ip}:${c.pipe_port}/api/status`, { timeout: 3000 }, (r) => {
        let d = ''; r.on('data', x => d += x);
        r.on('end', () => { try { const j = JSON.parse(d); resolve(j && j.online && j.ip ? j : null); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }
  // 转发给PC端处理(沿用现有 /process-dir)
  function forwardPc(pcIp, p) {
    return new Promise((resolve) => {
      const body = JSON.stringify({ pcPath: p, path: p });
      const req = http.request({ host: pcIp, port: 8080, path: '/process-dir', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        (r) => { let d=''; r.on('data',x=>d+=x); r.on('end',()=>resolve({ ok:true, by:'pc', raw:d })); });
      req.on('error', (e) => resolve({ ok:false, error: e.message }));
      req.write(body); req.end();
    });
  }

  // 起一个worker线程跑批量任务(jobType: 'process' | 'md5'), 结果/进度通过message回传,
  // 统一落到 tasks[taskId] 上——/api/process/progress/:taskId 接口的返回格式完全不变,
  // 前端(ProgressModal等)不需要改一行代码。
  function runInWorker(jobType, target, taskId) {
    const task = tasks[taskId] || (tasks[taskId] = { status:'running', queued:[], running:[], totalFiles:0, doneFiles:0, failFiles:0 });
    const worker = new Worker(path.join(__dirname, 'photo-worker-thread.js'), {
      workerData: { jobType, target }
    });
    task.worker = worker;
    worker.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      Object.assign(task, msg.task || {});
      if (msg.type === 'done') {
        task.status = 'done';
        console.log('[photo-worker] 完成', JSON.stringify(msg.result));
      } else if (msg.type === 'error') {
        task.status = 'error';
        task.error = msg.message;
        console.error('[photo-worker] 出错', msg.message);
      }
    });
    worker.on('error', (e) => {
      task.status = 'error';
      task.error = e.message;
      console.error('[photo-worker] worker线程异常', e.message);
    });
    worker.on('exit', () => { task.worker = null; });
  }

  // ── 统一入口 ──
  app.post('/api/process', async (req, res) => {
    const p = (req.body && (req.body.path || req.body.pcPath)) || '';
    if (!p) return res.status(400).json({ error: '缺少path' });
    const pc = await pcOnline();
    if (pc) {
      const r = await forwardPc(pc.ip, p);
      return res.json({ routed:'pc', ...r });
    }
    // PC离线 → NAS自己处理(worker线程里跑,异步,立即返回taskId)
    const tid = newTaskId();
    res.json({ routed:'nas', status:'started', taskId: tid });
    runInWorker('process', p, tid);
  });

  // 仅NAS处理(强制,不走PC)
  app.post('/api/process/nas', async (req, res) => {
    const p = (req.body && (req.body.path || req.body.pcPath)) || '';
    if (!p) return res.status(400).json({ error: '缺少path' });
    const tid = newTaskId();
    res.json({ routed:'nas', status:'started', taskId: tid });
    runInWorker('process', p, tid);
  });

  // 进度查询
  app.get('/api/process/progress/:taskId', (req, res) => {
    const t = tasks[req.params.taskId];
    if (!t) return res.json({ status:'unknown', queued:[], running:[], totalFiles:0, doneFiles:0, failFiles:0 });
    res.json({
      status: t.status,
      queued: t.queued || [],
      running: (t.running || []).map(r => ({ dir: r.dir, done: r.done, total: r.total, current: r.current })),
      totalFiles: t.totalFiles || 0,
      doneFiles: t.doneFiles || 0,
      failFiles: t.failFiles || 0,
      error: t.error
    });
  });

  // ── 打MD5(NAS端) ──
  app.post('/api/md5', async (req, res) => {
    const p = (req.body && (req.body.path || req.body.nasPath || req.body.pcPath)) || '';
    if (!p) return res.status(400).json({ error: '缺少path' });
    const tid = newTaskId();
    res.json({ routed:'nas', status:'started', taskId: tid });
    runInWorker('md5', p, tid);
  });

  // 停止指定任务(2026-09-20新增: 用worker_threads之后, 终止一个正在跑的批量任务
  // 变得干净利落——之前这套逻辑跑在主线程里, 没法安全地"半路打断")
  app.post('/api/process/stop/:taskId', (req, res) => {
    const t = tasks[req.params.taskId];
    if (!t) return res.json({ ok:false, error:'任务不存在' });
    if (t.worker) { try { t.worker.terminate(); } catch (e) {} }
    t.status = 'stopped';
    res.json({ ok:true });
  });

  // ── 问题图片管理(预留,暂未实现)──
  app.get('/api/problem-images', (req, res) => {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT id,path,status FROM photos WHERE exif_written=2 LIMIT 500").all();
      res.json({ implemented:false, count: rows.length, items: rows });
    } catch (e) { res.json({ implemented:false, count:0, items:[], error:e.message }); }
  });

  console.log('[photo-worker] 已挂载(worker_threads模式):POST /api/process, /api/process/nas');
};
