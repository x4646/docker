module.exports = function (app, getDb) {
  var express = require('express');

  (function initDb() {
    var db = getDb();
    try {
      db.prepare(
        "CREATE TABLE IF NOT EXISTS roles (" +
        "id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, " +
        "allowed_roots TEXT NOT NULL DEFAULT '[]', created_at INTEGER" +
        ") WITHOUT ROWID"
      ).run();
      console.log('[roles] 初始化完成');
    } catch (e) { console.log('[roles] 初始化失败:', e.message); }
  })();

  function genId() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  app.get('/api/roles', function (req, res) {
    try {
      var db = getDb();
      var rows = db.prepare("SELECT id, name, icon, allowed_roots, created_at FROM roles ORDER BY created_at ASC").all();
      var out = rows.map(function (r) {
        var roots = [];
        try { roots = JSON.parse(r.allowed_roots || '[]'); } catch (e) {}
        return { id: r.id, name: r.name, icon: r.icon || '', allowed_roots: roots, created_at: r.created_at };
      });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/roles', express.json(), function (req, res) {
    var b = req.body || {};
    var name = (b.name || '').trim();
    if (!name) return res.status(400).json({ error: '缺少name' });
    var roots = Array.isArray(b.allowed_roots) ? b.allowed_roots : [];
    var db = getDb();
    try {
      var id = genId();
      db.prepare("INSERT INTO roles (id,name,icon,allowed_roots,created_at) VALUES (?,?,?,?,strftime('%s','now'))")
        .run(id, name, b.icon || '', JSON.stringify(roots));
      res.json({ ok: true, id: id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/roles/:id', express.json(), function (req, res) {
    var id = req.params.id;
    var b = req.body || {};
    var db = getDb();
    try {
      var row = db.prepare("SELECT * FROM roles WHERE id=?").get(id);
      if (!row) return res.status(404).json({ error: '角色不存在' });
      var name = (typeof b.name === 'string' && b.name.trim()) ? b.name.trim() : row.name;
      var icon = (typeof b.icon === 'string') ? b.icon : row.icon;
      var roots = Array.isArray(b.allowed_roots) ? b.allowed_roots : JSON.parse(row.allowed_roots || '[]');
      db.prepare("UPDATE roles SET name=?, icon=?, allowed_roots=? WHERE id=?")
        .run(name, icon, JSON.stringify(roots), id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/roles/:id', function (req, res) {
    var id = req.params.id;
    var db = getDb();
    try {
      var r = db.prepare("DELETE FROM roles WHERE id=?").run(id);
      res.json({ ok: true, deleted: r.changes });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
