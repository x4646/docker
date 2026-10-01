// video-ext.js — 视频缩略图静态服务 + 抽帧任务队列 + 元数据接收
//
// 架构: NAS 只做排队与存储, 抽帧在 PC 上跑(与 clip_service 同构)
//       PC 直接把 jpg 写到 项目目录(PROJECT_DIR环境变量)\vthumbs\ (= 本机 VTHUMB_DIR),
//       走 SMB, 不需要 HTTP 上传大文件
//
// 缩略图命名: <md5前2位>/<md5>_01.jpg ... _10.jpg
//             分 256 个子目录, 避免单目录 9 万多文件拖慢文件系统
//
// 挂载: try { require('./public/js/video-ext.js')(app, getDb); } catch(e) { }

module.exports = function (app, getDb) {
  var express = require('express');
  var fs      = require('fs');
  var path    = require('path');

  var vk = require('./video-key.js');
  var VTHUMB_DIR = (process.env.PROJECT_DIR || '/share/Container/docker/services/nas-media') + '/vthumbs';

  // ── 初始化: 建目录 + 补字段 ──────────────────────────
  (function init() {
    try { fs.mkdirSync(VTHUMB_DIR, { recursive: true }); } catch (e) {}

    var db = getDb();
    var cols = db.prepare('PRAGMA table_info(photos)').all().map(function (c) { return c.name; });

    // duration 秒; shots 已生成的缩略图张数(0=未处理, -1=失败); vcodec 编码
    if (cols.indexOf('duration') < 0) {
      db.exec('ALTER TABLE photos ADD COLUMN duration INTEGER DEFAULT 0');
      console.log('[video] 已添加 duration 字段');
    }
    if (cols.indexOf('shots') < 0) {
      db.exec('ALTER TABLE photos ADD COLUMN shots INTEGER DEFAULT 0');
      db.exec('CREATE INDEX IF NOT EXISTS idx_photos_shots ON photos(shots)');
      console.log('[video] 已添加 shots 字段');
    }
    if (cols.indexOf('vcodec') < 0) {
      db.exec('ALTER TABLE photos ADD COLUMN vcodec TEXT');
      console.log('[video] 已添加 vcodec 字段');
    }
    // dts完整性巡检用(2026-08-13加): dts_checked=0待查/1已查; dts_bad=0正常/1有问题; dts_error=具体报错文本
    if (cols.indexOf('dts_checked') < 0) {
      db.exec('ALTER TABLE photos ADD COLUMN dts_checked INTEGER DEFAULT 0');
      db.exec('CREATE INDEX IF NOT EXISTS idx_photos_dts_checked ON photos(dts_checked)');
      console.log('[video] 已添加 dts_checked 字段');
    }
    if (cols.indexOf('dts_bad') < 0) {
      db.exec('ALTER TABLE photos ADD COLUMN dts_bad INTEGER DEFAULT 0');
      console.log('[video] 已添加 dts_bad 字段');
    }
    if (cols.indexOf('dts_error') < 0) {
      db.exec('ALTER TABLE photos ADD COLUMN dts_error TEXT');
      console.log('[video] 已添加 dts_error 字段');
    }
    console.log('[video-ext] 初始化完成 (v3: +目录级操作), 缩略图目录:', VTHUMB_DIR);
  })();

  // ── 静态服务 ────────────────────────────────────────
  app.use('/vthumbs', express.static(VTHUMB_DIR, {
    maxAge: '30d',
    fallthrough: true
  }));

  var isMd5 = function (s) { return typeof s === 'string' && /^[0-9a-f]{32}$/i.test(s); };

  // 2026-09-27加: video_thumbs.ps1没有走nas-pipe那套WebSocket在线注册(跟nas_client.py
  // 不是一回事, 纯粹HTTP轮询), 没有"在线/离线"这个状态可查——用"最近一次来领任务是什么
  // 时候"代替: agent正常运行的话, 队列空的时候也会每隔$PollIntervalSec(脚本里是15秒)
  // 来问一次, 超过60秒没来过就当作没启动。
  var _lastPendingAt = 0;
  var _lease = {};
  app.get('/api/video/agent-status', function (req, res) {
    var ago = _lastPendingAt ? (Date.now() / 1000 - _lastPendingAt) : null;
    res.json({
      online: ago !== null && ago < 60,
      lastSeenSecondsAgo: ago,
      startCmd: 'powershell -NoProfile -ExecutionPolicy Bypass -File X:\\docker\\pc-scripts\\video_thumbs_start4.ps1'
    });
  });

  // ── 领取待处理视频 ──────────────────────────────────
  // GET /api/video/pending?limit=50&retry=0
  //   retry=1 时连失败的(shots=-1)一起返回
  app.get('/api/video/pending', function (req, res) {
    _lastPendingAt = Date.now() / 1000;
    try {
      var db    = getDb();
      var limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
      var retry = req.query.retry === '1';
      var cond  = retry ? '(shots = 0 OR shots = -1)' : 'shots = 0';
      var minD  = parseInt(req.query.minDuration || '0', 10) || 0;
      var extra = minD > 0 ? ' AND duration > ' + minD : '';
      var dir   = String(req.query.dir || '').replace(/\\/g, '/').replace(/\/$/, '');
      var dirParams = [];
      if (dir) { extra += ' AND (path = ? OR path LIKE ?)'; dirParams = [dir, dir + '/%']; }
      var rows  = db.prepare(
        "SELECT md5, path, size, duration FROM photos " +
        "WHERE media_type = 'video' AND md5 IS NOT NULL AND " + cond + extra + " " +
        "ORDER BY id LIMIT ?"
      ).all.apply(db.prepare(
        "SELECT md5, path, size, duration FROM photos " +
        "WHERE media_type = 'video' AND md5 IS NOT NULL AND " + cond + extra + " " +
        "ORDER BY id LIMIT ?"
      ), dirParams.concat([limit * 6 + 60]));
      // 2026-09-30加: 任务租约。多个抽帧窗口(video_thumbs.ps1 -Id 1/2/3...)并行时, 每个都从队列
      // 最前面领, 会领到同一批视频、重复干活。领出去的视频租15分钟(内存里记, 重启就清空, 无所谓),
      // 别的窗口在租期内看不到它; 处理完回报后shots>0自然不在队列里了, 崩了的窗口租期到了也会被重新领。
      var nowMs = Date.now();
      for (var lk in _lease) { if (_lease[lk] < nowMs) delete _lease[lk]; }
      rows = rows.filter(function (r) { return !_lease[r.md5]; }).slice(0, limit);
      rows.forEach(function (r) { _lease[r.md5] = nowMs + 15 * 60 * 1000; });
      res.json({ videos: rows, count: rows.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 提交结果 ────────────────────────────────────────
  // POST /api/video/meta  {md5, duration, width, height, codec, shots}
  app.post('/api/video/meta', express.json({ limit: '1mb' }), function (req, res) {
    var b = req.body || {};
    if (!isMd5(b.md5)) return res.status(400).json({ error: 'md5 无效' });
    try {
      var db = getDb();
      db.prepare(
        "UPDATE photos SET duration = ?, width = ?, height = ?, vcodec = ?, shots = ?, updated_at = strftime('%s','now') " +
        "WHERE md5 = ? AND media_type = 'video'"
      ).run(
        parseInt(b.duration, 10) || 0,
        parseInt(b.width, 10)    || null,
        parseInt(b.height, 10)   || null,
        b.codec ? String(b.codec).slice(0, 24) : null,
        parseInt(b.shots, 10)    || 0,
        String(b.md5).toLowerCase()
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 批量提交(减少往返)
  // POST /api/video/meta-batch  {items:[{md5,duration,...}]}
  // 2026-08-16加: 视频真实拍摄时间(从原始文件内部元数据的creation_time提取, 跟文件系统
  // mtime分开存, mtime会因为搬家/转码而改变, 这个字段一旦提取就是真实值不会再变。
  // 独立成新接口, 不复用meta-batch(那个是"整条覆盖", 不传的字段会被清零, 容易搞坏别的数据)
  (function () {
    var db0 = getDb();
    var cols0 = db0.prepare('PRAGMA table_info(photos)').all().map(function (c) { return c.name; });
    if (cols0.indexOf('video_created_at') < 0) {
      db0.exec('ALTER TABLE photos ADD COLUMN video_created_at INTEGER');
      console.log('[video-ext] 已添加 video_created_at 字段(视频真实拍摄时间)');
    }
  })();

  // GET /api/video/need-created-at?limit=500  返回还没提取过拍摄时间的视频
  app.get('/api/video/need-created-at', function (req, res) {
    try {
      var db = getDb();
      var limit = Math.min(2000, Math.max(1, parseInt(req.query.limit || '500', 10) || 500));
      var rows = db.prepare(
        "SELECT md5, path FROM photos WHERE media_type='video' AND md5 IS NOT NULL " +
        "AND video_created_at IS NULL ORDER BY id LIMIT ?"
      ).all(limit);
      res.json({ items: rows, total: rows.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/video/created-batch  {items:[{md5, createdAt}]}  createdAt是秒级时间戳,
  // 探测不到的传0(表示"确认查过, 没有", 避免每次都重新探测同一批没有元数据的视频)
  app.post('/api/video/created-batch', express.json({ limit: '2mb' }), function (req, res) {
    var items = (req.body && req.body.items) || [];
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items 为空' });
    try {
      var db = getDb();
      var up = db.prepare("UPDATE photos SET video_created_at = ? WHERE md5 = ? AND media_type = 'video'");
      var n = 0;
      db.transaction(function (arr) {
        arr.forEach(function (b) {
          if (!isMd5(b.md5)) return;
          n += up.run(parseInt(b.createdAt, 10) || 0, String(b.md5).toLowerCase()).changes;
        });
      })(items);
      res.json({ ok: true, updated: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/video/meta-batch', express.json({ limit: '4mb' }), function (req, res) {
    var items = (req.body && req.body.items) || [];
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items 为空' });
    try {
      var db = getDb();
      var up = db.prepare(
        "UPDATE photos SET duration = ?, width = ?, height = ?, vcodec = ?, shots = ?, updated_at = strftime('%s','now') " +
        "WHERE md5 = ? AND media_type = 'video'"
      );
      var n = 0;
      var tx = db.transaction(function (arr) {
        arr.forEach(function (b) {
          if (!isMd5(b.md5)) return;
          n += up.run(
            parseInt(b.duration, 10) || 0,
            parseInt(b.width, 10)    || null,
            parseInt(b.height, 10)   || null,
            b.codec ? String(b.codec).slice(0, 24) : null,
            parseInt(b.shots, 10)    || 0,
            String(b.md5).toLowerCase()
          ).changes;
        });
      });
      tx(items);
      res.json({ ok: true, updated: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 分辨率补录用: 待补录清单(2026-08-13加) ──────────────
  // 返回 width/height 缺失的视频, 连同现有的 duration/shots/vcodec 一起带出去,
  // 补录脚本回填时要把这几个字段原样带回来, 不能只传width/height, 否则meta-batch
  // 会把这几个字段覆盖成0/空, 破坏已有的抽帧状态。
  // GET /api/video/need-resolution?limit=500&offset=0
  app.get('/api/video/need-resolution', function (req, res) {
    try {
      var db = getDb();
      var limit  = Math.min(2000, Math.max(1, parseInt(req.query.limit  || '500', 10) || 500));
      var offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
      var rows = db.prepare(
        "SELECT md5, path, duration, shots, vcodec FROM photos " +
        "WHERE media_type='video' AND (width IS NULL OR width = 0) " +
        "ORDER BY id LIMIT ? OFFSET ?"
      ).all(limit, offset);
      var total = db.prepare(
        "SELECT COUNT(*) c FROM photos WHERE media_type='video' AND (width IS NULL OR width = 0)"
      ).get().c;
      res.json({ items: rows, total: total });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 分辨率筛选用: 系统里实际存在哪些分辨率档位(2026-08-13加) ──
  // 不让前端随便传数字筛, 只能从这里返回的真实存在的档位里选,
  // 按最常见的几档分桶, 只返回真的有视频落在里面的档位(count>0才出现)。
  // width<=0(还没探测出来的)一律不计入任何档位, 避免跟"真实的低分辨率"混淆。
  // GET /api/video/resolution-buckets
  app.get('/api/video/resolution-buckets', function (req, res) {
    try {
      var db = getDb();
      var BUCKETS = [
        { key: '4k',    label: '4K及以上',  minW: 3840 },
        { key: '2k',    label: '2K/1440p',  minW: 2560 },
        { key: '1080p', label: '1080p',     minW: 1920 },
        { key: '720p',  label: '720p',      minW: 1280 },
        { key: 'sd',    label: '720p以下',  minW: 1    }
      ];
      var out = [];
      for (var i = 0; i < BUCKETS.length; i++) {
        var b = BUCKETS[i];
        var maxW = (i > 0) ? BUCKETS[i - 1].minW - 1 : null;
        var sql = "SELECT COUNT(*) c FROM photos WHERE media_type='video' AND width >= ?" +
                   (maxW !== null ? " AND width <= ?" : "");
        var stmt = db.prepare(sql);
        var cnt = (maxW !== null ? stmt.get(b.minW, maxW) : stmt.get(b.minW)).c;
        if (cnt > 0) out.push({ key: b.key, label: b.label, minW: b.minW, maxW: maxW, count: cnt });
      }
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── DTS完整性巡检(2026-08-13加): 待检查清单/结果回收/问题清单查询 ──
  // GET /api/video/need-dts-check?limit=300&offset=0
  // 2026-08-13: 按文件大小从小到大排(size ASC) -- 小文件解码快, 先处理能更快看到进度反馈,
  // 也能更快筛出大部分问题文件; 最大的文件放最后处理
  // 2026-08-21修复: size跟解码耗时其实相关性很差(同样320MB左右的文件, 时长从54秒到1552秒
  // 都有, 取决于码率/压缩率), 真正决定完整解码一遍要多久的是时长, 改成按duration排序。
  // 另外库里有不少超长视频(历史剪辑合并出来的), 完整解码一遍本身就要跑很久, 加了超时也只会
  // 反复超时重试拖累正常队列 -- 跳过 >1小时的, 不自动排队(2026-08-21再改: 阈值从2小时收紧到
  // 1小时), 以后要查再单独处理。
  // 2026-08-29改: 不再自动扫全库——只出"右键点过、进了优先队列"的这些。
  // 原来这里是查 dts_checked=0 全库排队,已经去掉,免得PC端agent一直啃不完的大队列
  // (库里几万个视频,之前这个队列跑了一礼拜没跑完)。想恢复的话把 git 历史里的
  // 全库查询逻辑抄回来就行,逻辑本身没问题,只是现在明确要"手动指定"。
  var dtsPriorityQueue = []; // [{ md5, path }]

  // POST /api/video/dts-check-priority  {md5}
  app.post('/api/video/dts-check-priority', express.json(), function (req, res) {
    var b = req.body || {};
    if (!isMd5(b.md5)) return res.status(400).json({ error: 'md5 无效' });
    try {
      var row = getDb().prepare(
        "SELECT md5, path, media_type FROM photos WHERE md5 = ?"
      ).get(String(b.md5).toLowerCase());
      if (!row) return res.status(404).json({ error: '找不到这个视频' });
      if (row.media_type !== 'video') return res.status(400).json({ error: '不是视频' });
      dtsPriorityQueue = dtsPriorityQueue.filter(function (x) { return x.md5 !== row.md5; });
      dtsPriorityQueue.unshift({ md5: row.md5, path: row.path });
      dtsScanRunning = true; // 自动开关,不然PC端还是闲着不干活
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/video/need-dts-check', function (req, res) {
    try {
      var limit = Math.min(2000, Math.max(1, parseInt(req.query.limit || '300', 10) || 300));
      var items = dtsPriorityQueue.slice(0, limit).map(function (p) { return { md5: p.md5, path: p.path }; });
      res.json({ items: items, total: items.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/video/dts-check-result-batch  {items:[{md5, bad, error}]}
  app.post('/api/video/dts-check-result-batch', express.json({ limit: '4mb' }), function (req, res) {
    var items = (req.body && req.body.items) || [];
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items 为空' });
    try {
      var db = getDb();
      var up = db.prepare(
        "UPDATE photos SET dts_checked = 1, dts_bad = ?, dts_error = ? WHERE md5 = ? AND media_type = 'video'"
      );
      var n = 0;
      var tx = db.transaction(function (arr) {
        arr.forEach(function (b) {
          if (!isMd5(b.md5)) return;
          n += up.run(b.bad ? 1 : 0, b.error ? String(b.error).slice(0, 2000) : null, String(b.md5).toLowerCase()).changes;
          dtsPriorityQueue = dtsPriorityQueue.filter(function (x) { return x.md5 !== String(b.md5).toLowerCase(); });
        });
      });
      tx(items);
      res.json({ ok: true, updated: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/video/dts-bad-list?limit=200&offset=0  查已确认有问题的清单
  app.get('/api/video/dts-bad-list', function (req, res) {
    try {
      var db = getDb();
      var limit  = Math.min(2000, Math.max(1, parseInt(req.query.limit  || '200', 10) || 200));
      var offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
      var rows = db.prepare(
        "SELECT md5, path, dts_error, web_ready FROM photos WHERE media_type='video' AND dts_bad = 1 ORDER BY id LIMIT ? OFFSET ?"
      ).all(limit, offset);
      var total = db.prepare("SELECT COUNT(*) c FROM photos WHERE media_type='video' AND dts_bad = 1").get().c;
      res.json({ items: rows, total: total });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── DTS巡检开关(2026-08-13加): 网页控制启停, PC端后台助手轮询这个状态 ──
  // running只存内存, 服务重启会自动回到false(PC端助手轮询到false就会自己停下, 不会失控空跑)
  var dtsScanRunning = false;
  // 2026-08-17加: 独立心跳(跟dtsCurrentAt分开) -- 主循环每轮(不管有没有活干)都会
  // 调用一次, 用来判断PC端进程是不是真的还活着
  var dtsLastHeartbeat = 0;

  // POST /api/video/dts-scan/control  {action:'start'|'stop'}
  // 视频日期范围(2026-08-13加): 给前端日期滑块定边界用
  // GET /api/video/date-range
  app.get('/api/video/date-range', function (req, res) {
    try {
      var r = getDb().prepare(
        "SELECT MIN(mtime) mn, MAX(mtime) mx FROM photos WHERE media_type='video' AND mtime > 0"
      ).get();
      res.json({ min: r.mn || 0, max: r.mx || 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 2026-08-16加: DTS巡检速度配置(网页上直接调, 不用手动改PC本地文件)
  // PC端DtsScanAgent每一批任务都会来读一次这个接口, 改完最多等几秒(下一批)就生效
  function readDtsSpeedConfig() {
    var def = { maxParallel: 2, ffmpegThreads: 2 };
    try {
      var cfg = JSON.parse(fs.readFileSync('/data/config.json', 'utf8'));
      return {
        maxParallel: (cfg.dtsMaxParallel && cfg.dtsMaxParallel > 0) ? cfg.dtsMaxParallel : def.maxParallel,
        ffmpegThreads: (cfg.dtsFfmpegThreads && cfg.dtsFfmpegThreads > 0) ? cfg.dtsFfmpegThreads : def.ffmpegThreads,
      };
    } catch (e) { return def; }
  }

  // GET /api/video/dts-scan/speed-config
  app.get('/api/video/dts-scan/speed-config', function (req, res) {
    res.json(readDtsSpeedConfig());
  });

  // POST /api/video/dts-scan/speed-config  {maxParallel, ffmpegThreads}
  app.post('/api/video/dts-scan/speed-config', express.json(), function (req, res) {
    var b = req.body || {};
    var maxParallel = parseInt(b.maxParallel, 10);
    var ffmpegThreads = parseInt(b.ffmpegThreads, 10);
    if (!maxParallel || maxParallel < 1 || maxParallel > 10) {
      return res.status(400).json({ error: 'maxParallel 必须是1-10之间的整数' });
    }
    if (!ffmpegThreads || ffmpegThreads < 1 || ffmpegThreads > 8) {
      return res.status(400).json({ error: 'ffmpegThreads 必须是1-8之间的整数' });
    }
    try {
      var cfg = {};
      try { cfg = JSON.parse(fs.readFileSync('/data/config.json', 'utf8')); } catch (e2) {}
      cfg.dtsMaxParallel = maxParallel;
      cfg.dtsFfmpegThreads = ffmpegThreads;
      fs.writeFileSync('/data/config.json', JSON.stringify(cfg, null, 2));
      res.json({ ok: true, maxParallel: maxParallel, ffmpegThreads: ffmpegThreads });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/video/dts-scan/control', express.json(), function (req, res) {
    var action = (req.body && req.body.action) || '';
    if (action === 'start') dtsScanRunning = true;
    else if (action === 'stop') dtsScanRunning = false;
    else return res.status(400).json({ error: 'action 必须是 start 或 stop' });
    res.json({ ok: true, running: dtsScanRunning });
  });

  // 当前正在处理的批次(2026-08-13加): PC端助手每开始一批就上报一次文件名清单,
  // 只存内存, 服务重启自动清空(下一批上报会重新填上, 不影响功能)
  var dtsCurrentBatch = [];
  var dtsCurrentAt = 0;

  // POST /api/video/dts-scan/current  {items:[{md5,path}]}
  app.post('/api/video/dts-scan/current', express.json({ limit: '512kb' }), function (req, res) {
    dtsCurrentBatch = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    dtsCurrentAt = Date.now();
    res.json({ ok: true });
  });

  // POST /api/video/dts-scan/heartbeat  2026-08-17加: PC端主循环每轮调用一次, 不管有没有活干
  app.post('/api/video/dts-scan/heartbeat', function (req, res) {
    dtsLastHeartbeat = Date.now();
    res.json({ ok: true });
  });

  // GET /api/video/dts-scan/status  网页轮询这个显示进度, PC端助手也轮询这个决定要不要干活
  app.get('/api/video/dts-scan/status', function (req, res) {
    try {
      var db = getDb();
      var total   = db.prepare("SELECT COUNT(*) c FROM photos WHERE media_type='video'").get().c;
      var checked = db.prepare("SELECT COUNT(*) c FROM photos WHERE media_type='video' AND dts_checked=1").get().c;
      var bad     = db.prepare("SELECT COUNT(*) c FROM photos WHERE media_type='video' AND dts_bad=1").get().c;
      // 上报超过5分钟没更新过, 大概率助手已经不在跑这批了(卡住/换批次没上报/助手挂了), 不再展示为"当前"
      var current = (Date.now() - dtsCurrentAt < 5 * 60 * 1000) ? dtsCurrentBatch : [];
      var agentAlive = (Date.now() - Math.max(dtsLastHeartbeat, dtsCurrentAt) < 15 * 60 * 1000);
      res.json({ running: dtsScanRunning, total: total, checked: checked, bad: bad, current: current, agentAlive: agentAlive });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 标记失败
  // POST /api/video/fail  {md5, error}
  app.post('/api/video/fail', express.json(), function (req, res) {
    var b = req.body || {};
    if (!isMd5(b.md5)) return res.status(400).json({ error: 'md5 无效' });
    try {
      var db = getDb();
      db.prepare("UPDATE photos SET shots = -1 WHERE md5 = ? AND media_type = 'video'")
        .run(String(b.md5).toLowerCase());
      // 存具体错误文本, 供管理页"查看错误详情"用(error-center.js 挂载时才有, 未挂载则跳过)
      if (app.locals.errorCenter) app.locals.errorCenter.recordVideoError(db, String(b.md5).toLowerCase(), b.error);
      console.log('[video] 抽帧失败:', b.md5, b.error || '');
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ══ 目录级操作(供目录树右键菜单调用)══════════════════

  var VIDEO_EXT = ['.mp4','.mkv','.avi','.wmv','.ts','.rmvb','.mov','.webm','.flv','.m4v','.mpg','.mpeg','.m2ts','.vob','.asf'];

  // NAS 真实路径 <-> 入库路径 前缀互转
  //   真实: /share/CACHEDEV4_DATA/Person/x.mp4
  //   入库: /share/Person/x.mp4        (与照片保持一致)
  function toRealPath(dbPath) {
    if (dbPath.indexOf('/share/CACHEDEV') === 0) return dbPath;
    var m = dbPath.match(/^\/share\/([^\/]+)(\/.*)?$/);
    if (!m) return dbPath;
    // 依次试各个 CACHEDEV 卷
    for (var i = 1; i <= 8; i++) {
      var cand = '/share/CACHEDEV' + i + '_DATA/' + m[1] + (m[2] || '');
      try { if (fs.existsSync(cand)) return cand; } catch (e) {}
    }
    return dbPath;
  }

  function toDbPath(realPath) {
    var m = realPath.match(/^\/share\/CACHEDEV\d+_DATA(\/.*)$/);
    return m ? ('/share' + m[1]) : realPath;
  }

  function isVideoName(n) {
    var e = path.extname(n).toLowerCase();
    return VIDEO_EXT.indexOf(e) >= 0;
  }

  // 文件名 -> 32 位十六进制(与 video_scan.js 完全一致)
  function nameHash(name) {
    var h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
    for (var i = 0; i < name.length; i++) {
      var c = name.charCodeAt(i);
      h1 = ((h1 ^ c) * 0x01000193) >>> 0;
      h2 = (((h2 + c) >>> 0) * 0x85ebca6b) >>> 0;
      h3 = ((h3 ^ (c + i)) * 0x27220a95) >>> 0;
      h4 = (((h4 << 5) - h4 + c) >>> 0) ^ (h3 >>> 7);
      h4 = h4 >>> 0;
    }
    var hex = function (x) { return ('00000000' + x.toString(16)).slice(-8); };
    return hex(h1) + hex(h2) + hex(h3) + hex(h4);
  }

  function walkVideos(dir, depth, out, limit) {
    if (depth > 12 || out.length >= limit) return out;
    var ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
    for (var i = 0; i < ents.length && out.length < limit; i++) {
      var e = ents[i], full = dir + '/' + e.name, isDir = e.isDirectory();
      if (e.isSymbolicLink()) { try { isDir = fs.statSync(full).isDirectory(); } catch (er) { continue; } }
      if (isDir) {
        if (e.name.charAt(0) === '@' || e.name.charAt(0) === '.') continue;
        walkVideos(full, depth + 1, out, limit);
      } else if (isVideoName(e.name)) {
        var st;
        try { st = fs.statSync(full); } catch (er) { continue; }
        out.push({ full: full, name: e.name, dbPath: toDbPath(full),
                   size: st.size, mtime: Math.floor(st.mtimeMs / 1000), ctime: Math.floor(st.ctimeMs / 1000) });
      }
    }
    return out;
  }

  // ── 目录统计: 照片数 / 视频数 / 抽帧进度 ──────────────
  // GET /api/video/dir-stat?path=/share/Person/115
  app.get('/api/video/dir-stat', function (req, res) {
    var p = String(req.query.path || '').replace(/\\/g, '/').replace(/\/$/, '');
    if (!p) return res.status(400).json({ error: '缺少 path' });
    try {
      var db = getDb();
      var like = p + '/%';
      var q = function (extra) {
        return db.prepare(
          "SELECT COUNT(*) c FROM photos WHERE (path = ? OR path LIKE ?) " + extra
        ).get(p, like).c;
      };
      var hasMT = db.prepare('PRAGMA table_info(photos)').all()
                    .some(function (c) { return c.name === 'media_type'; });
      var photos = hasMT ? q("AND media_type = 'photo'") : q("AND 1=1");
      var videos = hasMT ? q("AND media_type = 'video'") : 0;
      var shotDone = hasMT ? q("AND media_type = 'video' AND shots > 0") : 0;
      var shotWait = hasMT ? q("AND media_type = 'video' AND shots = 0") : 0;
      var shotFail = hasMT ? q("AND media_type = 'video' AND shots = -1") : 0;

      // 文件系统里实际有多少视频(可能还没入库)
      var real = toRealPath(p);
      var onDisk = walkVideos(real, 0, [], 20000).length;

      res.json({
        path: p, realPath: real,
        photos: photos, videos: videos, onDisk: onDisk,
        notIndexed: Math.max(0, onDisk - videos),
        shotDone: shotDone, shotPending: shotWait, shotFailed: shotFail
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 扫描指定目录的视频入库 ──────────────────────────
  // POST /api/video/scan-dir  {path}
  app.post('/api/video/scan-dir', express.json(), async function (req, res) {
    var p = String((req.body && req.body.path) || '').replace(/\\/g, '/').replace(/\/$/, '');
    if (!p) return res.status(400).json({ error: '缺少 path' });
    try {
      var real = toRealPath(p);
      if (!fs.existsSync(real)) return res.status(404).json({ error: '目录不存在: ' + real });

      var files = walkVideos(real, 0, [], 50000);
      if (!files.length) return res.json({ ok: true, scanned: 0, added: 0, note: '该目录下没有视频文件' });

      var db = getDb();
      // media_type 字段确保存在
      var cols = db.prepare('PRAGMA table_info(photos)').all().map(function (c) { return c.name; });
      if (cols.indexOf('media_type') < 0) {
        db.exec("ALTER TABLE photos ADD COLUMN media_type TEXT NOT NULL DEFAULT 'photo'");
        db.exec("CREATE INDEX IF NOT EXISTS idx_photos_media_type ON photos(media_type)");
      }

      var now = Math.floor(Date.now() / 1000);
      // 队列字段全填 1: PC 上 clip_service 在轮询, 填 0 会被领去当图片解码
      var ins = db.prepare(
        "INSERT OR IGNORE INTO photos " +
        "(path, size, mtime, ctime, md5, status, media_type, ai_tags, user_tags, favorite, " +
        " ai_status, feat_status, vlm_status, clip_status, exif_written, priority, created_at, updated_at) " +
        "VALUES (?,?,?,?,?, 'done','video', '[]','[]',0, 1,1,1,1,1,0, ?,?)"
      );
      var added = 0;
      // 2026-09-29: 视频key改用快速内容指纹(video-key.js: 大小+头/中/尾各1MB), 不再用文件名哈希。
      // 只给库里还没有的路径算key(已入库的不重复读盘), 每20个让一次事件循环, 大目录也不卡住服务。
      var exists = db.prepare('SELECT 1 FROM photos WHERE path = ?');
      var keyed = [];
      for (var ki = 0; ki < files.length; ki++) {
        var kf = files[ki];
        if (exists.get(kf.dbPath)) continue;
        try { kf.key = vk.quickKey(kf.full); keyed.push(kf); } catch (ke) { console.log('[video] scan-dir 算key失败, 跳过:', kf.full, ke.message); }
        if (ki % 20 === 19) await new Promise(function (r) { setImmediate(r); });
      }
      var tx = db.transaction(function (arr) {
        arr.forEach(function (f) {
          added += ins.run(f.dbPath, f.size, f.mtime, f.ctime, f.key, now, now).changes;
        });
      });
      tx(keyed);

      console.log('[video] scan-dir', p, '扫描', files.length, '新增', added);
      res.json({ ok: true, scanned: files.length, added: added, skipped: files.length - added });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 把指定目录的视频加入抽帧队列 ────────────────────
  // POST /api/video/queue-dir  {path, includeDone:false}
  app.post('/api/video/queue-dir', express.json(), function (req, res) {
    var b = req.body || {};
    var p = String(b.path || '').replace(/\\/g, '/').replace(/\/$/, '');
    if (!p) return res.status(400).json({ error: '缺少 path' });
    try {
      var db = getDb();
      var like = p + '/%';
      var cond = b.includeDone ? '1=1' : '(shots = 0 OR shots = -1)';
      var total = db.prepare(
        "SELECT COUNT(*) c FROM photos WHERE media_type='video' AND (path = ? OR path LIKE ?)"
      ).get(p, like).c;
      if (!total) return res.json({ ok: true, queued: 0, total: 0, note: '该目录下没有已入库的视频' });

      var n = db.prepare(
        "UPDATE photos SET shots = 0 WHERE media_type='video' AND (path = ? OR path LIKE ?) AND " + cond
      ).run(p, like).changes;

      console.log('[video] queue-dir', p, '入队', n, '/', total);
      res.json({ ok: true, queued: n, total: total, dir: p });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 进度 ────────────────────────────────────────────
  // GET /api/video/progress
  app.get('/api/video/progress', function (req, res) {
    try {
      var db = getDb();
      var dir = String(req.query.dir || '').replace(/\\/g, '/').replace(/\/$/, '');
      var dw = dir ? ' AND (path = ? OR path LIKE ?)' : '';
      var dp = dir ? [dir, dir + '/%'] : [];
      var q = function (c) {
        var st = db.prepare("SELECT COUNT(*) c FROM photos WHERE media_type='video' AND " + c + dw);
        return st.get.apply(st, dp).c;
      };
      res.json({
        total:   q('1=1'),
        done:    q('shots > 0'),
        pending: q('shots = 0'),
        failed:  q('shots = -1'),
        withDuration: q('duration > 0')
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 重置(重跑用)────────────────────────────────────
  // POST /api/video/reset  {failedOnly:true}          仅失败的
  //                        {minDuration:600}          仅时长超过 N 秒的
  //                        {dryRun:true}              只看会影响多少条
  app.post('/api/video/reset', express.json(), function (req, res) {
    try {
      var b = req.body || {};
      var where = ["media_type = 'video'"];
      if (b.failedOnly) where.push('shots = -1');
      var minD = parseInt(b.minDuration, 10) || 0;
      if (minD > 0) where.push('duration > ' + minD);
      var w = where.join(' AND ');

      var db = getDb();
      if (b.dryRun) {
        return res.json({ dryRun: true, willReset: db.prepare('SELECT COUNT(*) c FROM photos WHERE ' + w).get().c });
      }
      var n = db.prepare('UPDATE photos SET shots = 0 WHERE ' + w).run().changes;
      console.log('[video] reset', n, '条 (' + w + ')');
      res.json({ ok: true, reset: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 清理某视频的旧缩略图(重跑前调用, 避免残留多余张数)──
  // POST /api/video/clean-shots  {md5}
  app.post('/api/video/clean-shots', express.json(), function (req, res) {
    var md5 = String((req.body && req.body.md5) || '').toLowerCase();
    if (!isMd5(md5)) return res.status(400).json({ error: 'md5 无效' });
    try {
      var dir = VTHUMB_DIR + '/' + md5.slice(0, 2);
      var n = 0;
      try {
        fs.readdirSync(dir).forEach(function (f) {
          if (f.indexOf(md5 + '_') === 0) { fs.unlinkSync(dir + '/' + f); n++; }
        });
      } catch (e) {}
      res.json({ ok: true, removed: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
