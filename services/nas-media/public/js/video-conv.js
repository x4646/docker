// video-conv.js — 网页可播版本转换(换壳/转码), 不改动原始文件
//
// 原文件永远不动(PotPlayer 用它)。转好的版本另存到 vconv/, 网页优先用这份播放。
// web_ready: 0=未处理 1=换壳完成 2=转码完成 -1=失败
//
// 挂载: try { require('./public/js/video-conv.js')(app, getDb); } catch(e) { }

module.exports = function (app, getDb) {
  var express = require('express');
  var fs = require('fs');
  var path = require('path');

  // 转换后的文件放在"每个根目录下的 转换/ 子目录", 镜像原目录结构:
  //   /share/Media/x/视频.ts        (原文件, 不动)
  //   /share/Media/转换/x/视频_换壳.mp4   (换壳)
  //   /share/Media/转换/x/视频_转码.mp4   (转码)
  // 真实路径(带 CACHEDEV 卷)与入库路径(/share/Xxx)的互转沿用 video-ext.js 的规则

  (function init() {
    var db = getDb();
    var cols = db.prepare('PRAGMA table_info(photos)').all().map(function (c) { return c.name; });
    if (cols.indexOf('web_ready') < 0) {
      db.exec('ALTER TABLE photos ADD COLUMN web_ready INTEGER DEFAULT 0');
      db.exec('CREATE INDEX IF NOT EXISTS idx_photos_web_ready ON photos(web_ready)');
      console.log('[vconv] 已添加 web_ready 字段');
    }
    if (cols.indexOf('vconv_error') < 0) {
      db.exec('ALTER TABLE photos ADD COLUMN vconv_error TEXT');
      console.log('[vconv] 已添加 vconv_error 字段');
    }
    console.log('[video-conv] 初始化完成 (转换文件存于各根目录下的 转换/ 子目录)');
  })();

  // 2026-09-09优化: 原来每次播放请求都要循环最多8次同步existsSync去猜CACHEDEV卷号,
  // 跟前面/original同一类问题(同步IO堵事件循环), 而且"share名->CACHEDEV卷号"这个映射
  // 对同一个share来说是固定不变的(NAS存储池分配), 猜到一次就缓存住, 后面同名share直接
  // 拼路径, 不用再探测。
  var _cachedevCache = {}; // shareName -> 'CACHEDEVn_DATA' | null(没有对应CACHEDEV卷, 直连)
  function toRealPath(dbPath) {
    if (dbPath.indexOf('/share/CACHEDEV') === 0) return dbPath;
    var m = dbPath.match(/^\/share\/([^\/]+)(\/.*)?$/);
    if (!m) return dbPath;
    var shareName = m[1], rest = m[2] || '';
    if (Object.prototype.hasOwnProperty.call(_cachedevCache, shareName)) {
      var cached = _cachedevCache[shareName];
      return cached ? ('/share/' + cached + '/' + shareName + rest) : dbPath;
    }
    for (var i = 1; i <= 8; i++) {
      var cand = '/share/CACHEDEV' + i + '_DATA/' + shareName + rest;
      try {
        if (fs.existsSync(cand)) {
          _cachedevCache[shareName] = 'CACHEDEV' + i + '_DATA';
          return cand;
        }
      } catch (e) {}
    }
    _cachedevCache[shareName] = null;
    return dbPath;
  }

  // 原文件的入库路径(/share/Xxx/...) -> 转换文件应存放的入库路径(不含后缀, 后面拼 _换壳.mp4 等)
  //   /share/Media/x/视频.ts -> /share/Media/转换/x/视频
  function convBase(dbPath, suffix) {
    var m = dbPath.match(/^(\/share\/[^\/]+)(\/.*)?\/([^\/]+)\.[A-Za-z0-9]{1,5}$/);
    if (!m) return null;
    var root = m[1], mid = m[2] || '', name = m[3];
    return root + '/转换' + mid + '/' + name + '_' + suffix + '.mp4';
  }

  // 提供静态访问: 各根目录下的 转换/ 子目录直接挂到 /convfiles/<根名>/转换/...
  // (用 express.static 逐个根挂载, 根目录本身在扫描时已经确定, 这里用中间件动态处理更省事)
  // 2026-09-09修复: 跟nas-media的/original同一个问题——同步existsSync堵Node事件循环,
  // 视频拖进度条并发Range请求一多整个进程被拖住。去掉同步预检查, 交给sendFile错误回调。
  app.get('/convfiles/*', function (req, res) {
    try {
      var rel = decodeURIComponent(req.params[0]);      // 如 Media/转换/x/视频_换壳.mp4
      var dbPath = '/share/' + rel;
      var real = toRealPath(dbPath);
      res.sendFile(real, { maxAge: '30d' }, function (err) {
        if (err && !res.headersSent) res.status(404).end();
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  var isMd5 = function (s) { return typeof s === 'string' && /^[0-9a-f]{32}$/i.test(s); };

  // 需要处理的判定(与前端 canPlay 的"仅换壳"/"要转码"逻辑对应, 交给 mode 区分):
  //   mode=remux     容器不认但编码认(ts/flv/avi-h264/mkv-h264/mkv-vp9 ...) -> ffmpeg -c copy
  //   mode=transcode 编码本身不认(mpeg4/wmv系/rv系等) -> NVENC 重新编码
  var OK_CODEC = ['h264', 'avc1', 'vp8', 'vp9', 'av1', 'av01', 'theora'];
  var OK_EXT   = ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'ogg'];

  function classify(ext, codec, dtsBad) {
    // 2026-08-16加dtsBad参数: DTS巡检标记为损坏的视频, 不管编码格式本身兼不兼容,
    // 强制归类为transcode(需要重新编码修复流损坏, remux换壳只是换容器不能修复流本身的问题)
    if (dtsBad) return 'transcode';
    var e = String(ext || '').toLowerCase();
    var c = String(codec || '').toLowerCase();
    if (OK_EXT.indexOf(e) >= 0 && OK_CODEC.indexOf(c) >= 0) return 'ok';
    // 2026-09-26改: 原来HEVC/H265一律归类成'maybe'("浏览器可能已经能播,不用转"), 直接
    // 挡在转码队列门外, 手动排队都排不进去。这个假设站不住脚——Chrome/Firefox/Edge在
    // Windows/Linux/Android上默认都没有HEVC硬解码支持(专利费问题), 实测症状是"PotPlayer
    // (自带解码器,什么都能放)能播, 网页播放器黑屏(音频有,画面解不出来)"。HEVC浏览器不认
    // 这件事跟mpeg4/wmv/rv40这些老编码本质上是同一类问题, 直接归到transcode, 走同一条
    // 已经跑通的NVENC转码流水线, 不再单独搞一个"可能能播"的死胡同分类。
    if (OK_CODEC.indexOf(c) >= 0) return 'remux';
    return 'transcode';
  }

  // ── 手动队列(视频转换页面用) ──
  // 内存态: 不用跨重启持久化, nas-media 重启后这个列表会清空, 队列里的视频要
  // 重新右键"加入队列"才会再排上——数据库里的 web_ready 状态不受影响, 已经
  // 转好的不会受影响, 只是"排队中/正在转/刚失败"这种临时状态会跟着没了。
  // status: queued(排队中) / processing(正在转) / done(完成) / failed(失败)
  var priorityQueue = []; // [{ md5, path, vcodec, size, dtsBad, convPath, mode, status, error, addedAt }]

  function findQueueItem(md5) {
    for (var i = 0; i < priorityQueue.length; i++) {
      if (priorityQueue[i].md5 === md5) return priorityQueue[i];
    }
    return null;
  }

  // POST /api/vconv/priority  {md5}  —— 加入队列(右键菜单"转换成可播放格式"调这个)
  app.post('/api/vconv/priority', express.json(), function (req, res) {
    var b = req.body || {};
    if (!isMd5(b.md5)) return res.status(400).json({ error: 'md5 无效' });
    try {
      var db = getDb();
      var row = db.prepare(
        "SELECT md5, path, vcodec, size, duration, dts_bad, media_type FROM photos WHERE md5 = ?"
      ).get(String(b.md5).toLowerCase());
      if (!row) return res.status(404).json({ error: '找不到这个视频' });
      if (row.media_type !== 'video') return res.status(400).json({ error: '不是视频' });
      // 2026-09-30 规则(用户定): 超过6GB的视频不转码、保留源文件。所有入队入口(右键手动/向导批量)都从这里进,
      // 在这一处拦, 不会漏。手动确实想转的传 force:true 绕过。
      if (row.size > 6e9 && !b.force) {
        return res.status(400).json({ error: '超过6GB的视频按规则不转码(保留源文件)', skippedBig: true });
      }

      var ext = (row.path.match(/\.([A-Za-z0-9]{1,5})$/) || [])[1] || '';
      // 2026-09-30: b.transcode=true(右键"转码")强制走转码, 不按格式自动判断
      var mode = b.transcode ? 'transcode' : classify(ext, row.vcodec, row.dts_bad);
      if (mode === 'ok') return res.json({ ok: true, alreadyOk: true });
      if (mode === 'maybe') return res.status(400).json({ error: '这个格式浏览器可能已经能播,不用转换,先试试直接播放' });

      var suffix = mode === 'transcode' ? '转码' : '换壳';
      var cp = convBase(row.path, suffix);
      if (!cp) return res.status(400).json({ error: '路径格式不符合预期,没法自动转换' });

      var existing = findQueueItem(row.md5);
      if (existing && (existing.status === 'queued' || existing.status === 'processing')) {
        return res.json({ ok: true, mode: existing.mode, alreadyQueued: true });
      }
      // 重新加入(可能是之前失败/完成过, 现在重新排一次): 挪到队首, 状态重置
      priorityQueue = priorityQueue.filter(function (x) { return x.md5 !== row.md5; });
      priorityQueue.unshift({
        md5: row.md5, path: row.path, vcodec: row.vcodec,
        size: row.size, dtsBad: !!row.dts_bad, convPath: cp, mode: mode,
        status: 'queued', error: null, addedAt: Date.now(),
      });
      vconvRunning = true; // 自动开关,不然PC端还是闲着不干活
      res.json({ ok: true, mode: mode });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/vconv/queue  —— 转换页面轮询这个显示队列列表+状态
  app.get('/api/vconv/queue', function (req, res) {
    try {
      var out = priorityQueue.map(function (p) {
        return {
          md5: p.md5, path: p.path, mode: p.mode,
          status: p.status, error: p.error, addedAt: p.addedAt,
        };
      });
      res.json({
        items: out, running: vconvRunning,
        agentAlive: (Date.now() - Math.max(vconvLastHeartbeat, vconvCurrentAt) < 15 * 60 * 1000),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/vconv/cancel  {md5}  —— 从队列里撤掉(只能撤"排队中"的, 正在转的撤不掉,
  // ffmpeg 已经在跑了没法从这边中断, 只能等它转完/超时)
  app.post('/api/vconv/cancel', express.json(), function (req, res) {
    var b = req.body || {};
    if (!isMd5(b.md5)) return res.status(400).json({ error: 'md5 无效' });
    var item = findQueueItem(String(b.md5).toLowerCase());
    if (!item) return res.status(404).json({ error: '不在队列里' });
    if (item.status === 'processing') return res.status(400).json({ error: '正在处理中,没法撤销,等它转完' });
    priorityQueue = priorityQueue.filter(function (x) { return x.md5 !== item.md5; });
    res.json({ ok: true });
  });

  // POST /api/vconv/clear-finished  —— 清掉列表里"已完成/已失败"的, 排队中/处理中的不动
  app.post('/api/vconv/clear-finished', function (req, res) {
    priorityQueue = priorityQueue.filter(function (x) { return x.status === 'queued' || x.status === 'processing'; });
    res.json({ ok: true });
  });

  // GET /api/vconv/pending?mode=remux|transcode&limit=50
  // 返回每条视频的目标路径(convPath, 入库风格 /share/Xxx/转换/... ), PC 脚本直接用它算真实盘符路径
  app.get('/api/vconv/pending', function (req, res) {
    try {
      var mode = req.query.mode === 'transcode' ? 'transcode' : 'remux';
      var limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));

      // 2026-08-29改: 不再自动扫全库排队——只出手动加进队列、状态还是queued的这些。
      // 原来这里还有一段查 photos 表 web_ready=0 的全库自动排队逻辑,已经去掉,
      // 免得PC端agent一开机就把没处理完的几万个视频当成待办事项接着跑。
      // 想恢复自动批量扫描的话,把 git 历史里这段代码抄回来就行,逻辑本身没问题。
      var out = priorityQueue
        .filter(function (p) { return p.mode === mode && p.status === 'queued'; })
        .map(function (p) { return { md5: p.md5, path: p.path, vcodec: p.vcodec, size: p.size, dtsBad: p.dtsBad, convPath: p.convPath }; })
        .slice(0, limit);
      res.json({ videos: out, count: out.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/vconv/done  {md5, mode}
  app.post('/api/vconv/done', express.json(), function (req, res) {
    var b = req.body || {};
    if (!isMd5(b.md5)) return res.status(400).json({ error: 'md5 无效' });
    try {
      // 2026-08-16改: 转码成功(mode='transcode')时顺手把dts_bad重置成0, 不然DTS修复过的
      // 视频还是带着dts_bad=1这个标记, 之前"pending接口纳入dts_bad=1"那个改动会导致它
      // 被反复排回转码队列, 修一次卡一次死循环
      if (b.mode === 'transcode') {
        getDb().prepare("UPDATE photos SET web_ready = 2, dts_bad = 0, updated_at = strftime('%s','now') WHERE md5 = ?")
               .run(String(b.md5).toLowerCase());
      } else {
        getDb().prepare("UPDATE photos SET web_ready = 1, updated_at = strftime('%s','now') WHERE md5 = ?")
               .run(String(b.md5).toLowerCase());
      }
      var doneItem = findQueueItem(String(b.md5).toLowerCase());
      if (doneItem) { doneItem.status = 'done'; doneItem.error = null; }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });


app.post('/api/vconv/done-batch', express.json({ limit: '2mb' }), function (req, res) {
    var items = (req.body && req.body.items) || [];
    if (!items.length) return res.status(400).json({ error: 'items 为空' });
    try {
      var db = getDb();
      var up = db.prepare("UPDATE photos SET web_ready = ?, updated_at = strftime('%s','now') WHERE md5 = ?");
      var n = 0;
      db.transaction(function (arr) {
        arr.forEach(function (it) {
          if (!isMd5(it.md5)) return;
          n += up.run(it.mode === 'transcode' ? 2 : 1, it.md5.toLowerCase()).changes;
        });
      })(items);
      res.json({ ok: true, updated: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/vconv/fail  {md5, error}
  app.post('/api/vconv/fail', express.json(), function (req, res) {
    var b = req.body || {};
    if (!isMd5(b.md5)) return res.status(400).json({ error: 'md5 无效' });
    try {
      var db = getDb();
      var cols = db.prepare('PRAGMA table_info(photos)').all().map(function (c) { return c.name; });
      if (cols.indexOf('vconv_error') < 0) {
        db.exec('ALTER TABLE photos ADD COLUMN vconv_error TEXT');
      }
      db.prepare("UPDATE photos SET web_ready = -1, vconv_error = ? WHERE md5 = ?")
        .run(b.error ? String(b.error).slice(0, 2000) : null, String(b.md5).toLowerCase());
      var failItem = findQueueItem(String(b.md5).toLowerCase());
      if (failItem) {
        failItem.status = 'failed';
        // 2026-08-29改: 之前用 slice(0,500) 掐头,结果ffmpeg版本/编译参数这些废话正好
        // 5百来字, 真正有用的报错反而在后面被切掉了(PC端已经截过头800+尾700这1500字符,
        // 这里再显示的话优先要后半段)。改成取后800字符,报错原因通常在最后。
        var full = b.error ? String(b.error) : '';
        failItem.error = full.length > 800 ? ('…' + full.slice(-800)) : (full || '未知错误');
      }
      console.log('[vconv] 失败:', b.md5, b.error || '');
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/vconv/fail-list  查失败清单+具体原因(2026-08-13加)
  app.get('/api/vconv/fail-list', function (req, res) {
    try {
      var rows = getDb().prepare(
        "SELECT md5, path, vcodec, vconv_error FROM photos WHERE media_type='video' AND web_ready=-1"
      ).all();
      res.json({ items: rows, total: rows.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/vconv/progress
  app.get('/api/vconv/progress', function (req, res) {
    try {
      var db = getDb();
      var rows = db.prepare(
        "SELECT path, vcodec, web_ready, dts_bad FROM photos WHERE media_type='video' AND vcodec IS NOT NULL"
      ).all();
      var remuxTotal = 0, remuxDone = 0, transTotal = 0, transDone = 0, failed = 0;
      rows.forEach(function (r) {
        var ext = (r.path.match(/\.([A-Za-z0-9]{1,5})$/) || [])[1] || '';
        var cls = classify(ext, r.vcodec, r.dts_bad);
        if (r.web_ready === -1) failed++;
        if (cls === 'remux') { remuxTotal++; if (r.web_ready > 0) remuxDone++; }
        if (cls === 'transcode') { transTotal++; if (r.web_ready > 0) transDone++; }
      });
      res.json({ remuxTotal: remuxTotal, remuxDone: remuxDone,
                 transTotal: transTotal, transDone: transDone, failed: failed });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/vconv/reset  {failedOnly:true}
  app.post('/api/vconv/reset', express.json(), function (req, res) {
    try {
      var sql = (req.body && req.body.failedOnly)
        ? "UPDATE photos SET web_ready = 0 WHERE web_ready = -1"
        : "UPDATE photos SET web_ready = 0 WHERE media_type='video'";
      var n = getDb().prepare(sql).run().changes;
      res.json({ ok: true, reset: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 网页启停开关(2026-08-13加, 跟DTS巡检那套同一模式) ──
  // running只存内存, 服务重启自动回到false, PC端助手轮询到false就自己停下
  var vconvRunning = false;
  // 2026-08-17加: 独立心跳(跟vconvCurrentAt分开) -- 主循环每轮(不管有没有活干)都会
  // 调用一次, 用来判断PC端进程是不是真的还活着(不是靠开关状态, 开关开着不代表进程没死)
  var vconvLastHeartbeat = 0;

  // POST /api/vconv/control  {action:'start'|'stop'}
  app.post('/api/vconv/control', express.json(), function (req, res) {
    var action = (req.body && req.body.action) || '';
    if (action === 'start') vconvRunning = true;
    else if (action === 'stop') vconvRunning = false;
    else return res.status(400).json({ error: 'action 必须是 start 或 stop' });
    res.json({ ok: true, running: vconvRunning });
  });

  // 当前正在处理的文件(2026-08-13加): PC端助手每开始处理就上报一次
  var vconvCurrent = null;
  var vconvCurrentAt = 0;

  // POST /api/vconv/current  {path, mode}  —— PC端agent只上报path/mode, 没有md5,
  // 靠path反查队列里对应哪条, 标记成"处理中"给转换页面看
  app.post('/api/vconv/current', express.json({ limit: '64kb' }), function (req, res) {
    vconvCurrent = (req.body && req.body.path) ? { path: req.body.path, mode: req.body.mode || '' } : null;
    vconvCurrentAt = Date.now();
    if (vconvCurrent) {
      for (var i = 0; i < priorityQueue.length; i++) {
        if (priorityQueue[i].path === vconvCurrent.path && priorityQueue[i].status === 'queued') {
          priorityQueue[i].status = 'processing';
        }
      }
    }
    res.json({ ok: true });
  });

  // POST /api/vconv/heartbeat  2026-08-17加: PC端主循环每轮调用一次, 不管有没有活干
  app.post('/api/vconv/heartbeat', function (req, res) {
    vconvLastHeartbeat = Date.now();
    res.json({ ok: true });
  });

  // GET /api/vconv/status  网页轮询显示进度, PC端助手轮询决定要不要干活
  app.get('/api/vconv/status', function (req, res) {
    try {
      var db = getDb();
      var rows = db.prepare(
        "SELECT path, vcodec, web_ready, dts_bad FROM photos WHERE media_type='video' AND vcodec IS NOT NULL"
      ).all();
      var remuxTotal = 0, remuxDone = 0, transTotal = 0, transDone = 0, failed = 0;
      rows.forEach(function (r) {
        var ext = (r.path.match(/\.([A-Za-z0-9]{1,5})$/) || [])[1] || '';
        var cls = classify(ext, r.vcodec, r.dts_bad);
        if (r.web_ready === -1) failed++;
        if (cls === 'remux') { remuxTotal++; if (r.web_ready > 0) remuxDone++; }
        if (cls === 'transcode') { transTotal++; if (r.web_ready > 0) transDone++; }
      });
      // 超过5分钟没更新, 大概率这个文件早处理完了/助手换批次没上报, 不再当"当前"展示
      var current = (Date.now() - vconvCurrentAt < 5 * 60 * 1000) ? vconvCurrent : null;
      res.json({ running: vconvRunning, remuxTotal: remuxTotal, remuxDone: remuxDone,
                 transTotal: transTotal, transDone: transDone, failed: failed, current: current,
                 agentAlive: (Date.now() - Math.max(vconvLastHeartbeat, vconvCurrentAt) < 15 * 60 * 1000) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
