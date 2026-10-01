// error-center-dirs.js — 按功能类型返回原始失败路径列表, 供前端自己做目录归类
//
// 原设计是 POST /api/errors/by-dirs, 客户端把几千个候选目录路径塞进请求体让后端归类,
// 结果撞上了 TS 核心里全局 app.use(express.json()) 的默认 100KB 限制(这是冻结区,
// 改不了, 而且这个全局中间件在路由自己的 json() 中间件之前就已经处理了请求体,
// 路由自己设的 limit 完全没机会生效)。
//
// 改法: 后端只返回"每种功能类型下所有失败文件的路径"这一份不太大的列表(不用传
// 几千个目录进来), 前端本来就已经把全部目录路径加载在内存里了(/api/nas/all-dirs
// 拿到的那份), 由前端自己做"最长前缀匹配"把每条错误路径归到对应目录。
//
// 挂载: try { require('./public/js/error-center-dirs.js')(app, getDb); } catch(e) { }

module.exports = function (app, getDb) {
  var ALL_FEATURES = ['photo_process', 'md5_write', 'clip_tag', 'feat_extract', 'video_shots'];

  var QUERIES = {
    photo_process: "SELECT REPLACE(p.path,'\\','/') AS path FROM photos p WHERE p.media_type != 'video' AND p.status = 'error' AND (p.md5 IS NOT NULL AND length(p.md5)=32)",
    md5_write:     "SELECT REPLACE(path,'\\','/') AS path FROM photos WHERE media_type != 'video' AND md5 IS NULL AND status = 'error'",
    clip_tag:      "SELECT REPLACE(path,'\\','/') AS path FROM photos WHERE clip_status = 2",
    feat_extract:  "SELECT REPLACE(path,'\\','/') AS path FROM photos WHERE feat_status = 2",
    video_shots:   "SELECT REPLACE(path,'\\','/') AS path FROM photos WHERE media_type = 'video' AND shots = -1"
  };

  // GET /api/errors/raw-paths?features=video_shots,md5_write
  // 返回 { video_shots: ["/share/a/x.mp4", ...], md5_write: [...] }
  // features 缺省时返回全部5种
  app.get('/api/errors/raw-paths', function (req, res) {
    var qFeat = String(req.query.features || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var features = qFeat.length
      ? qFeat.filter(function (f) { return ALL_FEATURES.indexOf(f) >= 0; })
      : ALL_FEATURES;

    try {
      var db = getDb();
      var out = {};
      features.forEach(function (feat) {
        out[feat] = db.prepare(QUERIES[feat]).all().map(function (r) { return r.path; });
      });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
