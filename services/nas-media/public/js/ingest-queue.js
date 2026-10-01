/*
 * ingest-queue.js — 照片"入库+处理"队列的接口与工人管理(nasmgr ⑬ 用)。2026-09-30
 * 真正干活的是独立线程 ingest-worker.js; 这里只做: 建表、启动/重启工人、增删队列、查询状态和分页列表(都是轻量、走索引的查询)。
 * 目录树右键"处理"/media-admin 批量处理都只是 POST /api/ingest/add, 进度统一在 nasmgr ⑬ 看。
 *
 * POST /api/ingest/add {paths:[..], retryErrors?}   加目录/文件到队列(扫描入库+处理一条龙); 已处理完的自动跳过
 * POST /api/ingest/add-pending                       把库里已有的"待处理"照片放进队列
 * POST /api/ingest/control {action, speed?}          start | pause | retry-failed | clear-done | reset | speed
 * GET  /api/ingest/status                            计数/进度/速度/预计剩余/扫描任务
 * GET  /api/ingest/items?status=&q=&page=&limit=     分页明细
 * GET  /api/ingest/jobs                              扫描任务列表
 */
const path = require('path');
const { Worker } = require('worker_threads');

module.exports = function (app, getDb) {
  const express = require('express');
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS ingest_state (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS ingest_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      found INTEGER DEFAULT 0, added INTEGER DEFAULT 0, skipped_done INTEGER DEFAULT 0, skipped_err INTEGER DEFAULT 0,
      retry_errors INTEGER DEFAULT 0, error TEXT, created_at INTEGER, finished_at INTEGER);
    CREATE TABLE IF NOT EXISTS ingest_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE, dir TEXT, size INTEGER,
      status TEXT NOT NULL DEFAULT 'queued', error TEXT, note TEXT, attempts INTEGER DEFAULT 0,
      created_at INTEGER, started_at INTEGER, finished_at INTEGER, ms INTEGER);
    CREATE INDEX IF NOT EXISTS idx_iq_status_id ON ingest_queue(status, id);
    CREATE INDEX IF NOT EXISTS idx_iq_finished ON ingest_queue(finished_at);
    CREATE INDEX IF NOT EXISTS idx_ij_status ON ingest_jobs(status);
    CREATE TABLE IF NOT EXISTS ingest_discovery (dir TEXT PRIMARY KEY, disk INTEGER, indb INTEGER, pending INTEGER, scanned_at INTEGER);
    CREATE INDEX IF NOT EXISTS idx_disc_pending ON ingest_discovery(pending);
  `);
  try { db.exec('ALTER TABLE ingest_jobs ADD COLUMN recursive INTEGER DEFAULT 1'); } catch (e) {}   // 2026-10-01: 0=只扫这个目录本身(待入库清单里的"入库"用)

  const getState = (k, d) => { const r = db.prepare('SELECT value FROM ingest_state WHERE key=?').get(k); return r ? r.value : d; };
  const setState = (k, v) => db.prepare('INSERT INTO ingest_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
  const now = () => Math.floor(Date.now() / 1000);

  // ── 工人线程 ──
  let worker = null;
  function ensureWorker() {
    if (worker) return;
    try {
      worker = new Worker(path.join(__dirname, 'ingest-worker.js'));
      worker.on('error', (e) => console.log('[ingest] 工人出错:', e && e.message));
      worker.on('exit', (code) => { worker = null; console.log('[ingest] 工人退出 code=' + code); setTimeout(() => { if (getState('running', '1') === '1' && hasWork()) ensureWorker(); }, 3000); });
      console.log('[ingest] 工人已启动');
    } catch (e) { worker = null; console.log('[ingest] 启动工人失败:', e.message); }
  }
  function hasWork() {
    return !!db.prepare("SELECT 1 FROM ingest_queue WHERE status IN ('queued','running') LIMIT 1").get() ||
           !!db.prepare("SELECT 1 FROM ingest_jobs WHERE status IN ('queued','scanning') LIMIT 1").get();
  }
  // 启动时: 上次被打断的"处理中"放回排队; 如果有活且没被用户暂停, 自动继续
  db.prepare("UPDATE ingest_queue SET status='queued' WHERE status='running'").run();
  db.prepare("UPDATE ingest_jobs SET status='queued' WHERE status='scanning'").run();
  ensureWorker();   // 工人常驻(没活/暂停时只是每秒醒一次), 这样"添加"后立刻开始

  // ── 添加 ──
  const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  app.post('/api/ingest/add', express.json({ limit: '2mb' }), (req, res) => {
    try {
      const paths = ((req.body && req.body.paths) || []).map(normPath).filter(Boolean);
      if (!paths.length) return res.status(400).json({ error: '没有目录' });
      const bad = paths.filter((p) => !p.startsWith('/share/'));
      const okPaths = paths.filter((p) => p.startsWith('/share/'));
      const recursive = !(req.body && req.body.recursive === false);
      // 递归模式: 去掉被其它路径包含的子目录; 非递归(只入库这一个目录本身)不去重
      const top = recursive ? okPaths.filter((p) => !okPaths.some((q) => q !== p && p.startsWith(q + '/'))) : okPaths;
      const retry = req.body && req.body.retryErrors ? 1 : 0;
      let added = 0, dup = 0;
      for (const p of top) {
        const ex = db.prepare("SELECT id FROM ingest_jobs WHERE path=? AND status IN ('queued','scanning')").get(p);
        if (ex) { dup++; continue; }
        db.prepare('INSERT INTO ingest_jobs (path, retry_errors, recursive, created_at) VALUES (?,?,?,?)').run(p, retry, recursive ? 1 : 0, now()); added++;
      }
      ensureWorker();
      res.json({ ok: true, added, duplicated: dup, rejected: bad, running: getState('running', '1') === '1' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/ingest/add-pending', (req, res) => {
    try {
      const r = db.prepare(`INSERT INTO ingest_queue (path, dir, size, status, created_at)
        SELECT path, dir, size, 'queued', ? FROM photos WHERE media_type='photo' AND status='pending' AND path LIKE '/share/%' AND (pending_delete IS NULL OR pending_delete=0)
        ON CONFLICT(path) DO UPDATE SET status='queued', error=NULL, note=NULL, started_at=NULL, finished_at=NULL, ms=NULL WHERE ingest_queue.status IN ('done','error','skipped')`).run(now());
      ensureWorker();
      res.json({ ok: true, queued: r.changes });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 控制 ──
  app.post('/api/ingest/control', express.json(), (req, res) => {
    try {
      const a = String((req.body && req.body.action) || '');
      let extra = {};
      if (a === 'start') { setState('running', 1); ensureWorker(); }
      else if (a === 'pause') { setState('running', 0); }
      else if (a === 'speed') { const s = String(req.body.speed || ''); if (!['slow', 'stable', 'fast'].includes(s)) return res.status(400).json({ error: 'speed 只能是 slow/stable/fast' }); setState('speed', s); }
      else if (a === 'retry-failed') {
        const r = db.prepare("UPDATE ingest_queue SET status='queued', error=NULL, note=NULL, started_at=NULL, finished_at=NULL, ms=NULL WHERE status='error'").run();
        db.prepare("UPDATE photos SET status='pending' WHERE status='error' AND path IN (SELECT path FROM ingest_queue WHERE status='queued')").run();
        extra.requeued = r.changes; ensureWorker();
      }
      else if (a === 'clear-done') { extra.removed = db.prepare("DELETE FROM ingest_queue WHERE status IN ('done','skipped')").run().changes; db.prepare("DELETE FROM ingest_jobs WHERE status IN ('done','error')").run(); }
      else if (a === 'reset') {
        // 重置: 暂停, 清空"排队/失败/跳过"和扫描任务; 不动已入库的照片, 不动"完成"记录
        setState('running', 0);
        extra.removed = db.prepare("DELETE FROM ingest_queue WHERE status IN ('queued','error','skipped','running')").run().changes;
        db.prepare("DELETE FROM ingest_jobs WHERE status IN ('queued','scanning','error')").run();
      }
      else return res.status(400).json({ error: '未知操作' });
      res.json(Object.assign({ ok: true, running: getState('running', '1') === '1', speed: getState('speed', 'stable') }, extra));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 状态 ──
  app.get('/api/ingest/status', (req, res) => {
    try {
      const counts = { queued: 0, running: 0, done: 0, error: 0, skipped: 0 };
      for (const r of db.prepare('SELECT status, COUNT(*) n FROM ingest_queue GROUP BY status').all()) counts[r.status] = r.n;
      const total = counts.queued + counts.running + counts.done + counts.error + counts.skipped;
      const t = now();
      const recent = db.prepare("SELECT COUNT(*) n FROM ingest_queue WHERE status='done' AND finished_at > ?").get(t - 120).n;
      const ratePerMin = recent / 2;
      const left = counts.queued + counts.running;
      const etaSec = ratePerMin > 0 && left > 0 ? Math.round(left / (ratePerMin / 60)) : null;
      const jobs = db.prepare("SELECT id, path, status, found, added, skipped_done, skipped_err, error FROM ingest_jobs WHERE status IN ('queued','scanning') ORDER BY id LIMIT 20").all();
      const current = db.prepare("SELECT path, size, started_at FROM ingest_queue WHERE status='running' ORDER BY id LIMIT 10").all();
      const hb = parseInt(getState('heartbeat', '0'), 10) || 0;
      res.json({ running: getState('running', '1') === '1', speed: getState('speed', 'stable'), workerAlive: !!worker && t - hb < 15,
                 serverNow: t, counts, total, ratePerMin: Math.round(ratePerMin * 10) / 10, etaSec, jobs, current });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 分页明细 ──
  app.get('/api/ingest/items', (req, res) => {
    try {
      const ALL = ['queued', 'running', 'done', 'error', 'skipped'];
      const sts = String(req.query.status || '').split(',').map((x) => x.trim()).filter((x) => ALL.includes(x));   // 多选: 如 queued,running,error(=隐藏已完成)
      const q = String(req.query.q || '').trim();
      const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
      const where = []; const args = [];
      if (sts.length && sts.length < ALL.length) { where.push('status IN (' + sts.map(() => '?').join(',') + ')'); args.push(...sts); }
      if (q) { where.push('path LIKE ?'); args.push('%' + q + '%'); }
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const total = db.prepare('SELECT COUNT(*) c FROM ingest_queue ' + w).get(...args).c;
      const rows = db.prepare('SELECT id, path, status, error, note, ms, attempts, created_at, started_at, finished_at FROM ingest_queue ' + w + ' ORDER BY CASE status WHEN \'running\' THEN 0 WHEN \'queued\' THEN 1 WHEN \'error\' THEN 2 ELSE 3 END, CASE WHEN status = \'queued\' THEN id ELSE -id END LIMIT ? OFFSET ?').all(...args, limit, (page - 1) * limit);
      res.json({ items: rows, total, page, limit });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/ingest/jobs', (req, res) => {
    try { res.json({ jobs: db.prepare('SELECT * FROM ingest_jobs ORDER BY id DESC LIMIT 50').all() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 待入库目录扫描(磁盘有图片、库里没有/更少的目录) ──
  try { db.prepare("INSERT INTO ingest_state(key,value) VALUES('disc_running','0') ON CONFLICT(key) DO UPDATE SET value='0'").run(); } catch (e) {}
  let discWorker = null;
  app.post('/api/ingest/discover', express.json(), (req, res) => {
    try {
      if (discWorker) return res.status(409).json({ error: '正在扫描中' });
      let roots = ((req.body && req.body.roots) || []).map(normPath).filter((p) => p.startsWith('/share/'));
      if (!roots.length) {
        // 默认范围: 已启用的 NAS 浏览根目录, 去掉缩略图/系统用的盘(external、ssd001), 并去掉被其它根包含的重叠根(如 /share/BAK/Gcloud 已在 /share/BAK 里)
        try { roots = db.prepare("SELECT path FROM browser_roots WHERE enabled=1 AND source='nas'").all().map((r) => normPath(r.path)).filter((p) => p.startsWith('/share/')); } catch (e) {}
        roots = roots.filter((p) => !/^\/share\/(external|ssd001)(\/|$)/.test(p));
        roots = roots.filter((p) => !roots.some((q) => q !== p && p.startsWith(q + '/')));
      }
      if (!roots.length) roots = ['/share/Person'];
      discWorker = new Worker(path.join(__dirname, 'ingest-discover.js'), { workerData: { roots } });
      discWorker.on('error', (e) => { console.log('[ingest] 待入库扫描出错:', e && e.message); setState('disc_error', String(e && e.message).slice(0, 200)); });
      discWorker.on('exit', () => { discWorker = null; setState('disc_running', 0); });
      res.json({ ok: true, roots });
    } catch (e) { discWorker = null; res.status(500).json({ error: e.message }); }
  });
  app.post('/api/ingest/discover/stop', (req, res) => { setState('disc_stop', 1); res.json({ ok: true }); });
  app.get('/api/ingest/discover/status', (req, res) => {
    try {
      const g = (k, d) => getState(k, d);
      const sum = db.prepare('SELECT COUNT(*) dirs, COALESCE(SUM(pending),0) pending, COALESCE(SUM(disk),0) disk FROM ingest_discovery').get();
      res.json({ running: !!discWorker && g('disc_running', '0') === '1', roots: String(g('disc_roots', '')).split('|').filter(Boolean), scanned: +g('disc_scanned', 0), images: +g('disc_images', 0),
                 started: +g('disc_started', 0) || null, finished: +g('disc_finished', 0) || null, error: g('disc_error', '') || null, dirs: sum.dirs, pending: sum.pending });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/ingest/discover/items', (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
      const w = q ? 'WHERE dir LIKE ?' : ''; const a = q ? ['%' + q + '%'] : [];
      const total = db.prepare('SELECT COUNT(*) c FROM ingest_discovery ' + w).get(...a).c;
      const items = db.prepare('SELECT dir, disk, indb, pending FROM ingest_discovery ' + w + ' ORDER BY pending DESC, dir LIMIT ? OFFSET ?').all(...a, limit, (page - 1) * limit);
      res.json({ items, total, page, limit });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('[ingest] 队列接口就绪');
};
