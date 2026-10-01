module.exports = function (app, getDb) {
  var express = require('express');

  // 2026-09-23加: 给"文件夹随机排序, 文件顺序不变"这个需求注册一个SQL自定义函数——
  // 取path最后一个'/'之前的部分当目录, 纯SQL没有REVERSE/好用的字符串函数干这个,
  // 用better-sqlite3的db.function()在JS里算最简单可靠。只在这个连接上注册一次。
  (function registerDirOf() {
    try {
      var db = getDb();
      db.function('dirof', { deterministic: true }, function (p) {
        if (!p) return '';
        var i = String(p).lastIndexOf('/');
        return i >= 0 ? p.slice(0, i) : '';
      });
    } catch (e) { /* 同名函数已注册过或db不支持, 忽略——不影响其他功能 */ }
  })();

  var _cloudCache = {};       // key: threshold -> {t, data}
  var CLOUD_TTL = 6 * 3600 * 1000;  // 2026-09-30: 5分钟->6小时(标签变动时 invalidateCloud 会主动清缓存, 不靠TTL保新鲜; 过期后的后台重算是同步的, 会卡住进程5秒). 原:5分钟 (2026-09-17: 30秒太短, 这条查询本身要8~9秒, 频繁后台重算意义不大, 见下方说明)
  function invalidateCloud() { _cloudCache = {}; }

  // 目录列表缓存(videoer目录树的数据源, 全表scan+JS里按路径分桶, 比较重)。
  // 用 MAX(id) 当便宜的"版本号": 只要photos表有新增, id就会变, 缓存就失效重算;
  // 没新增就直接回放, 跳过整表scan。
  var _dirsCache = {};       // key: mediaType|depth -> {version, data}

  // 照片/视频列表缓存(带标签/收藏/评分筛选那条, 实测标签搜索单次能到1秒+, 缓存命中几毫秒)。
  // 版本号是三张表各自的一个便宜信号拼起来: 有照片入库/标签变化/收藏评分变化任一发生就失效。
  var _listCache = {};       // key: 完整query参数 -> {version, data}
  var _LIST_CACHE_MAX = 500;
  function _listVersion(db) {
    var a = db.prepare('SELECT MAX(id) v FROM photos').get().v || 0;
    var b = db.prepare('SELECT MAX(rowid) v FROM photo_tags').get().v || 0;
    var c = db.prepare('SELECT MAX(updated_at) v FROM photo_marks').get().v || 0;
    // 2026-09-30: 加上写入计数, 照片状态/缩略图/路径变化(不改 MAX(id))也让缓存失效, 否则列表会一直是旧数据
    var d = db.prepare('SELECT total_changes() c').get().c;
    var e = 0; try { e = db.pragma('data_version', { simple: true }); } catch (x) {}
    return a + '|' + b + '|' + c + '|' + d + '|' + e;
  }

  function normalize(rows) {
    // manual恒为1; AI标签按该图AI最高分归一化
    var aiTop = 0;
    rows.forEach(function (r) { if (r.source !== 'manual' && r.score > aiTop) aiTop = r.score; });
    rows.forEach(function (r) {
      r.nscore = r.source === 'manual' ? 1 : (aiTop > 0 ? Math.round(r.score / aiTop * 1000) / 1000 : 0);
    });
    return rows;
  }

  // 单张: 按md5查全部标签(按source分组)
  app.get('/api/photo-tags', function (req, res) {
    var md5 = req.query.md5;
    if (!md5) return res.status(400).json({ error: '缺少md5' });
    try {
      var rows = getDb().prepare(
        "SELECT tag, score, source FROM photo_tags WHERE md5=? ORDER BY source, score DESC"
      ).all(md5);
      res.json({ md5: md5, tags: normalize(rows) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 批量: 网格缩略图用, 一次查多个md5
  app.post('/api/photo-tags/batch', express.json({ limit: '2mb' }), function (req, res) {
    var md5s = (req.body && req.body.md5s) || [];
    if (!Array.isArray(md5s) || !md5s.length) return res.json({});
    md5s = md5s.slice(0, 500);
    try {
      var db = getDb();
      var out = {};
      var q = db.prepare("SELECT tag, score, source FROM photo_tags WHERE md5=? ORDER BY source, score DESC");
      md5s.forEach(function (m) {
        if (!m) return;
        out[m] = normalize(q.all(m));
      });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 添加manual标签
  app.post('/api/photo-tags/add', express.json(), function (req, res) {
    var b = req.body || {};
    if (!b.md5 || !b.tag) return res.status(400).json({ error: '缺少md5或tag' });
    var tag = String(b.tag).trim();
    if (!tag) return res.status(400).json({ error: 'tag为空' });
    try {
      var db = getDb();
      var exists = db.prepare("SELECT 1 FROM photo_tags WHERE md5=? AND tag=? AND source='manual'").get(b.md5, tag);
      if (!exists) {
        db.prepare("INSERT INTO photo_tags (md5, tag, score, source) VALUES (?,?,1,'manual')").run(b.md5, tag);
      }
      invalidateCloud();
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 删除标签(任意source)
  app.post('/api/photo-tags/delete', express.json(), function (req, res) {
    var b = req.body || {};
    if (!b.md5 || !b.tag) return res.status(400).json({ error: '缺少md5或tag' });
    try {
      var db = getDb();
      var n;
      if (b.source) n = db.prepare("DELETE FROM photo_tags WHERE md5=? AND tag=? AND source=?").run(b.md5, b.tag, b.source);
      else n = db.prepare("DELETE FROM photo_tags WHERE md5=? AND tag=?").run(b.md5, b.tag);
      invalidateCloud();
      res.json({ ok: true, deleted: n.changes });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 标签云统计: threshold(0~1)按每图归一化分过滤AI标签, manual恒计入
  // mediaType=photo|video 可选, 只统计该媒体类型下出现过的标签(避免视频页看到照片专属标签)
  // manualOnly=1 时只统计手动标签(source='manual'), 忽略AI标签和threshold
  // 这条查询要在59.7万行photo_tags上扫好几遍(tops物化+主扫描+60万次EXISTS子查询),
  // 单次实测冷启动要8~9秒 —— better-sqlite3是同步的, 会把nas-media整个进程卡住8~9秒,
  // 期间所有其他接口(缩略图/视频流/目录列表...)全部排队等它。之前用固定30秒TTL,
  // 只要两次打开viewer间隔超过30秒就会重新触发这个卡顿, 这正是"viewer老是慢"的根因。
  // 改成stale-while-revalidate: 只要有缓存(哪怕过期)就立刻原样返回, 重算放到
  // setImmediate里后台跑, 跑完再悄悄换缓存。只有从未算过(冷启动)那一次才会同步等。
  function _computeCloud(mediaType, th, manualOnly) {
    var db = getDb();
    var mtClause = mediaType ? " AND px.media_type = @mediaType" : "";
    var sourceClause = manualOnly
      ? "t.source = 'manual'"
      : "(t.source = 'manual' OR (tops.top > 0 AND t.score >= tops.top * @th))";
    return db.prepare(
      "WITH tops AS (SELECT md5, MAX(score) top FROM photo_tags WHERE source != 'manual' GROUP BY md5) " +
      "SELECT t.tag, COUNT(DISTINCT t.md5) cnt FROM photo_tags t " +
      "LEFT JOIN tops ON tops.md5 = t.md5 " +
      "WHERE EXISTS (SELECT 1 FROM photos px WHERE px.md5 = t.md5" + mtClause + ") " +
      "AND " + sourceClause + " " +
      "GROUP BY t.tag ORDER BY cnt DESC LIMIT 100"
    ).all({ mediaType: mediaType, th: th });
  }

  // 2026-09-30: 启动后90秒(没人用的时候)预热默认标签云, 避免用户第一次打开viewer时同步等5秒
  setTimeout(function () {
    try { var k = '0||0'; if (!_cloudCache[k]) _cloudCache[k] = { t: Date.now(), data: _computeCloud('', 0, false) }; console.log('[photo-tags] 标签云已预热'); } catch (e) { console.log('[photo-tags] 预热失败:', e.message); }
  }, 90000).unref();

  app.get('/api/photo-tags/cloud', function (req, res) {
    var th = Math.max(0, Math.min(1, parseFloat(req.query.threshold || '0') || 0));
    var mediaType = String(req.query.mediaType || '').trim();
    if (mediaType !== 'photo' && mediaType !== 'video') mediaType = '';
    var manualOnly = req.query.manualOnly === '1';
    var ck = th + '|' + mediaType + '|' + (manualOnly ? 1 : 0);
    var hit = _cloudCache[ck];
    if (hit) {
      res.json(hit.data);
      if (!hit.refreshing && (Date.now() - hit.t) >= CLOUD_TTL) {
        hit.refreshing = true;
        setImmediate(function () {
          try {
            _cloudCache[ck] = { t: Date.now(), data: _computeCloud(mediaType, th, manualOnly) };
          } catch (e) { hit.refreshing = false; }
        });
      }
      return;
    }
    try {
      var rows = _computeCloud(mediaType, th, manualOnly);
      _cloudCache[ck] = { t: Date.now(), data: rows };
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // media_type 字段是否存在(缓存, 避免每次查询都 PRAGMA)
  var _mtChecked = false, _mtExists = false;
  function _hasMediaType() {
    if (_mtChecked) return _mtExists;
    try {
      _mtExists = getDb().prepare('PRAGMA table_info(photos)').all()
                    .some(function (c) { return c.name === 'media_type'; });
    } catch (e) { _mtExists = false; }
    _mtChecked = true;
    return _mtExists;
  }

  // 筛选照片: 标签(and/or+阈值, 可仅手动标签) / 收藏 / 评分区间 / 目录 / 文件名 / 文件夹名 /
  //           文件大小区间 / 时长区间(视频) / 媒体类型 / 分页
  // 条件均为可选, 但至少要有一个, 否则拒绝(防全表扫描)
  // 参数: tags= mode=and|or threshold= manualOnly=1 favorite=1 minRating=1-10 maxRating=1-10
  //       dirPath= fileName= folderName= minSize= maxSize= minDuration= maxDuration= page= limit=
  app.get('/api/photo-tags/photos', function (req, res) {
    try {
      var db = getDb();
      var _cacheKey = JSON.stringify(req.query);
      var _version  = _listVersion(db);
      var _cached   = _listCache[_cacheKey];
      if (_cached && _cached.version === _version) return res.json(_cached.data);

      var tags = String(req.query.tags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      var mode = req.query.mode === 'and' ? 'and' : 'or';
      var th = Math.max(0, Math.min(1, parseFloat(req.query.threshold || '0') || 0));
      var manualOnly = req.query.manualOnly === '1';
      var page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
      var limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
      var fav = req.query.favorite === '1';

      var minR = parseInt(req.query.minRating || '0', 10) || 0;
      var maxR = parseInt(req.query.maxRating || '0', 10) || 0;
      if (minR < 0) minR = 0; if (minR > 10) minR = 10;
      if (maxR < 0) maxR = 0; if (maxR > 10) maxR = 10;

      var dirPath = req.query.dirPath ? String(req.query.dirPath).replace(/\\/g, '/') : null;

      // ratings=8,9 精确匹配若干分值(多选), 与 minRating/maxRating 区间可并用
      var ratings = String(req.query.ratings || '').split(',')
        .map(function (x) { return parseInt(x, 10); })
        .filter(function (x, i, a) { return x >= 1 && x <= 10 && a.indexOf(x) === i; });

      // mediaType=photo|video 区分照片与视频; 缺省不限
      var mediaType = String(req.query.mediaType || '').trim();
      if (mediaType !== 'photo' && mediaType !== 'video') mediaType = '';

      // q: 文件名/路径关键词(整条路径模糊匹配)
      var q = String(req.query.q || '').trim();

      // fileName/folderName: 分别只匹配最后一段(文件名)或之前的目录段
      var fileName   = String(req.query.fileName   || '').trim();
      var folderName = String(req.query.folderName || '').trim();

      // 文件大小区间(字节), 时长区间(秒, 主要用于视频)
      var minSize = parseInt(req.query.minSize || '0', 10) || 0;
      var maxSize = parseInt(req.query.maxSize || '0', 10) || 0;
      var minDur  = parseInt(req.query.minDuration || '0', 10) || 0;
      var maxDur  = parseInt(req.query.maxDuration || '0', 10) || 0;
      if (minSize < 0) minSize = 0; if (maxSize < 0) maxSize = 0;
      if (minDur  < 0) minDur  = 0; if (maxDur  < 0) maxDur  = 0;

      // 分辨率下限/上限(像素宽度, 2026-08-13加): 前端只能从 /api/video/resolution-buckets
      // 返回的真实存在的档位里选, 不接受任意输入
      var minWidth = parseInt(req.query.minWidth || '0', 10) || 0;
      var maxWidth = parseInt(req.query.maxWidth || '0', 10) || 0;
      if (minWidth < 0) minWidth = 0; if (maxWidth < 0) maxWidth = 0;

      // 日期区间(mtime, 秒级时间戳, 2026-08-13加)
      var minDate = parseInt(req.query.minDate || '0', 10) || 0;
      var maxDate = parseInt(req.query.maxDate || '0', 10) || 0;
      if (minDate < 0) minDate = 0; if (maxDate < 0) maxDate = 0;

      // 播放历史(2026-08-13加): watchedOnly=1 只看看过的; sortBy=watched 按最近观看时间倒序
      var watchedOnly = req.query.watchedOnly === '1';
      var sortBy = String(req.query.sortBy || '');

      if (!tags.length && !fav && !minR && !maxR && !ratings.length && !dirPath && !mediaType &&
          !q && !fileName && !folderName && !minSize && !maxSize && !minDur && !maxDur &&
          !minWidth && !maxWidth && !minDate && !maxDate && !watchedOnly) {
        return res.status(400).json({ error: '至少需要 tags / favorite / ratings / minRating / maxRating / dirPath / fileName / folderName / minSize / maxSize / minDuration / maxDuration / minWidth / maxWidth / minDate / maxDate / watchedOnly / mediaType 之一' });
      }

      var clauses = [];
      var params = [];
      // 标记过待删(pending_delete=1)的一律排除, 不在这个正常浏览接口里出现——
      // 待删列表单独走 /api/photos/trash-list 查看(见soft-delete.js)
      clauses.push("(p.pending_delete IS NULL OR p.pending_delete = 0)");

      // ① 标签条件(manualOnly=1 时只认手动标签, 不叠加AI阈值判定)
      if (tags.length) {
        var ph = tags.map(function () { return '?'; }).join(',');
        var sub;
        if (manualOnly) {
          sub =
            "SELECT t.md5 FROM photo_tags t " +
            "WHERE t.tag IN (" + ph + ") AND t.source = 'manual' " +
            "GROUP BY t.md5" + (mode === 'and' ? " HAVING COUNT(DISTINCT t.tag) = " + tags.length : "");
          clauses.push("p.md5 IN (" + sub + ")");
          params = params.concat(tags);
        } else {
          // 2026-08-23: 原来用 LEFT JOIN 一张"全表按md5分组算AI最高分"的派生表(tp),
          // 这张派生表跟搜的是哪个标签完全无关, 每次搜索都要重新算一遍将近60万行
          // (source!='manual'几乎覆盖全表), 实测单这一步就要850ms。改成对每条命中的
          // 标签行单独查一次它自己的AI最高分(走 idx_pt_md5_source_score 索引, 单条很快),
          // 命中的标签行通常远少于全表, 实测同结果集下从1.1秒降到724ms。
          sub =
            "SELECT t.md5 FROM photo_tags t " +
            "WHERE t.tag IN (" + ph + ") AND (t.source='manual' OR t.score >= " +
            "(SELECT MAX(score) FROM photo_tags WHERE md5 = t.md5 AND source != 'manual') * ?) " +
            "GROUP BY t.md5" + (mode === 'and' ? " HAVING COUNT(DISTINCT t.tag) = " + tags.length : "");
          clauses.push("p.md5 IN (" + sub + ")");
          params = params.concat(tags);
          params.push(th);
        }
      }

      // ② 收藏 / 评分条件(走 photo_marks 索引, 不扫 photos 全表)
      if (fav || minR || maxR || ratings.length) {
        var mw = [];
        if (fav) mw.push("m.favorite=1");
        if (ratings.length) {
          var rph = ratings.map(function () { return '?'; }).join(',');
          mw.push("m.rating IN (" + rph + ")");
          params = params.concat(ratings);
        }
        if (minR || maxR) {
          mw.push("m.rating > 0");            // rating=0 视为未评分, 不参与区间筛选
          if (minR) { mw.push("m.rating >= ?"); params.push(minR); }
          if (maxR) { mw.push("m.rating <= ?"); params.push(maxR); }
        }
        clauses.push("p.md5 IN (SELECT m.md5 FROM photo_marks m WHERE " + mw.join(" AND ") + ")");
      }

      // ③ 媒体类型 (media_type 字段可能尚未建立, 建立前一律视为照片)
      if (mediaType) {
        if (_hasMediaType()) {
          clauses.push("p.media_type = ?");
          params.push(mediaType);
        } else if (mediaType === 'video') {
          clauses.push("1 = 0");     // 字段还没建, 必然没有视频
        }
      }

      // ④ 目录条件(精确前缀, 配合目录树点选)
      if (dirPath) {
        clauses.push("REPLACE(p.path,'\\','/') LIKE ?");
        params.push(dirPath + '/%');
      }

      // ⑤ 关键词(整条路径模糊匹配)
      if (q) {
        clauses.push("p.path LIKE ? ESCAPE '\\'");
        params.push('%' + q.replace(/[\\%_]/g, '\\$&') + '%');
      }

      // ⑤b 文件名(支持空格分隔多关键词, 2026-08-13升级): 每个词都要求"命中位置之后
      // 不能再出现/", fileNameMode=and(默认, 都要有)|or(任一即可)
      //     (极少数"文件夹名和文件名恰好用了同一个词"的场景会有轻微误差, 可接受)
      if (fileName) {
        var fnWords = fileName.trim().split(/\s+/).filter(Boolean);
        var fnMode = req.query.fileNameMode === 'or' ? 'or' : 'and';
        var fnConds = fnWords.map(function (w) {
          var esc = w.replace(/[\\%_]/g, '\\$&');
          params.push('%' + esc + '%', '%' + esc + '%/%');
          return "(REPLACE(p.path,'\\','/') LIKE ? ESCAPE '\\' AND REPLACE(p.path,'\\','/') NOT LIKE ? ESCAPE '\\')";
        });
        if (fnConds.length) clauses.push('(' + fnConds.join(fnMode === 'or' ? ' OR ' : ' AND ') + ')');
      }

      // ⑤c 文件夹名(支持空格分隔多关键词, 2026-08-13升级): 每个词都要求"命中位置之后
      // 必须还有/", folderNameMode=and(默认)|or
      if (folderName) {
        var dnWords = folderName.trim().split(/\s+/).filter(Boolean);
        var dnMode = req.query.folderNameMode === 'or' ? 'or' : 'and';
        var dnConds = dnWords.map(function (w) {
          var esc = w.replace(/[\\%_]/g, '\\$&');
          params.push('%' + esc + '%/%');
          return "REPLACE(p.path,'\\','/') LIKE ? ESCAPE '\\'";
        });
        if (dnConds.length) clauses.push('(' + dnConds.join(dnMode === 'or' ? ' OR ' : ' AND ') + ')');
      }

      // ⑤d 文件大小区间(字节)
      if (minSize) { clauses.push("p.size >= ?"); params.push(minSize); }
      if (maxSize) { clauses.push("p.size <= ?"); params.push(maxSize); }

      // ⑤e 时长区间(秒, 主要用于视频; 照片/未抽取时长的记录 duration 为空, 天然不命中)
      if (minDur) { clauses.push("p.duration >= ?"); params.push(minDur); }
      if (maxDur) { clauses.push("p.duration <= ?"); params.push(maxDur); }

      // ⑤f 分辨率区间(像素宽度; 未探测出宽高的记录 width 为0/空, 天然不命中)
      if (minWidth) { clauses.push("p.width >= ?"); params.push(minWidth); }
      if (maxWidth) { clauses.push("p.width <= ?"); params.push(maxWidth); }

      // ⑤f2 图片方向(2026-10-01): orient=landscape(横图 宽>高5%以上)|portrait(竖图)|square(方图 宽高相差5%以内); 宽高缺失的不命中
      var orient = String(req.query.orient || '');
      if (orient === 'landscape') clauses.push("p.width > p.height * 1.05");
      else if (orient === 'portrait') clauses.push("p.height > p.width * 1.05");
      else if (orient === 'square') clauses.push("p.width > 0 AND p.height > 0 AND p.width <= p.height * 1.05 AND p.height <= p.width * 1.05");
      // ⑤f3 格式(扩展名), ext=jpg,png,webp (jpg 同时包含 jpeg; tif 同时包含 tiff)
      var extList = [];
      String(req.query.ext || '').split(',').forEach(function (x) {
        x = x.trim().toLowerCase().replace(/^\./, '');
        if (!/^[a-z0-9]{1,5}$/.test(x)) return;
        extList.push(x); if (x === 'jpg') extList.push('jpeg'); if (x === 'tif') extList.push('tiff');
      });
      if (extList.length) { clauses.push('(' + extList.map(function () { return "LOWER(p.path) LIKE ?"; }).join(' OR ') + ')'); extList.forEach(function (x) { params.push('%.' + x); }); }
      // ⑤f4 相机型号(包含匹配) / 有无 GPS 定位
      var camera = String(req.query.camera || '').trim();
      if (camera) { clauses.push("p.exif_camera LIKE ? ESCAPE '\\'"); params.push('%' + camera.replace(/[\\%_]/g, function (m) { return '\\' + m; }) + '%'); }
      if (req.query.hasGps === '1') clauses.push("p.exif_gps IS NOT NULL AND p.exif_gps != '' AND p.exif_gps != 'null'");
      else if (req.query.hasGps === '0') clauses.push("(p.exif_gps IS NULL OR p.exif_gps = '' OR p.exif_gps = 'null')");

      // ⑤g 日期区间(2026-08-20改: 照片优先用EXIF拍摄时间exif_time, 跟侧边栏按年月分组、
      // 不带标签时的/api/photos保持同一套时间口径; 视频没有exif_time,退回video_created_at;
      // 两者都没有的再退回mtime兜底)
      if (minDate) { clauses.push("COALESCE(p.exif_time, p.video_created_at, p.mtime) >= ?"); params.push(minDate); }
      if (maxDate) { clauses.push("COALESCE(p.exif_time, p.video_created_at, p.mtime) <= ?"); params.push(maxDate); }

      // ⑤h 只看播放过的(2026-08-13加)
      if (watchedOnly) {
        clauses.push("p.md5 IN (SELECT md5 FROM photo_marks WHERE last_watched_at > 0)");
      }

      // ⑥ 成人/家庭分类. category=adult|family|both(缺省=both, 不筛选)
      //    依赖 dir-category.js 挂载后暴露的 app.locals.dirCategory, 未挂载时静默跳过筛选
      var category = String(req.query.category || 'both');
      if ((category === 'adult' || category === 'family') && app.locals.dirCategory) {
        var fc = app.locals.dirCategory.familyWhereClause(db, 'p');
        if (category === 'family') {
          clauses.push(fc.sql);
        } else {
          clauses.push('NOT ' + fc.sql);
        }
        params = params.concat(fc.params);
      }

      // ⑥ 随机排序: 带 seed 时用固定种子的伪随机顺序(同种子翻页不重不漏),
      //    不带 seed 时保持原来的时间倒序; 带 dirSeed 时是"文件夹随机、文件夹内顺序不变"
      var seed = parseInt(req.query.seed || '0', 10);
      var dirSeed = parseInt(req.query.dirSeed || '0', 10);
      // 两个独立的乘法哈希做异或混合, 确保不同 seed 得到真正不同的顺序。
      // SQLite 没有原生 ^ 运算符, 用 (a|b) & ~(a&b) 手工组出异或。
      // (只做加法平移在小数据集上几乎不产生取模绕圈, 顺序会和不加时几乎一样, 已踩过这个坑)
      var SORT_FIELD_MAP = { date: 'p.mtime', name: 'p.path', size: 'p.size', duration: 'p.duration', resolution: 'NULLIF(p.width, 0)', ratio: '(CAST(NULLIF(p.width, 0) AS REAL) / NULLIF(p.height, 0))' };   // ratio=宽高比(竖图<1<横图), 2026-10-01 加
      var sortFieldsRaw = String(req.query.sortFields || '').trim();
      var customOrderBy = '';
      if (sortFieldsRaw) {
        var _pieces = [];
        sortFieldsRaw.split(',').forEach(function (part) {
          var m = part.trim().split(':');
          var col = SORT_FIELD_MAP[m[0]];
          if (!col) return;   // 白名单校验, 不认识的字段名直接忽略, 防SQL注入
          var dir = (m[1] === 'asc') ? 'ASC' : 'DESC';
          _pieces.push(col + ' IS NULL', col + ' ' + dir);   // 2026-10-01: 没有这个信息(NULL/0)的一律排最后, 升序时也不会跑到最前面
        });
        if (_pieces.length) customOrderBy = _pieces.join(', ');
      }

      var orderBy = 'p.exif_time DESC, p.mtime DESC';
      // 2026-10-01: order=asc 时间正序(旧→新); 没有拍摄时间的排最后(SQLite 里 NULL 默认最小, 直接 ASC 会把它们全排到最前面)
      if (String(req.query.order || '') === 'asc') orderBy = 'p.exif_time IS NULL, p.exif_time ASC, p.mtime ASC';
      if (customOrderBy) {
        // 2026-08-13: 级联排序(拖拽排序按钮决定优先级), 优先级高于其他排序方式
        orderBy = customOrderBy;
      } else if (sortBy === 'watched') {
        // 2026-08-13: 按最近观看时间倒序; 用子查询取 last_watched_at, 没记录的(NULL)排最后
        orderBy = "(SELECT last_watched_at FROM photo_marks WHERE photo_marks.md5 = p.md5) DESC";
      } else if (seed) {
        // 先各自乘大质数再对一个大质数取模打散分布, 避免小范围 id 呈现明显的分块规律,
        // 再异或混合两路, 让不同 seed 产出明显不同的顺序
        var A = "((p.id * 2654435761) % 999999937)";
        var B = "((p.id * " + (1000003 + (seed % 999983)) + " + " + seed + ") % 999999937)";
        orderBy = "((" + A + "|" + B + ") & ~(" + A + "&" + B + "))";
      } else if (dirSeed) {
        // 2026-09-23加: 文件夹随机排序, 文件夹内部保持原顺序——不然默认按时间倒序,
        // 每次打开总是先看到同一批最新照片, 老是那几张。取"同一目录里最小的id"作为
        // 这个目录的代表值, 目录内所有照片都用这同一个代表值算哈希(所以会被排到一起,
        // 相当于整个目录当一个单位参与随机排序), 目录内部再按path正常升序排(文件顺序不变)。
        var dirRep = "(MIN(p.id) OVER (PARTITION BY dirof(p.path)))";
        var dA = "((" + dirRep + " * 2654435761) % 999999937)";
        var dB = "((" + dirRep + " * " + (1000003 + (dirSeed % 999983)) + " + " + dirSeed + ") % 999999937)";
        orderBy = "((" + dA + "|" + dB + ") & ~(" + dA + "&" + dB + ")), p.path ASC";
      }

      var where = clauses.join(" AND ");

      // 2026-08-23: 原来count和取数据是两条独立查询, 各自把"where+按md5去重"这套逻辑
      // (标签命中的话, 这套逻辑本身就不便宜)重新跑一遍。改成一条CTE, 用MATERIALIZED
      // 强制只算一次候选集, count和实际数据都从这份候选集复用, 实测同样结果集下从
      // 2秒降到1.1秒左右。翻页翻到超出范围时(这份候选集非空但当前页LIMIT/OFFSET拿不到行)
      // 拿不到_total字段, 兜底单独查一次(这种情况很少见, 不影响正常路径速度)。
      var matchedCte = "matched AS MATERIALIZED (SELECT MIN(id) id FROM photos p WHERE " + where + " GROUP BY p.md5)";
      var rows = db.prepare(
        "WITH " + matchedCte + " SELECT p.*, (SELECT COUNT(*) FROM matched) as _total " +
        "FROM photos p JOIN matched m ON m.id = p.id " +
        "ORDER BY " + orderBy + " LIMIT ? OFFSET ?"
      ).all(...params, limit, (page - 1) * limit);

      var total;
      if (rows.length) {
        total = rows[0]._total;
        rows.forEach(function (r) { delete r._total; });
      } else {
        total = db.prepare(
          "SELECT COUNT(*) c FROM (SELECT MIN(id) id FROM photos p WHERE " + where + " GROUP BY p.md5)"
        ).get(...params).c;
      }

      // 附带本页的收藏/评分, 省一次往返
      var marks = {};
      var pageMd5 = rows.map(function (r) { return r.md5; }).filter(Boolean);
      if (pageMd5.length) {
        var mph = pageMd5.map(function () { return '?'; }).join(',');
        db.prepare("SELECT md5, favorite, rating FROM photo_marks WHERE md5 IN (" + mph + ")")
          .all(...pageMd5)
          .forEach(function (m) { marks[m.md5] = m; });
      }

      rows.forEach(function (r) {
        try { r.ai_tags = JSON.parse(r.ai_tags || '[]'); } catch (e) { r.ai_tags = []; }
        try { r.user_tags = JSON.parse(r.user_tags || '[]'); } catch (e) { r.user_tags = []; }
        var m = marks[r.md5];
        r.favorite = m ? m.favorite === 1 : (r.favorite === 1);
        r.rating = m ? m.rating : 0;
      });
      var _result = { photos: rows, total: total, page: page, hasMore: page * limit < total };
      if (Object.keys(_listCache).length >= _LIST_CACHE_MAX) _listCache = {};
      _listCache[_cacheKey] = { version: _version, data: _result };
      res.json(_result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 目录列表: 按 media_type 统计各目录文件数
  // GET /api/photo-tags/dirs?mediaType=video&depth=2
  // 离当前目录最近的"下一个/上一个"有内容的目录(播放到头自动接着播用, 图片/视频通用)。
  // 顺序 = 路径字节序(与"文件名顺序"排序一致); next 跳过 path 整棵子树; 限定在同一个根(/share/Xxx)内; 只算没进回收站、符合分类的记录。
  app.get('/api/photo-tags/dir-neighbor', function (req, res) {
    try {
      var db = getDb();
      var mt = String(req.query.media || 'photo') === 'video' ? 'video' : 'photo';
      var scope = String(req.query.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
      var m = scope.match(/^\/share\/[^\/]+/);
      if (!m) return res.json({ dir: null });
      var root = m[0];
      var next = String(req.query.dir || 'next') !== 'prev';
      var cat = String(req.query.category || '');
      var cs = '', cp = [];
      if (cat === 'family' || cat === 'adult') {
        var fc = app.locals.dirCategory.familyWhereClause(db, 'photos');
        cs = (cat === 'family' ? ' AND ' : ' AND NOT ') + fc.sql; cp = fc.params;
      }
      var base = "SELECT path FROM photos INDEXED BY idx_photos_path WHERE media_type = ? AND (pending_delete IS NULL OR pending_delete = 0) AND path >= ? AND path < ?" + cs;
      var row = next
        ? db.prepare(base + " ORDER BY path ASC LIMIT 1").get(mt, scope + '0', root + '0', ...cp)
        : db.prepare(base + " ORDER BY path DESC LIMIT 1").get(mt, root + '/', scope + '/', ...cp);
      res.json({ dir: row ? row.path.replace(/\/[^\/]+$/, '') : null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 相机型号列表(带数量, 筛选面板的下拉提示用), 内存缓存10分钟
  var _camCache = {};
  app.get('/api/photo-tags/cameras', function (req, res) {
    try {
      var mt = String(req.query.mediaType || 'photo') === 'video' ? 'video' : 'photo';
      var c = _camCache[mt];
      if (c && Date.now() - c.t < 600000) return res.json(c.data);
      var data = getDb().prepare("SELECT exif_camera AS name, COUNT(*) AS n FROM photos WHERE media_type = ? AND exif_camera IS NOT NULL AND exif_camera != '' GROUP BY exif_camera ORDER BY n DESC LIMIT 60").all(mt);
      _camCache[mt] = { t: Date.now(), data: data };
      res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/photo-tags/dirs', function (req, res) {
    try {
      var db = getDb();
      var mt = String(req.query.mediaType || '').trim();
      if (mt !== 'photo' && mt !== 'video') mt = '';
      var depth = Math.max(1, Math.min(6, parseInt(req.query.depth || '4', 10) || 4));

      var cacheKey = mt + '|' + depth;
      var version = db.prepare('SELECT MAX(id) v FROM photos').get().v || 0;
      var cached = _dirsCache[cacheKey];
      if (cached && cached.version === version) return res.json(cached.data);

      var where = '1=1', params = [];
      if (mt) {
        if (_hasMediaType()) { where = 'media_type = ?'; params.push(mt); }
        else if (mt === 'video') return res.json([]);
      }
      var rows = db.prepare('SELECT path FROM photos WHERE ' + where).all.apply(
        db.prepare('SELECT path FROM photos WHERE ' + where), params);

      var cnt = {};
      rows.forEach(function (r) {
        var parts = String(r.path || '').replace(/\\/g, '/').split('/').filter(Boolean);
        parts.pop();                       // 去掉文件名
        if (!parts.length) return;
        var take = parts.slice(0, depth);
        var d = '/' + take.join('/');
        cnt[d] = (cnt[d] || 0) + 1;
      });

      var out = Object.keys(cnt).map(function (d) { return { dir: d, count: cnt[d] }; });
      out.sort(function (a, b) { return a.dir < b.dir ? -1 : 1; });
      _dirsCache[cacheKey] = { version: version, data: out };
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('[photo-tags] 初始化完成 (v5: +mediaType/q/dirs)');
};
