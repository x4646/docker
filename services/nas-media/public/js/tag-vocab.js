module.exports = function (app, getDb) {
  var express = require('express');

  (function initDb() {
    var db = getDb();
    try {
      db.prepare("CREATE TABLE IF NOT EXISTS tag_vocab_clip (tag TEXT PRIMARY KEY, category TEXT, en TEXT, enabled INTEGER DEFAULT 1) WITHOUT ROWID").run();
    } catch (e) {}
    try { db.prepare("ALTER TABLE tag_vocab_clip ADD COLUMN en TEXT").run(); } catch (e) {}
    console.log('[tag-vocab] 初始化完成');
  })();

  app.post('/api/tag-vocab/import', express.json({ limit: '2mb' }), function (req, res) {
    var vocab = (req.body && req.body.vocab) || {};
    var keys = Object.keys(vocab);
    if (!keys.length) return res.status(400).json({ error: 'vocab为空' });
    var db = getDb();
    try {
      var del = db.prepare("DELETE FROM tag_vocab_clip");
      var ins = db.prepare("INSERT INTO tag_vocab_clip (tag, category, en, enabled) VALUES (?,?,?,1)");
      db.transaction(function () {
        del.run();
        keys.forEach(function (tag) {
          ins.run(tag, '', String(vocab[tag] || ''));
        });
      })();
      res.json({ ok: true, count: keys.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/tag-vocab/full', function (req, res) {
    try {
      var db = getDb();
      var rows = db.prepare("SELECT tag, category, en, enabled FROM tag_vocab_clip WHERE enabled=1").all();
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/tag-vocab/simple', function (req, res) {
    try {
      var db = getDb();
      var rows = db.prepare("SELECT tag FROM tag_vocab_clip WHERE enabled=1").all();
      res.json(rows.map(function (r) { return r.tag; }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
