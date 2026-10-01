/*
 * video-wizard.js — nasmgr页面"视频空间优化向导"专用的几个只读/小改动接口。
 * 向导里能直接复用的(zhuanma扫描/修复/清理、video-migrate替换/清理、抽帧agent状态)
 * 前端直接调各自原来的接口, 这里只补"原来没有、又必须先看到才敢点按钮"的:
 *   - 回收目录里还躺着多少原文件(点"释放空间"之前先看能省多少)
 *   - 数据库说已抽帧、但缩略图文件其实不在的视频有多少, 以及一键重置成待抽帧
 * 遍历几万个文件容易卡住事件循环, 全部用异步分片(每处理一批就让出一次), 结果缓存,
 * 接口本身立刻返回当前状态(computing/ready), 前端轮询。
 */
const fs = require('fs');
const path = require('path');

module.exports = function (app, getDb) {
  const VTHUMB_DIR = '/share/Container/docker/services/nas-media/vthumbs';
  const CACHE_MS = 120 * 1000;

  const _cachedevCache = {};
  function toRealPath(dbPath) {
    if (dbPath.indexOf('/share/CACHEDEV') === 0) return dbPath;
    const m = dbPath.match(/^\/share\/([^\/]+)(\/.*)?$/);
    if (!m) return dbPath;
    const shareName = m[1], rest = m[2] || '';
    if (Object.prototype.hasOwnProperty.call(_cachedevCache, shareName)) {
      const cached = _cachedevCache[shareName];
      return cached ? ('/share/' + cached + '/' + shareName + rest) : dbPath;
    }
    for (let i = 1; i <= 8; i++) {
      const cand = '/share/CACHEDEV' + i + '_DATA/' + shareName + rest;
      try { if (fs.existsSync(cand)) { _cachedevCache[shareName] = 'CACHEDEV' + i + '_DATA'; return cand; } } catch (e) {}
    }
    _cachedevCache[shareName] = null;
    return dbPath;
  }
  const yieldLoop = () => new Promise((r) => setImmediate(r));

  // ── 回收目录预览 ──
  let trash = { status: 'none' };
  async function computeTrash() {
    trash = { status: 'computing', startedAt: Date.now() };
    try {
      const db = getDb();
      let zmN = 0, zmB = 0, vmN = 0, vmB = 0;

      const zmRows = db.prepare("SELECT path FROM photos WHERE media_type='video' AND web_ready=1 AND path LIKE '%.mp4'").all();
      let i = 0;
      for (const row of zmRows) {
        if (++i % 300 === 0) await yieldLoop();
        const real = toRealPath(row.path);
        const trashDir = path.join(path.dirname(real), '.zhuanma_trash');
        const baseNoExt = path.basename(real).replace(/\.[A-Za-z0-9]{1,5}$/, '');
        let entries;
        try { entries = fs.readdirSync(trashDir); } catch (e) { continue; }
        const hit = entries.find((f) => f.indexOf(baseNoExt + '.') === 0 || f === baseNoExt);
        if (!hit) continue;
        try { zmB += fs.statSync(path.join(trashDir, hit)).size; zmN++; } catch (e) {}
      }

      const vmRows = db.prepare("SELECT orig_path FROM video_migrate_check WHERE status='applied'").all();
      i = 0;
      for (const row of vmRows) {
        if (++i % 300 === 0) await yieldLoop();
        const real = toRealPath(row.orig_path);
        const t = path.join(path.dirname(real), '.video_migrate_trash', path.basename(real));
        try { vmB += fs.statSync(t).size; vmN++; } catch (e) {}
      }
      trash = { status: 'ready', at: Date.now(), zhuanma: { count: zmN, bytes: zmB }, migrate: { count: vmN, bytes: vmB } };
    } catch (e) { trash = { status: 'error', error: e.message }; }
  }
  app.get('/api/video-wizard/trash-preview', (req, res) => {
    const stale = trash.status === 'none' || req.query.force === '1' ||
      (trash.status === 'ready' && Date.now() - trash.at > CACHE_MS) || trash.status === 'error';
    if (stale && trash.status !== 'computing') computeTrash();
    res.json(trash);
  });

  // ── 缩略图缺失检查 ──
  let thumbs = { status: 'none' };
  let thumbMissingIds = [];
  async function computeThumbs() {
    thumbs = { status: 'computing', startedAt: Date.now() };
    try {
      const db = getDb();
      const rows = db.prepare("SELECT id, md5 FROM photos WHERE media_type='video' AND shots>0").all();
      const missing = [];
      let i = 0;
      for (const r of rows) {
        if (++i % 500 === 0) await yieldLoop();
        if (!fs.existsSync(VTHUMB_DIR + '/' + r.md5.slice(0, 2) + '/' + r.md5 + '_01.jpg')) missing.push(r.id);
      }
      thumbMissingIds = missing;
      thumbs = { status: 'ready', at: Date.now(), total: rows.length, missing: missing.length };
    } catch (e) { thumbs = { status: 'error', error: e.message }; }
  }
  app.get('/api/video-wizard/thumb-check', (req, res) => {
    const stale = thumbs.status === 'none' || req.query.force === '1' ||
      (thumbs.status === 'ready' && Date.now() - thumbs.at > CACHE_MS) || thumbs.status === 'error';
    if (stale && thumbs.status !== 'computing') computeThumbs();
    res.json(thumbs);
  });

  // 缺缩略图的重置成"待抽帧"(shots=0), PC上的video_thumbs.ps1下次巡检就会领走
  app.post('/api/video-wizard/thumb-reset', (req, res) => {
    if (thumbs.status !== 'ready') return res.status(400).json({ error: '请先检查缺失数量' });
    try {
      const db = getDb();
      const up = db.prepare("UPDATE photos SET shots = 0 WHERE id = ? AND media_type='video'");
      let n = 0;
      db.transaction((ids) => { for (const id of ids) n += up.run(id).changes; })(thumbMissingIds);
      thumbMissingIds = [];
      thumbs = { status: 'none' };
      res.json({ ok: true, reset: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 换壳体检通过、还没替换的: 数量 + 原文件合计大小(替换并清掉回收目录之后大约能省这么多)。
  // 体检之后换壳副本(转换/目录里的_换壳.mp4)可能已经被删了/处理过——副本不在就替换不了,
  // 这种"体检通过"是过期的, 单独统计成stale, 不算进待替换(否则数字虚高、点了全失败)。
  app.get('/api/video-wizard/migrate-pending', (req, res) => {
    try {
      const rows = getDb().prepare(
        "SELECT v.conv_path cp, p.size sz FROM video_migrate_check v LEFT JOIN photos p ON p.path = v.orig_path WHERE v.status = 'ok'"
      ).all();
      let count = 0, bytes = 0, stale = 0;
      for (const r of rows) {
        if (r.cp && fs.existsSync(r.cp)) { count++; bytes += r.sz || 0; } else stale++;
      }
      res.json({ count, bytes, stale });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 抽帧速度/预计完成: 每分钟记一次"待抽帧数", 用最近几个样本算每分钟处理多少 ──
  const samples = [];
  setInterval(() => {
    try {
      const c = getDb().prepare("SELECT COUNT(*) c FROM photos WHERE media_type='video' AND shots=0").get().c;
      samples.push({ t: Date.now(), pending: c });
      if (samples.length > 90) samples.shift();
    } catch (e) {}
  }, 60000).unref();
  app.get('/api/video-wizard/thumb-rate', (req, res) => {
    let pending = 0;
    try { pending = getDb().prepare("SELECT COUNT(*) c FROM photos WHERE media_type='video' AND shots=0").get().c; } catch (e) {}
    const win = samples.slice(-15);
    if (win.length < 3) return res.json({ pending, perMin: null, etaMinutes: null, note: '样本还不够, 等几分钟' });
    const mins = (win[win.length - 1].t - win[0].t) / 60000;
    const perMin = mins > 0 ? (win[0].pending - win[win.length - 1].pending) / mins : 0;
    res.json({ pending, perMin: Math.max(0, perMin), etaMinutes: perMin > 0.05 ? pending / perMin : null, windowMin: mins });
  });

  // ── 统一视频key(快速内容指纹)迁移: 页面上能重复跑(已经对的会跳过) ──
  const http = require('http');
  const vk = require('./video-key.js');
  function agentOnline() {
    return new Promise((resolve) => http.get('http://localhost:3050/api/video/agent-status', (r) => {
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { resolve(!!JSON.parse(d).online); } catch (e) { resolve(false); } });
    }).on('error', () => resolve(false)));
  }
  let keyTask = null;
  app.get('/api/video-wizard/key-migrate/current', (req, res) => {
    let hist = 0; try { hist = getDb().prepare('SELECT COUNT(*) c FROM video_key_history').get().c; } catch (e) {}
    res.json(Object.assign({ history: hist }, keyTask ? Object.assign({}, keyTask, { stopRequested: undefined }) : { status: 'none' }));
  });
  app.post('/api/video-wizard/key-migrate/stop', (req, res) => { if (keyTask) keyTask.stopRequested = true; res.json({ ok: true }); });
  app.post('/api/video-wizard/key-migrate/start', async (req, res) => {
    if (keyTask && (keyTask.status === 'running' || keyTask.status === 'backup')) return res.status(400).json({ error: '已经在跑了' });
    if (await agentOnline()) return res.status(400).json({ error: '电脑上的抽帧程序还在运行(60秒内领过任务)，先在电脑上 Ctrl+C 停掉它再点。它按key写缩略图，key改了它会写到旧位置。' });
    const db = getDb();
    const rows = db.prepare("SELECT id, path, md5, shots FROM photos WHERE media_type='video'").all();
    const task = keyTask = { status: 'backup', total: rows.length, done: 0, changed: 0, same: 0, missing: 0, err: 0, thumbsMoved: 0, needRegen: 0, currentPath: null, stopRequested: false, startedAt: Date.now() };
    res.json({ ok: true, total: rows.length });
    (async () => {
      const dstr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      try { await db.backup('/share/ssd001/nas.db.before_vkey_' + dstr + '_' + Date.now()); } catch (e) { task.status = 'error'; task.error = '备份数据库失败: ' + e.message; return; }
      task.status = 'running';
      vk.ensureHistoryTable(db);
      const upPhoto = db.prepare("UPDATE photos SET md5=?, updated_at=strftime('%s','now') WHERE id=?");
      const shots0 = db.prepare('UPDATE photos SET shots=0 WHERE id=? AND shots>0');
      const remapped = new Map();
      for (const r of rows) {
        if (task.stopRequested) { task.status = 'stopped'; task.currentPath = null; return; }
        task.done++; task.currentPath = r.path;
        try {
          const real = toRealPath(r.path);
          if (!fs.existsSync(real)) { task.missing++; }
          else {
            const nk = vk.quickKey(real);
            if (nk === r.md5) task.same++;
            else {
              db.transaction(() => {
                upPhoto.run(nk, r.id);
                if (!remapped.has(r.md5)) { task.thumbsMoved += vk.remapKey(db, r.md5, nk, { path: r.path, reason: 'wizard-key-migrate' }).thumbs; remapped.set(r.md5, nk); }
              })();
              if (r.shots > 0 && !fs.existsSync(VTHUMB_DIR + '/' + nk.slice(0, 2) + '/' + nk + '_01.jpg')) { shots0.run(r.id); task.needRegen++; }
              task.changed++;
            }
          }
        } catch (e) { task.err++; if (!task.firstErr) task.firstErr = r.path + ': ' + e.message; }
        if (task.done % 20 === 0) await yieldLoop();
      }
      task.status = 'done'; task.currentPath = null;
    })().catch((e) => { task.status = 'error'; task.error = e.message; });
  });

  // ── 清理孤立缩略图: 文件名里的key已经没有任何视频/照片在用(改key/删视频后留下的垃圾) ──
  let orphan = { status: 'none' };
  let orphanFiles = [];
  async function computeOrphans() {
    orphan = { status: 'computing', startedAt: Date.now() };
    try {
      const keys = new Set(getDb().prepare('SELECT md5 FROM photos WHERE md5 IS NOT NULL').all().map((r) => r.md5));
      const files = []; let bytes = 0; const okeys = new Set(); let total = 0;
      for (const d of fs.readdirSync(VTHUMB_DIR)) {
        let fl; try { fl = fs.readdirSync(VTHUMB_DIR + '/' + d); } catch (e) { continue; }
        for (const f of fl) {
          const m = f.match(/^([0-9a-f]{32})_\d+\.jpg$/); if (!m) continue;
          total++;
          if (keys.has(m[1])) continue;
          const p = VTHUMB_DIR + '/' + d + '/' + f;
          files.push(p); okeys.add(m[1]);
          try { bytes += fs.statSync(p).size; } catch (e) {}
        }
        await yieldLoop();
      }
      orphanFiles = files;
      orphan = { status: 'ready', at: Date.now(), total, files: files.length, keys: okeys.size, bytes };
    } catch (e) { orphan = { status: 'error', error: e.message }; }
  }
  app.get('/api/video-wizard/orphan-thumbs', (req, res) => {
    const stale = orphan.status === 'none' || orphan.status === 'error' || req.query.force === '1' || (orphan.status === 'ready' && Date.now() - orphan.at > 5 * 60000);
    if (stale && orphan.status !== 'computing' && !(orphanClean && orphanClean.status === 'running')) computeOrphans();
    res.json(Object.assign({}, orphan, { clean: orphanClean }));
  });
  let orphanClean = null;
  app.post('/api/video-wizard/orphan-thumbs/clean', (req, res) => {
    if (orphan.status !== 'ready') return res.status(400).json({ error: '请先统计孤立缩略图' });
    if (orphanClean && orphanClean.status === 'running') return res.status(400).json({ error: '已经在清理了' });
    const list = orphanFiles; orphanFiles = [];
    const t = orphanClean = { status: 'running', total: list.length, done: 0, freedBytes: 0 };
    res.json({ ok: true, total: list.length });
    (async () => {
      const db = getDb(); const inUse = db.prepare('SELECT 1 FROM photos WHERE md5=? LIMIT 1');
      for (const p of list) {
        const m = path.basename(p).match(/^([0-9a-f]{32})_/);
        try {
          if (m && !inUse.get(m[1])) { const sz = fs.statSync(p).size; fs.unlinkSync(p); t.freedBytes += sz; }
        } catch (e) {}
        if (++t.done % 500 === 0) await yieldLoop();
      }
      t.status = 'done'; orphan = { status: 'none' };
    })().catch((e) => { t.status = 'error'; t.error = e.message; });
  });

  console.log('[video-wizard] 初始化完成');
};
