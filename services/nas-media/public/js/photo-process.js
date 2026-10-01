/*
 * photo-process.js — nasmgr ⑬"处理待处理照片"(2026-09-30)。
 * 真正干活的是已有的 NAS 端处理程序 photo-worker.js (POST /api/process/nas {path}, 进度 GET /api/process/progress/:id),
 * 它只处理目录下 status='pending' 的照片(生成缩略图/预览图/md5/宽高)。这里负责: 列出还有待处理照片的"套图集合"目录,
 * 并由服务器逐个目录触发、等它跑完再跑下一个(页面关掉也继续)。状态在内存, 待处理状态在数据库, 重启后点"开始"接着做。
 * GET /api/photo-process/dirs | status ; POST /api/photo-process/start | stop
 */
const http = require('http');

module.exports = function (app, getDb) {
  const express = require('express');
  const WHERE = "media_type='photo' AND status='pending' AND path LIKE '/share/%' AND (pending_delete IS NULL OR pending_delete=0)";

  function groups() {
    const rows = getDb().prepare('SELECT path FROM photos WHERE ' + WHERE).all();
    const g = {};
    for (const r of rows) {
      const parts = r.path.slice(0, r.path.lastIndexOf('/')).split('/');   // ['', 'share', 'Person', 'pic', '<套图集合>', ...]
      const key = parts.slice(0, Math.min(parts.length, 5)).join('/');
      g[key] = (g[key] || 0) + 1;
    }
    return Object.keys(g).map((p) => ({ path: p, pending: g[p] })).sort((a, b) => b.pending - a.pending);
  }
  const pendingCount = () => getDb().prepare('SELECT COUNT(*) c FROM photos WHERE ' + WHERE).get().c;

  function call(method, p, body) {
    return new Promise((resolve, reject) => {
      const data = body ? Buffer.from(JSON.stringify(body)) : null;
      const r = http.request({ host: '127.0.0.1', port: 3050, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, (res) => {
        let s = ''; res.on('data', (c) => (s += c)); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
      });
      r.on('error', reject); r.setTimeout(30000, () => r.destroy(new Error('请求超时')));
      if (data) r.write(data); r.end();
    });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  app.get('/api/photo-process/dirs', (req, res) => {
    try { const g = groups(); res.json({ total: g.reduce((a, x) => a + x.pending, 0), groups: g }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  let task = null;
  app.post('/api/photo-process/start', express.json(), (req, res) => {
    if (task && task.state === 'running') return res.status(409).json({ error: '已经在处理中' });
    const g = groups();
    if (!g.length) return res.json({ ok: true, total: 0, note: '没有待处理的照片' });
    const t = task = { state: 'running', startPending: g.reduce((a, x) => a + x.pending, 0), groups: g, idx: 0, current: null, taskId: null, progress: null, startedAt: Date.now(), errors: [], stop: false };
    (async () => {
      for (let i = 0; i < g.length && !t.stop; i++) {
        t.idx = i; t.current = g[i].path; t.progress = null;
        try {
          const r = await call('POST', '/api/process/nas', { path: g[i].path });
          t.taskId = r.taskId;
          for (;;) {
            await sleep(3000);
            if (t.stop) { try { await call('POST', '/api/process/stop/' + t.taskId); } catch (e) {} break; }
            const p = await call('GET', '/api/process/progress/' + t.taskId);
            t.progress = { status: p.status, total: p.totalFiles, done: p.doneFiles, fail: p.failFiles, running: p.running };
            if (p.status !== 'running') break;
          }
        } catch (e) { t.errors.push({ path: g[i].path, error: e.message }); }
      }
      t.state = t.stop ? 'stopped' : 'done'; t.finishedAt = Date.now(); t.current = null;
      console.log('[photo-process] 结束:', t.state);
    })();
    res.json({ ok: true, total: t.startPending, groups: g.length });
  });

  app.post('/api/photo-process/stop', (req, res) => { if (task && task.state === 'running') task.stop = true; res.json({ ok: true }); });

  app.get('/api/photo-process/status', (req, res) => {
    try {
      const pending = pendingCount();
      let rate = 0, eta = null;
      if (task && task.state === 'running') { const doneN = task.startPending - pending; rate = doneN > 0 ? doneN / ((Date.now() - task.startedAt) / 1000) : 0; eta = rate > 0 ? Math.round(pending / rate) : null; }
      res.json({ pending, task, ratePerSec: rate, etaSec: eta });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('[photo-process] 初始化完成');
};
