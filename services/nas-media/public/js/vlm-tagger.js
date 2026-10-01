module.exports = function (app, getDb) {
  var express = require('express');

  var VOCAB = {
    "人物": ["单人","双人","合影","人群","婴儿","儿童","老人","背影","人物特写"],
    "场景": ["室内","室外","家居","厨房","办公室","教室","商场","餐厅","医院","机场","车站","街道","夜景","城市风光","森林","山","草地","湖泊","河流","海滩","日出日落","泳池"],
    "物体": ["美食","猫","狗","手机","服饰"],
    "活动": ["旅行","婚礼","生日","聚餐","运动健身"]
  };

  (function initDb() {
    var db = getDb();
    try {
      db.prepare("CREATE TABLE IF NOT EXISTS tag_vocab (tag TEXT PRIMARY KEY, category TEXT NOT NULL, enabled INTEGER DEFAULT 1) WITHOUT ROWID").run();
      var del = db.prepare("DELETE FROM tag_vocab");
      var ins = db.prepare("INSERT OR IGNORE INTO tag_vocab (tag, category, enabled) VALUES (?,?,1)");
      var tx = db.transaction(function () {
        del.run();
        Object.keys(VOCAB).forEach(function (cat) {
          VOCAB[cat].forEach(function (tag) { ins.run(tag, cat); });
        });
      });
      tx();
      console.log('[vlm] 词表已更新为v2,共', db.prepare("SELECT COUNT(*) c FROM tag_vocab").get().c, '个标签');
    } catch (e) { console.log('[vlm] 词表初始化失败:', e.message); }

    try { db.prepare("ALTER TABLE photos ADD COLUMN vlm_status INTEGER DEFAULT 0").run(); } catch (e) {}
    try { db.prepare("CREATE INDEX IF NOT EXISTS idx_photos_vlm_status ON photos(vlm_status)").run(); } catch (e) {}
    console.log('[vlm] 初始化完成');
  })();

  app.get('/api/vlm/vocab', function (req, res) {
    try {
      var db = getDb();
      var rows = db.prepare("SELECT tag, category FROM tag_vocab WHERE enabled=1 ORDER BY category, tag").all();
      var categories = {};
      rows.forEach(function (r) {
        if (!categories[r.category]) categories[r.category] = [];
        categories[r.category].push(r.tag);
      });
      res.json({ version: 2, categories: categories });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/vlm/claim', express.json(), function (req, res) {
    var limit = Math.min(parseInt((req.body && req.body.limit) || 32, 10) || 32, 200);
    var db = getDb();
    try {
      var rows = db.prepare(
        "SELECT md5, MIN(preview_path) AS preview_path FROM photos " +
        "WHERE vlm_status=0 AND md5 IS NOT NULL AND length(md5)=32 AND preview_path IS NOT NULL " +
        "GROUP BY md5 LIMIT ?"
      ).all(limit);
      if (rows.length) {
        var mark = db.prepare("UPDATE photos SET vlm_status=9 WHERE md5=? AND vlm_status=0");
        db.transaction(function () { rows.forEach(function (r) { mark.run(r.md5); }); })();
      }
      res.json({ items: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/vlm/result', express.json({ limit: '32mb' }), function (req, res) {
    var results = (req.body && req.body.results) || [];
    var db = getDb();
    var vocabSet = new Set(db.prepare("SELECT tag FROM tag_vocab WHERE enabled=1").all().map(function (r) { return r.tag; }));
    var delTags = db.prepare("DELETE FROM photo_tags WHERE md5=? AND source IN ('vlm','vlm-open')");
    var insTag  = db.prepare("INSERT INTO photo_tags (md5, tag, score, source) VALUES (?,?,?,?)");
    var updP    = db.prepare("UPDATE photos SET vlm_status=? WHERE md5=?");
    var okN = 0, errN = 0, droppedN = 0;
    try {
      db.transaction(function () {
        results.forEach(function (r) {
          if (!r || !r.md5) return;
          if (!r.ok) { updP.run(2, r.md5); errN++; return; }
          delTags.run(r.md5);
          var tags = Array.isArray(r.tags) ? r.tags.slice(0, 6) : [];
          tags.forEach(function (t) {
            if (!t || !t.t) return;
            if (!vocabSet.has(t.t)) { droppedN++; return; }
            var s = typeof t.s === 'number' ? Math.max(0, Math.min(1, t.s)) : 0.5;
            insTag.run(r.md5, t.t, s, 'vlm');
          });
          var extra = Array.isArray(r.extra) ? r.extra.slice(0, 2) : [];
          extra.forEach(function (e) {
            if (!e) return;
            var word = String(e).slice(0, 8);
            insTag.run(r.md5, word, 0.5, 'vlm-open');
          });
          updP.run(1, r.md5);
          okN++;
        });
      })();
      res.json({ ok: okN, err: errN, dropped: droppedN });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/vlm/stats', function (req, res) {
    try {
      var db = getDb();
      var byS = db.prepare(
        "SELECT vlm_status s, COUNT(DISTINCT md5) n FROM photos WHERE md5 IS NOT NULL AND length(md5)=32 GROUP BY vlm_status"
      ).all();
      var tagged = db.prepare("SELECT COUNT(DISTINCT md5) n FROM photo_tags WHERE source IN ('vlm','vlm-open')").get().n;
      var o = { pending: 0, processing: 0, done: 0, error: 0, tagged: tagged };
      byS.forEach(function (r) {
        if (r.s === 0 || r.s === null) o.pending += r.n;
        else if (r.s === 9) o.processing = r.n;
        else if (r.s === 1) o.done = r.n;
        else if (r.s === 2) o.error = r.n;
      });
      res.json(o);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/vlm/reset-stale', function (req, res) {
    try {
      var n = getDb().prepare("UPDATE photos SET vlm_status=0 WHERE vlm_status=9").run().changes;
      res.json({ reset: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
