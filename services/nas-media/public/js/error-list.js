// error-list.js — 全库范围的错误清单(不按目录, 独立于目录树)
//
// 给管理页的"错误清单"页用: 顶部按功能类型切换, 主体是分页列表(路径+错误文本),
// 支持按路径关键词过滤。判定逻辑与 error-center.js 保持一致(同一套 FEATURES 定义,
// 这里去掉了"按目录前缀筛选"那部分, 换成分页+关键词, 服务不同的使用场景)。
//
// 挂载: try { require('./public/js/error-list.js')(app, getDb); } catch(e) { }

module.exports = function (app, getDb) {
  var FEATURES = {
    photo_process: {
      label: '图片处理',
      countSql: "SELECT COUNT(*) c FROM photos WHERE media_type != 'video' AND status = 'error' AND (md5 IS NOT NULL AND length(md5)=32)",
      listSql:  "SELECT p.path, (SELECT error FROM process_logs WHERE path = p.path ORDER BY created_at DESC LIMIT 1) AS error " +
                 "FROM photos p WHERE p.media_type != 'video' AND p.status = 'error' AND (p.md5 IS NOT NULL AND length(p.md5)=32)"
    },
    md5_write: {
      label: '打MD5',
      countSql: "SELECT COUNT(*) c FROM photos WHERE media_type != 'video' AND md5 IS NULL AND status = 'error'",
      listSql:  "SELECT p.path, (SELECT error FROM process_logs WHERE path = p.path ORDER BY created_at DESC LIMIT 1) AS error " +
                 "FROM photos p WHERE p.media_type != 'video' AND p.md5 IS NULL AND p.status = 'error'"
    },
    clip_tag: {
      label: 'CLIP打标签',
      countSql: "SELECT COUNT(*) c FROM photos WHERE clip_status = 2",
      listSql:  "SELECT path, '(CLIP打标签失败, 无独立错误文本)' AS error FROM photos WHERE clip_status = 2"
    },
    feat_extract: {
      label: '特征提取',
      countSql: "SELECT COUNT(*) c FROM photos WHERE feat_status = 2",
      listSql:  "SELECT path, '(特征提取失败, 无独立错误文本)' AS error FROM photos WHERE feat_status = 2"
    },
    video_shots: {
      label: '视频抽帧',
      countSql: "SELECT COUNT(*) c FROM photos WHERE media_type = 'video' AND shots = -1",
      listSql:  "SELECT path, video_error AS error FROM photos WHERE media_type = 'video' AND shots = -1"
    }
  };
  var ORDER = ['video_shots', 'md5_write', 'photo_process', 'clip_tag', 'feat_extract'];

  function fallbackErr(row) { return row.error || '(无详细信息, 可能是较早失败的记录)'; }

  // GET /api/errors/counts → 每种功能类型当前的失败总数(顶部按钮徽标用)
  app.get('/api/errors/counts', function (req, res) {
    try {
      var db = getDb();
      var out = {};
      ORDER.forEach(function (k) {
        out[k] = db.prepare(FEATURES[k].countSql).get().c;
      });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/errors/feed?feature=video_shots&q=关键词&offset=0&limit=50
  // 返回该功能类型的错误分页列表, 可选按路径关键词过滤
  app.get('/api/errors/feed', function (req, res) {
    var feature = String(req.query.feature || '');
    if (!FEATURES[feature]) return res.status(400).json({ error: '未知功能类型: ' + feature });

    var q = String(req.query.q || '').trim();
    var offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
    var limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));

    try {
      var db = getDb();
      var def = FEATURES[feature];
      var where = '', params = [];
      if (q) {
        where = " AND REPLACE(path,'\\','/') LIKE ? ESCAPE '\\'";
        params.push('%' + q.replace(/[\\%_]/g, '\\$&') + '%');
      }

      var countSql = 'SELECT COUNT(*) c FROM (' + def.countSql.replace('COUNT(*) c', '1 x') + where + ')';
      var total = db.prepare(countSql).get(...params).c;

      var listSql = def.listSql + where + ' ORDER BY 1 LIMIT ? OFFSET ?';
      var rows = db.prepare(listSql).all(...params, limit, offset);

      rows.forEach(function (r) { r.error = fallbackErr(r); });
      res.json({ feature: feature, label: def.label, total: total, offset: offset, limit: limit, items: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
