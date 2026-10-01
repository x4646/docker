module.exports = function (app, getDb) {
  var express = require('express');
  (function initDb() {
    var db = getDb();
    try { db.prepare("ALTER TABLE photos ADD COLUMN clip_status INTEGER DEFAULT 0").run(); } catch (e) {}
    try { db.prepare("CREATE INDEX IF NOT EXISTS idx_photos_clip_status ON photos(clip_status)").run(); } catch (e) {}
    console.log('[clip] 初始化完成');
  })();

  // ── 任务领取: 20张一批, 只取有md5的, 标记为处理中(9) ──
  app.post('/api/clip/claim', express.json(), function (req, res) {
    var limit = Math.min(parseInt((req.body && req.body.limit) || 20, 10) || 20, 500);
    var dirFilter = req.body && req.body.dirFilter ? String(req.body.dirFilter).replace(/\\/g, '/') : null;
    var db = getDb();
    try {
      var rows;
      if (dirFilter) {
        rows = db.prepare(
          "SELECT md5, MIN(path) AS path FROM photos " +
          "WHERE clip_status=0 AND md5 IS NOT NULL AND length(md5)=32 AND REPLACE(path,'\\','/') LIKE ? " +
          "GROUP BY md5 LIMIT ?"
        ).all(dirFilter + '%', limit);
      } else {
        rows = db.prepare(
          "SELECT md5, MIN(path) AS path FROM photos " +
          "WHERE clip_status=0 AND md5 IS NOT NULL AND length(md5)=32 " +
          "GROUP BY md5 LIMIT ?"
        ).all(limit);
      }
      if (rows.length) {
        var mark = db.prepare("UPDATE photos SET clip_status=9 WHERE md5=? AND clip_status=0");
        db.transaction(function () { rows.forEach(function (r) { mark.run(r.md5); }); })();
      }
      res.json({ items: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 批量结果提交: 写photo_tags + 更新clip_status ──
  app.post('/api/clip/result', express.json({ limit: '64mb' }), function (req, res) {
    var results = (req.body && req.body.results) || [];
    var db = getDb();
    var delTags = db.prepare("DELETE FROM photo_tags WHERE md5=? AND source='clip'");
    var insTag  = db.prepare("INSERT INTO photo_tags (md5, tag, score, source) VALUES (?,?,?,'clip')");
    var updP    = db.prepare("UPDATE photos SET clip_status=? WHERE md5=?");
    var okN = 0, errN = 0;
    try {
      db.transaction(function () {
        results.forEach(function (r) {
          if (!r || !r.md5) return;
          if (!r.ok) { updP.run(2, r.md5); errN++; return; }
          delTags.run(r.md5);
          var tags = Array.isArray(r.tags) ? r.tags : [];
          tags.forEach(function (t) {
            if (!t || !t.tag) return;
            insTag.run(r.md5, t.tag, typeof t.score === 'number' ? t.score : 0);
          });
          updP.run(1, r.md5);
          okN++;
        });
      })();
      res.json({ ok: okN, err: errN });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 卡死清理: 处理中(9)重置回待处理(0), PC启动时调用 ──
  app.post('/api/clip/reset-stale', function (req, res) {
    try {
      var n = getDb().prepare("UPDATE photos SET clip_status=0 WHERE clip_status=9").run().changes;
      res.json({ reset: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 按目录重置(重新提取用): clip_status→0 ──
  app.post('/api/clip/reset-dir', express.json(), function (req, res) {
    var dir = req.body && req.body.path ? String(req.body.path).replace(/\\/g, '/') : null;
    if (!dir) return res.status(400).json({ error: '缺少path' });
    try {
      var n = getDb().prepare(
        "UPDATE photos SET clip_status=0 WHERE REPLACE(path,'\\','/') LIKE ? AND md5 IS NOT NULL AND length(md5)=32"
      ).run(dir + '/%').changes;
      res.json({ ok: true, reset: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 目标目录队列: 前端提交(单个或多个), PC轮询队头, 处理完自动切下一个 ──
  var _clipDirQueue = [];
  app.post('/api/clip/set-target-dir', express.json(), function (req, res) {
    var b = req.body || {};
    var paths = [];
    if (Array.isArray(b.paths)) paths = b.paths;
    else if (b.path) paths = [b.path];
    paths = paths.filter(Boolean).map(function (d) { return String(d).replace(/\\/g, '/'); });
    if (!paths.length) {
      _clipDirQueue = [];
      _live.status = 'idle'; _live.dir = null; _live.current = null;
      _live.queue = []; _live.done = 0; _live.err = 0; _live.updated = Date.now();
      console.log('[clip] 目标队列已清空');
      return res.json({ ok: true, dirQueue: [] });
    }
    var db2 = getDb();
    var withWork = [], noWork = [];
    paths.forEach(function (d) {
      var c = 0;
      try {
        c = db2.prepare("SELECT COUNT(*) c FROM photos WHERE clip_status=0 AND md5 IS NOT NULL AND length(md5)=32 AND REPLACE(path,'\\','/') LIKE ?").get(d + '/%').c;
      } catch (e) {}
      (c > 0 ? withWork : noWork).push({ dir: d, pending: c });
    });
    if (!withWork.length) {
      return res.json({ ok: true, allDone: true, dirQueue: [],
        detail: noWork.map(function (x) { return x.dir; }) });
    }
    _clipDirQueue = withWork.map(function (x) { return x.dir; });
    _live.status = 'waiting'; _live.dir = _clipDirQueue[0]; _live.current = null;
    _live.queue = []; _live.done = 0; _live.err = 0; _live.updated = Date.now();
    console.log('[clip] 目标队列:', JSON.stringify(_clipDirQueue), noWork.length ? ('(跳过已完成:' + noWork.length + '个)') : '');
    res.json({ ok: true, dirQueue: _clipDirQueue });
  });
  app.get('/api/clip/target-dir', function (req, res) {
    // 队头目录若已无待处理任务, 自动弹出切换到下一个
    var db = getDb();
    while (_clipDirQueue.length) {
      var head = _clipDirQueue[0];
      var remain = 0;
      try {
        remain = db.prepare(
          "SELECT COUNT(*) c FROM photos WHERE clip_status IN (0,9) AND md5 IS NOT NULL AND length(md5)=32 AND REPLACE(path,'\\','/') LIKE ?"
        ).get(head + '/%').c;
      } catch (e) {}
      if (remain > 0) break;
      console.log('[clip] 目录完成,出队:', head);
      _clipDirQueue.shift();
    }
    res.json({ dirFilter: _clipDirQueue[0] || null, dirQueue: _clipDirQueue });
  });

  // ── 实时状态: PC上报, 前端轮询展示 ──
  var _live = { status: 'idle', dir: null, current: null, queue: [], done: 0, err: 0, total: 0, updated: 0 };
  app.post('/api/clip/live-report', express.json({ limit: '4mb' }), function (req, res) {
    var b = req.body || {};
    if (b.status !== undefined) _live.status = b.status;
    if (b.dir !== undefined) _live.dir = b.dir;
    if (b.current !== undefined) _live.current = b.current;
    if (b.queue !== undefined) _live.queue = Array.isArray(b.queue) ? b.queue : [];
    if (b.done !== undefined) _live.done = b.done;
    if (b.err !== undefined) _live.err = b.err;
    if (b.total !== undefined) _live.total = b.total;
    _live.updated = Date.now();
    res.json({ ok: true });
  });
  app.get('/api/clip/live-status', function (req, res) {
    var stale = Date.now() - _live.updated > 30000;
    var db = getDb();
    var pending = 0;
    var scopeDir = _clipDirQueue[0] || _live.dir;
    try {
      if (scopeDir) {
        pending = db.prepare("SELECT COUNT(DISTINCT md5) c FROM photos WHERE clip_status=0 AND md5 IS NOT NULL AND length(md5)=32 AND REPLACE(path,'\\','/') LIKE ?").get(scopeDir + '%').c;
      } else {
        pending = db.prepare("SELECT COUNT(DISTINCT md5) c FROM photos WHERE clip_status=0 AND md5 IS NOT NULL AND length(md5)=32").get().c;
      }
    } catch(e) {}
    res.json({
      status: stale && _live.status === 'running' ? 'stale' : _live.status,
      dir: _live.dir, current: _live.current, queue: _live.queue,
      done: _live.done, err: _live.err, total: _live.total,
      pendingInScope: pending,
      updatedAgo: _live.updated ? Math.round((Date.now() - _live.updated)/1000) : null
    });
  });

  // ── 目录统计(前端目录树显示 已提取/未提取 用) ──
  app.get('/api/clip/dir-stat', function (req, res) {
    var dir = req.query.path ? String(req.query.path).replace(/\\/g, '/') : null;
    if (!dir) return res.status(400).json({ error: '缺少path' });
    try {
      var db = getDb();
      var r = db.prepare(
        "SELECT SUM(CASE WHEN clip_status=1 THEN 1 ELSE 0 END) done, " +
        "SUM(CASE WHEN clip_status=0 THEN 1 ELSE 0 END) pending, " +
        "COUNT(*) total FROM (SELECT DISTINCT md5, clip_status FROM photos " +
        "WHERE md5 IS NOT NULL AND length(md5)=32 AND REPLACE(path,'\\','/') LIKE ?)"
      ).get(dir + '%');
      res.json({ done: r.done || 0, pending: r.pending || 0, total: r.total || 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
