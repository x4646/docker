// soft-delete.js — 批量"逻辑删除"(标记待删)与复核后彻底删除
//
// 流程: viewer里选中一批照片/视频 -> 调 /api/photos/soft-delete 只打标记(pending_delete=1),
// 不动任何文件, 立刻从正常浏览列表里消失(见photo-tags.js/PhotoController里加的排除条件)。
// 之后去 /viewer/trash.html 复核, 确认彻底删除的才会真的去删原文件(缩略图/预览图保留,
// 走的是CDN缓存的思路, 不占多少空间, 也可以避免误删复核时找不到缩略图看)。
//
// 挂载: try { require('./public/js/soft-delete.js')(app, getDb); } catch(e) { }

module.exports = function (app, getDb) {
  var express = require('express');
  var fs = require('fs');
  var path = require('path');
  var DATA_PATH = '/data/photos';  // thumb_path/preview_path数据库里存的是相对这个目录的相对路径

  (function init() {
    var db = getDb();
    for (var ddl of [
      "ALTER TABLE photos ADD COLUMN pending_delete INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE photos ADD COLUMN pending_delete_at INTEGER",
    ]) { try { db.prepare(ddl).run(); } catch (e) {} }
    try { db.prepare("CREATE INDEX IF NOT EXISTS idx_photos_pending_delete ON photos(pending_delete)").run(); } catch (e) {}
    console.log('[soft-delete] 初始化完成');
  })();

  function parseIds(body) {
    var ids = Array.isArray(body && body.ids) ? body.ids : [];
    return ids.map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x > 0; });
  }

  // 批量标记待删: 只打标记, 不碰任何文件
  app.post('/api/photos/soft-delete', express.json(), function (req, res) {
    var ids = parseIds(req.body);
    if (!ids.length) return res.status(400).json({ error: '缺少ids' });
    try {
      var db = getDb();
      var ph = ids.map(function () { return '?'; }).join(',');
      var stmt = db.prepare(
        "UPDATE photos SET pending_delete = 1, pending_delete_at = strftime('%s','now') WHERE id IN (" + ph + ")"
      );
      var info = stmt.run.apply(stmt, ids);
      res.json({ ok: true, count: info.changes });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 从待删列表恢复(取消标记), 不做任何文件操作
  app.post('/api/photos/restore', express.json(), function (req, res) {
    var ids = parseIds(req.body);
    if (!ids.length) return res.status(400).json({ error: '缺少ids' });
    try {
      var db = getDb();
      var ph = ids.map(function () { return '?'; }).join(',');
      var stmt = db.prepare(
        "UPDATE photos SET pending_delete = 0, pending_delete_at = NULL WHERE id IN (" + ph + ")"
      );
      var info = stmt.run.apply(stmt, ids);
      res.json({ ok: true, count: info.changes });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 待删列表(复核页用): 按标记时间倒序, 分页
  app.get('/api/photos/trash-list', function (req, res) {
    try {
      var db = getDb();
      var page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
      var limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '60', 10) || 60));
      var total = db.prepare("SELECT COUNT(*) c FROM photos WHERE pending_delete = 1").get().c;
      var rows = db.prepare(
        "SELECT id, path, thumb_path, preview_path, size, media_type, pending_delete_at " +
        "FROM photos WHERE pending_delete = 1 ORDER BY pending_delete_at DESC LIMIT ? OFFSET ?"
      ).all(limit, (page - 1) * limit);
      res.json({ photos: rows, total: total, page: page, limit: limit });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 复核确认后彻底删除: 原文件 + 缩略图 + 预览图 + 数据库记录, 不可恢复
  app.post('/api/photos/confirm-delete', express.json(), function (req, res) {
    var ids = parseIds(req.body);
    if (!ids.length) return res.status(400).json({ error: '缺少ids' });
    var db = getDb();
    var results = [];
    ids.forEach(function (id) {
      var photo = db.prepare('SELECT * FROM photos WHERE id = ? AND pending_delete = 1').get(id);
      if (!photo) { results.push({ id: id, ok: false, error: '不在待删列表中(可能已被恢复或删除)' }); return; }
      var errors = [];
      var targets = [photo.path];
      if (photo.thumb_path)   targets.push(path.join(DATA_PATH, photo.thumb_path));
      if (photo.preview_path) targets.push(path.join(DATA_PATH, photo.preview_path));
      targets.forEach(function (p) {
        if (!p) return;
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { errors.push(e.message); }
      });
      db.prepare('DELETE FROM photos WHERE id = ?').run(id);
      results.push({ id: id, ok: true, errors: errors });
    });
    res.json({ ok: true, results: results });
  });

  console.log('[soft-delete] 接口挂载完成');
};
