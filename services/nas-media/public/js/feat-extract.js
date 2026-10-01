module.exports = function(app, getDb) {
  var express = require('express');
  try {
    var db0 = getDb();
    db0.prepare("CREATE TABLE IF NOT EXISTS photo_features (md5 TEXT PRIMARY KEY, feature BLOB NOT NULL, dim INTEGER NOT NULL DEFAULT 512, model TEXT, created_at INTEGER) WITHOUT ROWID").run();
    try { db0.prepare("ALTER TABLE photos ADD COLUMN feat_status INTEGER DEFAULT 0").run(); } catch(e) {}
    try { db0.prepare("CREATE INDEX IF NOT EXISTS idx_photos_feat_status ON photos(feat_status)").run(); } catch(e) {}
    console.log('[feat] 初始化完成');
  } catch(e) { console.log('[feat] 初始化失败:', e.message); }

  app.post('/api/feat/claim', express.json(), function(req, res) {
    var limit = Math.min(parseInt((req.body && req.body.limit) || 256, 10) || 256, 1000);
    var db = getDb();
    try {
      var rows = db.prepare("SELECT md5, MIN(path) AS path FROM photos WHERE feat_status=0 AND md5 IS NOT NULL AND length(md5)=32 GROUP BY md5 LIMIT ?").all(limit);
      if (rows.length) {
        var mark = db.prepare("UPDATE photos SET feat_status=9 WHERE md5=? AND feat_status=0");
        db.transaction(function() { rows.forEach(function(r) { mark.run(r.md5); }); })();
      }
      res.json({ items: rows });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/feat/result', express.json({limit:'64mb'}), function(req, res) {
    var results = (req.body && req.body.results) || [];
    var db = getDb();
    var insF = db.prepare("INSERT OR REPLACE INTO photo_features (md5, feature, dim, model, created_at) VALUES (?, ?, 512, 'cnclip-vitb16', strftime('%s','now'))");
    var updP = db.prepare("UPDATE photos SET feat_status=? WHERE md5=?");
    var okN = 0, errN = 0, badN = 0;
    try {
      db.transaction(function() {
        results.forEach(function(r) {
          if (!r || !r.md5) return;
          if (r.ok && r.feature_b64) {
            var buf = Buffer.from(r.feature_b64, 'base64');
            if (buf.length !== 2048) { badN++; updP.run(2, r.md5); return; }
            insF.run(r.md5, buf); updP.run(1, r.md5); okN++;
          } else { updP.run(2, r.md5); errN++; }
        });
      })();
      res.json({ ok: okN, err: errN, bad: badN });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/feat/stats', function(req, res) {
    try {
      var db = getDb();
      var byS = db.prepare("SELECT feat_status s, COUNT(DISTINCT md5) n FROM photos WHERE md5 IS NOT NULL AND length(md5)=32 GROUP BY feat_status").all();
      var fea = db.prepare("SELECT COUNT(*) n FROM photo_features").get().n;
      var o = { pending:0, processing:0, done:0, error:0, features:fea };
      byS.forEach(function(r) {
        if (r.s===0 || r.s===null) o.pending += r.n;
        else if (r.s===9) o.processing = r.n;
        else if (r.s===1) o.done = r.n;
        else if (r.s===2) o.error = r.n;
      });
      res.json(o);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/feat/reset-stale', function(req, res) {
    try {
      var n = getDb().prepare("UPDATE photos SET feat_status=0 WHERE feat_status=9").run().changes;
      res.json({ reset: n });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
};
