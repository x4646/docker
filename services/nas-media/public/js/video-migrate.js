/*
 * video-migrate.js — "换壳去重"体检+替换。
 * 阶段①体检(只读, 不动文件): ffprobe比对原文件跟换壳文件的音视频/字幕轨道数+时长是否一致,
 *   结果存进video_migrate_check表, 顺手把换壳文件md5也算出来存着备用。
 * 阶段②替换(真正动文件, 只对阶段①判定"ok"的执行): 给换壳文件打上md5标识(mp4 metadata),
 *   原文件挪进回收目录(不直接删), 换壳文件顶替原文件的位置, 数据库同步更新path/md5/size。
 */
const fs = require('fs');
const path = require('path');
const vk = require('./video-key.js');
const express = require('express');
const { execFile } = require('child_process');
const { Worker } = require('worker_threads');

module.exports = function (app, getDb) {
  const tasks = {};
  function newTaskId() { return 'vm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

  // 跟video-conv.js/video-migrate-worker-thread.js保持一致的入库路径->真实磁盘路径解析规则
  var _cachedevCache = {};
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
      try { if (fs.existsSync(cand)) { _cachedevCache[shareName] = 'CACHEDEV' + i + '_DATA'; return cand; } } catch (e) {}
    }
    _cachedevCache[shareName] = null;
    return dbPath;
  }

  // 最近一次体检任务的taskId——不管是这个浏览器发起的还是别的方式发起的(比如我调试时
  // 用curl手动触发), 前端刷新页面后不用记住taskId、也不用猜, 直接查这个就知道"现在有没有
  // 在跑、跑到哪了"。(这是内存态, 跟tasks一样撑不过进程重启, 但至少同一次进程运行期间
  // 不用靠浏览器localStorage去凑, 别的设备打开页面也能看到同一个状态)
  let lastCheckTaskId = null;

  // ── 阶段①: 体检扫描(只读) ──
  app.post('/api/video-migrate/check/start', (req, res) => {
    const tid = newTaskId();
    lastCheckTaskId = tid;
    res.json({ ok: true, taskId: tid });
    const task = tasks[tid] = { type: 'check', status: 'running' };
    const worker = new Worker(path.join(__dirname, 'video-migrate-worker-thread.js'), { workerData: {} });
    task.worker = worker;
    worker.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'progress') Object.assign(task, msg.task || {});
      else if (msg.type === 'done') { task.status = 'done'; task.result = msg.result; }
      else if (msg.type === 'error') { task.status = 'error'; task.error = msg.message; }
    });
    worker.on('error', (e) => { task.status = 'error'; task.error = e.message; });
    worker.on('exit', () => { task.worker = null; });
  });
  app.get('/api/video-migrate/progress/:taskId', (req, res) => res.json(tasks[req.params.taskId] || { status: 'unknown' }));
  // 页面打开/刷新时用这个查"最近一次体检跑到哪了", 不用先知道taskId
  app.get('/api/video-migrate/check/current', (req, res) => {
    if (!lastCheckTaskId) return res.json({ status: 'none' });
    res.json(Object.assign({ taskId: lastCheckTaskId }, tasks[lastCheckTaskId] || { status: 'unknown' }));
  });
  app.post('/api/video-migrate/stop/:taskId', (req, res) => {
    const t = tasks[req.params.taskId];
    if (!t) return res.json({ ok: false });
    if (t.worker) { try { t.worker.terminate(); } catch (e) {} }
    t.status = 'stopped';
    res.json({ ok: true });
  });

  // 体检结果列表(分页, 按status筛选)
  app.get('/api/video-migrate/results', (req, res) => {
    try {
      const db = getDb();
      const status = req.query.status; // ok | mismatch | (不传=全部)
      const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
      const limit = Math.min(20000, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
      const where = status ? 'WHERE status = ?' : '';
      const args = status ? [status] : [];
      const total = db.prepare(`SELECT COUNT(*) c FROM video_migrate_check ${where}`).get(...args).c;
      const rows = db.prepare(`SELECT * FROM video_migrate_check ${where} ORDER BY checked_at DESC LIMIT ? OFFSET ?`)
        .all(...args, limit, (page - 1) * limit);
      const summary = db.prepare('SELECT status, COUNT(*) c FROM video_migrate_check GROUP BY status').all();
      res.json({ items: rows, total, page, limit, summary });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 流式算md5, 不整个读进内存——视频文件动辄几个GB, readFileSync会堵住主线程事件循环
  // (这是这个项目里反复踩过、反复强调要避开的一类bug)
  function md5FileAsync(filePath) {
    return new Promise((resolve, reject) => {
      const crypto = require('crypto');
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
  function ffmpegTag(srcPath, destPath, md5Tag) {
    return new Promise((resolve, reject) => {
      execFile('ffmpeg', ['-y', '-i', srcPath, '-c', 'copy', '-metadata', 'nas_src_md5=' + md5Tag, destPath], (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  // ── 阶段②: 替换(只对体检status='ok'的执行) ──
  // 抽成共用函数, 单条/批量都调它——批量就是循环调用, 每条独立成败, 一条失败不影响其他条。
  async function applyOne(origPath) {
    const db = getDb();
    const chk = db.prepare('SELECT * FROM video_migrate_check WHERE orig_path = ?').get(origPath);
    if (!chk) throw new Error('还没体检过这个文件');
    if (chk.status !== 'ok') throw new Error('体检没通过, 不能替换: ' + (chk.reason || ''));
    if (!chk.conv_path || !fs.existsSync(chk.conv_path)) throw new Error('换壳文件不存在了(可能已经处理过)');

    const realOrigOnDisk = toRealPath(chk.orig_path);
    if (!fs.existsSync(realOrigOnDisk)) throw new Error('原文件不存在(可能路径没对上CACHEDEV卷)');

    // 2026-09-26补(重要安全检查): 之前这里完全没检查"目标位置本来是不是已经有别的文件"就
    // 直接renameSync覆盖过去——真实吃过亏: 有些目录同名的.flv和.mp4其实是两份不同的文件
    // (比如.flv是原始录像, .mp4是早年单独压缩过的精简版), 覆盖过去等于把那份.mp4的真实内容
    // 静默销毁, 直到数据库层面因为path唯一约束报错才暴露出来, 但文件已经覆盖完了, 报错为时已晚。
    // 现在提前到任何ffmpeg/改名动作之前就做这个检查, 一旦目标已经被别的文件占用, 直接中止,
    // 不产生任何副作用(不调ffmpeg、不动任何文件), 把"处理不了"这条留给人工判断。
    const newPathPreCheck = realOrigOnDisk.replace(/\.[A-Za-z0-9]{1,5}$/, '.mp4');
    if (newPathPreCheck !== realOrigOnDisk && fs.existsSync(newPathPreCheck)) {
      throw new Error('目标位置已存在另一个文件(' + path.basename(newPathPreCheck) + '), 为避免覆盖真实数据, 已跳过, 需要人工确认');
    }
    const dbNewPathPreCheck = chk.orig_path.replace(/\.[A-Za-z0-9]{1,5}$/, '.mp4');
    if (dbNewPathPreCheck !== chk.orig_path) {
      const dupRow = db.prepare('SELECT id FROM photos WHERE path = ?').get(dbNewPathPreCheck);
      if (dupRow) throw new Error('数据库里已经有一条记录指向目标路径(' + dbNewPathPreCheck + '), 为避免覆盖, 已跳过, 需要人工确认');
    }

    // 1) 给换壳文件打上md5标识(不追求跟文件自身最终字节精确吻合, 只是个身份标记, 方便以后
    //    程序识别"这份文件是从哪个原文件换壳来的、换壳文件本身长什么样", 打标签本身是一次
    //    快速的-c copy remux, 不重新编码。
    const taggedPath = chk.conv_path.replace(/_换壳\.mp4$/, '_tagged.mp4');
    await ffmpegTag(chk.conv_path, taggedPath, chk.conv_md5);

    // 2) 原文件挪进回收目录(不直接删, 留个后悔药), 目录结构跟原来对齐方便找
    const trashDir = path.join(path.dirname(realOrigOnDisk), '.video_migrate_trash');
    fs.mkdirSync(trashDir, { recursive: true });
    const trashPath = path.join(trashDir, path.basename(realOrigOnDisk));
    fs.renameSync(realOrigOnDisk, trashPath);

    // 3) 打好标签的换壳文件顶替原文件的位置(文件名沿用原名, 后缀统一改成.mp4)
    const newPath = realOrigOnDisk.replace(/\.[A-Za-z0-9]{1,5}$/, '.mp4');
    fs.renameSync(taggedPath, newPath);
    const st = fs.statSync(newPath);

    // 3.5) 2026-09-26补: 打标签用的是"新建一份tagged文件"而不是直接改名chk.conv_path,
    // 原来的_换壳.mp4从来没人删过——顶替完成之后这份源文件已经没用了(newPath就是它的
    // 等价物), 一直留着"转换/"目录里等于每替换一个就多攒一份重复空间, "去重"变成"占地更多",
    // 跟这个功能本来要省空间的目的正好相反。这里替换成功后立刻删掉它, 真正腾出空间。
    try { fs.unlinkSync(chk.conv_path); } catch (e) {}

    // 4) 真正落地文件的md5是打标签之后的最终字节, 现场重新算一次存进数据库(权威值,
    //    以后备份比对/去重等功能全靠这个字段, 必须是文件当前真实内容的md5, 不能用conv_md5
    //    这个打标签之前的近似值, 不然backup比对之类依赖真实md5的功能会全部对不上)
    const finalMd5 = vk.quickKey(newPath);

    // 数据库path用入库风格(去掉CACHEDEV卷号那一段, 跟原来photos.path格式保持一致)
    const dbNewPath = chk.orig_path.replace(/\.[A-Za-z0-9]{1,5}$/, '.mp4');
    const oldMd5 = chk.orig_md5;
    const dbrw = getDb();
    // 收藏/评分/AI标签/特征向量这几张表是按md5关联的(不是按path), md5一变这些记录就会
    // 跟"新"文件对不上号——必须在同一个事务里把这几张表的md5也一起改成finalMd5,
    // 不然用户的收藏/标签会在这次替换后无声丢失。
    const tx = dbrw.transaction(() => {
      dbrw.prepare("UPDATE photos SET path=?, md5=?, size=?, web_ready=1, updated_at=strftime('%s','now') WHERE path=?")
        .run(dbNewPath, finalMd5, st.size, chk.orig_path);
      if (oldMd5 && oldMd5 !== finalMd5) vk.remapKey(dbrw, oldMd5, finalMd5, { path: dbNewPath, reason: 'video-migrate' });
      dbrw.prepare("UPDATE video_migrate_check SET status='applied' WHERE orig_path=?").run(origPath);
    });
    tx();

    return { newPath: dbNewPath, finalMd5, trashPath };
  }

  // 每个origPath一个独立操作, 前端体检结果页勾选后逐条调用这个。
  // 2026-09-26补: 之前用的是Express默认100kb请求体上限, 单条origPath的JSON很小不受影响,
  // 但为了跟apply-batch保持一致(也避免以后单条接口被顺手拿去传更大的body), 一并放宽。
  app.post('/api/video-migrate/apply', express.json({ limit: '20mb' }), async (req, res) => {
    const origPath = req.body && req.body.origPath;
    if (!origPath) return res.status(400).json({ error: '缺少origPath' });
    try {
      const r = await applyOne(origPath);
      res.json({ ok: true, ...r });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 批量替换(2026-09-26重写) ──
  // 原来的实现有两个问题, 这次一并修:
  // ①请求体用的是Express默认100kb上限, 选中文件一多(几百上千条完整路径的JSON数组),
  //   请求还没进到业务代码就被body-parser直接拒了(PayloadTooLargeError/413)——
  //   前端拿到的是一次性失败, 不是"卡住不动", 只是没把这个错误显眼地展示出来,
  //   容易让人误以为"提交成功了、在后台默默跑"。这里放宽到20mb, 装下几万条路径够用。
  // ②原来是"一个HTTP请求从头堵到尾", 批量很大的时候(几千个视频, 每个都要ffmpeg转封装
  //   +流式算整个文件的md5, IO/CPU都不轻)必然跑很久, 大概率撞上nas-web那边30秒的代理
  //   超时, 而且过程中前端完全看不到进度、不知道处理到哪个文件了。改成跟"体检"阶段
  //   同一套路子: 接口立刻返回taskId, 循环在后台异步跑, 进度写进内存态的applyTasks,
  //   前端凭taskId轮询; 页面刷新/重开也能凭lastApplyTaskId查到"现在有没有在跑、跑到哪"。
  const applyTasks = {};
  let lastApplyTaskId = null;
  app.post('/api/video-migrate/apply-batch', express.json({ limit: '20mb' }), (req, res) => {
    const origPaths = Array.isArray(req.body && req.body.origPaths) ? req.body.origPaths : [];
    if (!origPaths.length) return res.status(400).json({ error: '没有选中任何项' });
    const tid = newTaskId();
    lastApplyTaskId = tid;
    const task = applyTasks[tid] = {
      type: 'apply', status: 'running', total: origPaths.length, done: 0,
      okCount: 0, failCount: 0, currentPath: null, results: [], stopRequested: false,
    };
    res.json({ ok: true, taskId: tid });

    (async () => {
      for (const p of origPaths) {
        if (task.stopRequested) { task.status = 'stopped'; task.currentPath = null; return; }
        task.currentPath = p;
        try { const r = await applyOne(p); task.results.push({ origPath: p, ok: true, ...r }); task.okCount++; }
        catch (e) { task.results.push({ origPath: p, ok: false, error: e.message }); task.failCount++; }
        task.done++;
      }
      task.status = 'done';
      task.currentPath = null;
    })().catch((e) => { task.status = 'error'; task.error = e.message; });
  });
  app.get('/api/video-migrate/apply/progress/:taskId', (req, res) => res.json(applyTasks[req.params.taskId] || { status: 'unknown' }));
  // 跟check/current同一个道理: 页面刷新/换个设备打开, 不用先知道taskId就能查到"最近一次
  // 批量替换现在是什么状态"。
  app.get('/api/video-migrate/apply/current', (req, res) => {
    if (!lastApplyTaskId) return res.json({ status: 'none' });
    res.json(Object.assign({ taskId: lastApplyTaskId }, applyTasks[lastApplyTaskId] || { status: 'unknown' }));
  });
  app.post('/api/video-migrate/apply/stop/:taskId', (req, res) => {
    const t = applyTasks[req.params.taskId];
    if (!t) return res.json({ ok: false });
    t.stopRequested = true; // 协作式停止: 当前这一条正在跑的ffmpeg/md5不会被中途打断, 处理完这条就收手
    res.json({ ok: true });
  });

  // ── 阶段③(2026-09-26加): 验证+清空trash, 真正释放空间 ──
  // 替换只是把"两份重复"变成"一份在原位+一份在trash", 净空间没变, 要清trash才是真正
  // 释放。为了不是无脑清, 清之前先用ffprobe验一遍newPath(顶替上去的换壳版)是不是真的
  // 是个能正常读出时长的完整视频文件——验证不过的那一份, trash原文件保留不动, 不删,
  // 留给人工确认; 只有验证通过的才删trash里的原文件。
  const verifyTasks = {};
  let lastVerifyTaskId = null;
  function ffprobeOk(filePath) {
    return new Promise((resolve) => {
      execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
        { timeout: 30000 }, (err, stdout) => {
          if (err) return resolve({ ok: false, reason: 'ffprobe失败: ' + err.message });
          const dur = parseFloat(stdout);
          if (!dur || dur <= 0) return resolve({ ok: false, reason: '读不到有效时长: ' + JSON.stringify(stdout) });
          resolve({ ok: true, duration: dur });
        });
    });
  }
  // 2026-09-26改: 原来想直接吃内存里的applyTasks[taskId], 但部署这个新接口本身就要重启进程,
  // 一重启内存态就没了(applyTasks是普通对象, 不落盘)。改成直接查video_migrate_check表里
  // status='applied'的全部记录, 现算newPath/trashPath——这张表是持久化的, 不管进程重启多少次
  // 都能拿到完整、准确的"哪些已经替换成功"清单, 比依赖内存态的任务对象更可靠。
  app.post('/api/video-migrate/verify-and-clear', (req, res) => {
    const db = getDb();
    const rows = db.prepare("SELECT orig_path FROM video_migrate_check WHERE status='applied'").all();
    const items = rows.map(row => {
      const real = toRealPath(row.orig_path);
      const newPath = real.replace(/\.[A-Za-z0-9]{1,5}$/, '.mp4');
      const trashPath = path.join(path.dirname(real), '.video_migrate_trash', path.basename(real));
      return { origPath: row.orig_path, newPath, trashPath };
    });
    if (!items.length) return res.status(400).json({ error: '没有已替换成功的项' });
    const tid = newTaskId();
    lastVerifyTaskId = tid;
    const task = verifyTasks[tid] = {
      type: 'verify', status: 'running', total: items.length, done: 0,
      verifiedOk: 0, verifyFailed: 0, freedBytes: 0, currentPath: null,
      failedItems: [], stopRequested: false,
    };
    res.json({ ok: true, taskId: tid });

    (async () => {
      for (const r of items) {
        if (task.stopRequested) { task.status = 'stopped'; task.currentPath = null; return; }
        task.currentPath = r.newPath;
        const chk = await ffprobeOk(r.newPath);
        if (!chk.ok) {
          task.verifyFailed++;
          task.failedItems.push({ path: r.newPath, trashPath: r.trashPath, reason: chk.reason });
        } else {
          task.verifiedOk++;
          try {
            const sz = fs.statSync(r.trashPath).size;
            fs.unlinkSync(r.trashPath);
            task.freedBytes += sz;
          } catch (e) {}
        }
        task.done++;
      }
      task.status = 'done';
      task.currentPath = null;
    })().catch((e) => { task.status = 'error'; task.error = e.message; });
  });
  app.get('/api/video-migrate/verify-and-clear/progress/:taskId', (req, res) => res.json(verifyTasks[req.params.taskId] || { status: 'unknown' }));
  app.get('/api/video-migrate/verify-and-clear/current', (req, res) => {
    if (!lastVerifyTaskId) return res.json({ status: 'none' });
    res.json(Object.assign({ taskId: lastVerifyTaskId }, verifyTasks[lastVerifyTaskId] || { status: 'unknown' }));
  });
  app.post('/api/video-migrate/verify-and-clear/stop/:taskId', (req, res) => {
    const t = verifyTasks[req.params.taskId];
    if (!t) return res.json({ ok: false });
    t.stopRequested = true;
    res.json({ ok: true });
  });

  // ── 阶段④(2026-09-26加): DTS坏但编码本身兼容(h264)的视频, 无损修复替换原文件 ──
  // 背景: video-conv.js对"dts_bad"标记的视频一律走transcode(NVENC重新编码), 但如果
  // 视频编码本身就是h264(浏览器原生支持), 真正坏的只是时间戳, 用不着重新编码画面数据——
  // 只需要"流拷贝(-c copy) + 重新生成时间戳(-fflags +genpts)", 这是真正无损的操作(不touch
  // 任何一帧像素/音频采样), 比强行转码画质更好、文件更小、速度也快得多(不用真正编码,
  // 纯粹按原始码流拷贝)。修复后跟"换壳去重"同一套安全流程: 先验证(ffprobe时长对不上原文件
  // 就直接放弃、不动任何文件), 验证通过才用修复版顶替原文件(原文件进trash留后悔药),
  // 顺手删掉旧的有损转码副本(不再需要, 省空间)。
  function convBase(dbPath, suffix) {
    const m = dbPath.match(/^(\/share\/[^\/]+)(\/.*)?\/([^\/]+)\.[A-Za-z0-9]{1,5}$/);
    if (!m) return null;
    const root = m[1], mid = m[2] || '', name = m[3];
    return root + '/转换' + mid + '/' + name + '_转码.mp4';
  }
  function ffprobeDuration(filePath) {
    return new Promise((resolve) => {
      execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
        { timeout: 30000 }, (err, stdout) => {
          if (err) return resolve(null);
          const d = parseFloat(stdout);
          resolve(Number.isFinite(d) && d > 0 ? d : null);
        });
    });
  }
  function remuxFixTimestamps(srcPath, destPath) {
    return new Promise((resolve, reject) => {
      execFile('ffmpeg', ['-y', '-fflags', '+genpts', '-i', srcPath, '-c', 'copy', '-avoid_negative_ts', 'make_zero', destPath],
        { timeout: 600000 }, (err) => { if (err) reject(err); else resolve(); });
    });
  }
  async function dtsFixOne(row) {
    const realOrig = toRealPath(row.path);
    if (!fs.existsSync(realOrig)) throw new Error('原文件不存在');
    const origDur = await ffprobeDuration(realOrig);
    if (!origDur) throw new Error('原文件本身读不出有效时长, 跳过(不敢拿它当基准)');

    const newPath = realOrig.replace(/\.[A-Za-z0-9]{1,5}$/, '.mp4');
    // 跟applyOne同款的目标覆盖安全检查: 目标位置已经有别的文件/DB记录就直接放弃,
    // 不产生任何文件层面的动作。
    if (newPath !== realOrig && fs.existsSync(newPath)) {
      throw new Error('目标位置已存在另一个文件(' + path.basename(newPath) + '), 为避免覆盖已跳过');
    }
    const dbNewPath = row.path.replace(/\.[A-Za-z0-9]{1,5}$/, '.mp4');
    const db0 = getDb();
    if (dbNewPath !== row.path) {
      const dupRow = db0.prepare('SELECT id FROM photos WHERE path = ?').get(dbNewPath);
      if (dupRow) throw new Error('数据库里已经有记录指向目标路径, 为避免覆盖已跳过');
    }

    const tmpFixed = realOrig + '.dtsfix.mp4';
    await remuxFixTimestamps(realOrig, tmpFixed);

    const fixedDur = await ffprobeDuration(tmpFixed);
    if (!fixedDur || Math.abs(fixedDur - origDur) > Math.max(2, origDur * 0.02)) {
      try { fs.unlinkSync(tmpFixed); } catch (e) {}
      throw new Error('修复后时长对不上(原' + origDur.toFixed(1) + 's, 修复后' + (fixedDur || 0).toFixed(1) + 's), 已跳过不替换, 原文件未动');
    }

    // 验证通过: 原文件进trash, 修复版顶替原位置(流程跟换壳替换完全一致)
    const trashDir = path.join(path.dirname(realOrig), '.video_migrate_trash');
    fs.mkdirSync(trashDir, { recursive: true });
    const trashPath = path.join(trashDir, path.basename(realOrig));
    fs.renameSync(realOrig, trashPath);
    fs.renameSync(tmpFixed, newPath);
    const st = fs.statSync(newPath);
    const finalMd5 = vk.quickKey(newPath);

    // 旧的有损转码副本不再需要, 删掉省空间
    const oldConv = convBase(row.path, '转码');
    if (oldConv) { try { fs.unlinkSync(toRealPath(oldConv)); } catch (e) {} }

    const oldMd5 = row.md5;
    const dbrw = getDb();
    const tx = dbrw.transaction(() => {
      dbrw.prepare("UPDATE photos SET path=?, md5=?, size=?, web_ready=1, dts_bad=0, updated_at=strftime('%s','now') WHERE path=?")
        .run(dbNewPath, finalMd5, st.size, row.path);
      if (oldMd5 && oldMd5 !== finalMd5) vk.remapKey(dbrw, oldMd5, finalMd5, { path: dbNewPath, reason: 'video-migrate' });
    });
    tx();
    return { newPath: dbNewPath, finalMd5, trashPath, duration: fixedDur };
  }

  const dtsFixTasks = {};
  let lastDtsFixTaskId = null;
  app.post('/api/video-migrate/dts-fix/start', (req, res) => {
    const db = getDb();
    const rows = db.prepare("SELECT path, md5, vcodec FROM photos WHERE media_type='video' AND web_ready=2 AND vcodec='h264'").all();
    if (!rows.length) return res.status(400).json({ error: '没有符合条件的视频(h264编码但走了转码路径的)' });
    const tid = newTaskId();
    lastDtsFixTaskId = tid;
    const task = dtsFixTasks[tid] = {
      type: 'dtsfix', status: 'running', total: rows.length, done: 0,
      okCount: 0, failCount: 0, currentPath: null, results: [], stopRequested: false,
    };
    res.json({ ok: true, taskId: tid, total: rows.length });
    (async () => {
      for (const row of rows) {
        if (task.stopRequested) { task.status = 'stopped'; task.currentPath = null; return; }
        task.currentPath = row.path;
        try { const r = await dtsFixOne(row); task.results.push({ path: row.path, ok: true, ...r }); task.okCount++; }
        catch (e) { task.results.push({ path: row.path, ok: false, error: e.message }); task.failCount++; }
        task.done++;
      }
      task.status = 'done';
      task.currentPath = null;
    })().catch((e) => { task.status = 'error'; task.error = e.message; });
  });
  app.get('/api/video-migrate/dts-fix/progress/:taskId', (req, res) => res.json(dtsFixTasks[req.params.taskId] || { status: 'unknown' }));
  app.get('/api/video-migrate/dts-fix/current', (req, res) => {
    if (!lastDtsFixTaskId) return res.json({ status: 'none' });
    res.json(Object.assign({ taskId: lastDtsFixTaskId }, dtsFixTasks[lastDtsFixTaskId] || { status: 'unknown' }));
  });
  app.post('/api/video-migrate/dts-fix/stop/:taskId', (req, res) => {
    const t = dtsFixTasks[req.params.taskId];
    if (!t) return res.json({ ok: false });
    t.stopRequested = true;
    res.json({ ok: true });
  });

  console.log('[video-migrate] 接口挂载完成');
};
