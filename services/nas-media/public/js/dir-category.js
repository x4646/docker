// dir-category.js — 目录级"成人/家庭"标记
//
// 只存 family 记录, 未标记的目录默认算 adult(成人)。
// 判定规则: 视频路径若落在某条 family 记录的目录(或其子目录)下, 就算 family, 否则 adult。
// 父目录标记会级联到所有子目录; 但不会覆盖父目录本身、也不影响兄弟目录。
//
// 挂载: try { require('./public/js/dir-category.js')(app, getDb); } catch(e) { }

module.exports = function (app, getDb) {
  var express = require('express');

  (function init() {
    var db = getDb();
    db.exec(
      "CREATE TABLE IF NOT EXISTS dir_category (" +
      "  path TEXT PRIMARY KEY," +
      "  category TEXT NOT NULL DEFAULT 'family'," +
      "  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))" +
      ")"
    );
    console.log('[dir-category] 初始化完成');
  })();

  function norm(p) {
    return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  // ── 列出所有已标记为家庭的目录 ──────────────────────
  // GET /api/dir-category/list
  app.get('/api/dir-category/list', function (req, res) {
    try {
      var rows = getDb().prepare('SELECT path FROM dir_category ORDER BY path').all();
      res.json(rows.map(function (r) { return r.path; }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 标记 / 取消标记某个目录为家庭 ───────────────────
  // POST /api/dir-category/set  {path, family: true|false}
  app.post('/api/dir-category/set', express.json(), function (req, res) {
    var b = req.body || {};
    var p = norm(b.path);
    if (!p) return res.status(400).json({ error: '缺少 path' });
    try {
      var db = getDb();
      if (b.family) {
        db.prepare(
          "INSERT INTO dir_category (path, category, created_at) VALUES (?, 'family', strftime('%s','now')) " +
          "ON CONFLICT(path) DO NOTHING"
        ).run(p);
      } else {
        db.prepare('DELETE FROM dir_category WHERE path = ?').run(p);
      }
      res.json({ ok: true, path: p, family: !!b.family });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 某个目录当前的分类(含继承判定) ──────────────────
  // GET /api/dir-category/check?path=/share/Person/x
  app.get('/api/dir-category/check', function (req, res) {
    var p = norm(req.query.path);
    if (!p) return res.status(400).json({ error: '缺少 path' });
    try {
      var db = getDb();
      var rows = db.prepare('SELECT path FROM dir_category').all();
      var isFamily = rows.some(function (r) { return p === r.path || p.indexOf(r.path + '/') === 0; });
      var directlyMarked = rows.some(function (r) { return r.path === p; });
      res.json({ path: p, category: isFamily ? 'family' : 'adult', directlyMarked: directlyMarked });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 供其它模块(photo-tags.js)复用的判定函数: 返回 'family' | 'adult'
  function categoryOf(db, videoPath) {
    var p = norm(videoPath);
    var rows = db.prepare('SELECT path FROM dir_category').all();
    for (var i = 0; i < rows.length; i++) {
      var fp = rows[i].path;
      if (p === fp || p.indexOf(fp + '/') === 0) return 'family';
    }
    return 'adult';
  }

  // 生成 SQL 片段: 给定 family 目录列表, 拼出 "落在这些目录下" 的 WHERE 条件
  // 供 photo-tags.js 的 category 筛选使用, 避免逐条查询拖慢大列表
  function familyWhereClause(db, alias) {
    var rows = db.prepare('SELECT path FROM dir_category').all();
    if (!rows.length) return { sql: '0', params: [] };   // 没有任何家庭标记时, 恒不匹配
    var parts = [], params = [];
    rows.forEach(function (r) {
      parts.push('(' + alias + '.path = ? OR ' + alias + ".path LIKE ? ESCAPE '\\')");
      params.push(r.path, r.path.replace(/[\\%_]/g, '\\$&') + '/%');
    });
    return { sql: '(' + parts.join(' OR ') + ')', params: params };
  }

  // 暴露给其它模块用(photo-tags.js 里 require 这个模块拿函数, 而不是重新实现一遍)
  app.locals.dirCategory = { categoryOf: categoryOf, familyWhereClause: familyWhereClause, norm: norm };
};
