// error-center.js — 管理页"功能错误"统一查询中心
//
// 目标: 把散落在各处的失败状态(照片 status='error' + process_logs、
//       视频 shots=-1)汇总成一套统一接口, 供管理页按"功能类型"筛选、
//       按目录统计、点击查看具体错误详情。
//
// 设计: 不新建大表重复存数据, 现有数据在哪就查哪, 只是包一层统一格式。
//       视频抽帧原来没存具体错误文本, 这里给 photos 补一个 video_error 字段。

module.exports = function (app, getDb) {
  var express = require('express');

  (function init() {
    var db = getDb();
    var cols = db.prepare('PRAGMA table_info(photos)').all().map(function (c) { return c.name; });
    if (cols.indexOf('video_error') < 0) {
      db.exec('ALTER TABLE photos ADD COLUMN video_error TEXT');
      console.log('[error-center] 已添加 video_error 字段');
    }
    console.log('[error-center] 初始化完成');
  })();

  function norm(p) { return String(p || '').replace(/\\/g, '/').replace(/\/+$/, ''); }

  // 支持的功能类型及其"该目录下有多少条失败"的查询方式。
  // 每一项: { key, label, count(db, dirLike) -> number, list(db, dirLike, limit) -> [{path,error}] }
  var FEATURES = {
    photo_process: {
      label: '图片处理',
      countSql: "SELECT COUNT(*) c FROM photos WHERE media_type != 'video' AND status = 'error' AND (md5 IS NOT NULL AND length(md5)=32) AND REPLACE(path,'\\','/') LIKE ?",
      listSql:  "SELECT p.path, (SELECT error FROM process_logs WHERE path = p.path ORDER BY created_at DESC LIMIT 1) AS error " +
                 "FROM photos p WHERE p.media_type != 'video' AND p.status = 'error' AND (p.md5 IS NOT NULL AND length(p.md5)=32) AND REPLACE(p.path,'\\','/') LIKE ? " +
                 "ORDER BY p.updated_at DESC LIMIT ?"
    },
    md5_write: {
      label: '打MD5',
      countSql: "SELECT COUNT(*) c FROM photos WHERE media_type != 'video' AND md5 IS NULL AND status = 'error' AND REPLACE(path,'\\','/') LIKE ?",
      listSql:  "SELECT p.path, (SELECT error FROM process_logs WHERE path = p.path ORDER BY created_at DESC LIMIT 1) AS error " +
                 "FROM photos p WHERE p.media_type != 'video' AND p.md5 IS NULL AND p.status = 'error' AND REPLACE(p.path,'\\','/') LIKE ? " +
                 "ORDER BY p.updated_at DESC LIMIT ?"
    },
    clip_tag: {
      label: 'CLIP打标签',
      countSql: "SELECT COUNT(*) c FROM photos WHERE clip_status = 2 AND REPLACE(path,'\\','/') LIKE ?",
      listSql:  "SELECT path, '(CLIP打标签失败, clip_status=2, 无独立错误文本)' AS error FROM photos " +
                 "WHERE clip_status = 2 AND REPLACE(path,'\\','/') LIKE ? ORDER BY updated_at DESC LIMIT ?"
    },
    feat_extract: {
      label: '特征提取',
      countSql: "SELECT COUNT(*) c FROM photos WHERE feat_status = 2 AND REPLACE(path,'\\','/') LIKE ?",
      listSql:  "SELECT path, '(特征提取失败, feat_status=2, 无独立错误文本)' AS error FROM photos " +
                 "WHERE feat_status = 2 AND REPLACE(path,'\\','/') LIKE ? ORDER BY updated_at DESC LIMIT ?"
    },
    video_shots: {
      label: '视频抽帧',
      countSql: "SELECT COUNT(*) c FROM photos WHERE media_type = 'video' AND shots = -1 AND REPLACE(path,'\\','/') LIKE ?",
      listSql:  "SELECT path, video_error AS error FROM photos " +
                 "WHERE media_type = 'video' AND shots = -1 AND REPLACE(path,'\\','/') LIKE ? " +
                 "ORDER BY updated_at DESC LIMIT ?"
    }
  };

  // 若 video_error 字段没数据(旧的失败记录, 当时还没存错误文本), 兜底显示提示语
  function fallbackErr(row) { return row.error || '(无详细信息, 可能是较早失败的记录)'; }

  // GET /api/errors/summary?path=/share/Xxx  → 该目录下各功能的失败数
  app.get('/api/errors/summary', function (req, res) {
    var p = norm(req.query.path);
    if (!p) return res.status(400).json({ error: '缺少 path' });
    try {
      var db = getDb();
      var like = p + '/%';
      var out = {};
      Object.keys(FEATURES).forEach(function (k) {
        try { out[k] = db.prepare(FEATURES[k].countSql).get(like).c; }
        catch (e) { out[k] = 0; }
      });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/errors/list?path=/share/Xxx&feature=video_shots&limit=100
  app.get('/api/errors/list', function (req, res) {
    var p = norm(req.query.path);
    var feature = String(req.query.feature || '');
    if (!p) return res.status(400).json({ error: '缺少 path' });
    if (!FEATURES[feature]) return res.status(400).json({ error: '未知功能类型: ' + feature });
    try {
      var db = getDb();
      var limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '100', 10) || 100));
      var rows = db.prepare(FEATURES[feature].listSql).all(p + '/%', limit);
      rows.forEach(function (r) { r.error = fallbackErr(r); });
      res.json({ feature: feature, label: FEATURES[feature].label, count: rows.length, items: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/errors/features → 支持的功能类型列表(前端渲染顶部筛选栏用)
  app.get('/api/errors/features', function (req, res) {
    res.json(Object.keys(FEATURES).map(function (k) { return { key: k, label: FEATURES[k].label }; }));
  });

  // 供 video_thumbs.ps1 失败上报时顺便写入具体错误文本(video-ext.js 的 /api/video/fail 会调这个)
  app.locals.errorCenter = {
    recordVideoError: function (db, md5, error) {
      try {
        db.prepare("UPDATE photos SET video_error = ? WHERE md5 = ? AND media_type = 'video'")
          .run(String(error || '').slice(0, 500), md5);
      } catch (e) {}
    }
  };
};
