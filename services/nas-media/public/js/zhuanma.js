/*
 * zhuanma.js — "无损转码"(准确说是无损修复): 编码本身浏览器兼容(h264/vp8/vp9/av1/theora)
 * 但因为容器格式不对/DTS时间戳损坏导致网页播放不了(黑屏/播不出来)的视频, 用
 * "流拷贝(-c copy) + 重建时间戳(-fflags +genpts)"方式修复——不touch任何一帧画面/音频
 * 采样数据, 修复前后内容逐帧一致, 这才是真正意义上的无损。
 *
 * 编码本身浏览器不认的(mpeg4/wmv系/rv系/hevc等), 无损做不到——改变编码格式必然有代际
 * 画质损失。这类视频这里只标记出来、列出来, 不做任何处理, 需要走video-conv.js那套
 * 有损转码流程(依赖PC端GPU代理VconvAgent.ps1)。
 *
 * 流程: ①扫描分类(只读, 快) -> ②列表查看(哪些能无损修好, 哪些做不到) -> ③批量修复
 * (只处理"能无损"的那批, 每条独立验证: 用ffprobe比对修复前后时长, 对不上就直接放弃、
 * 不碰这个文件, 验证通过才用修复版顶替原文件, 原文件挪进.zhuanma_trash留后悔药)。
 */
const fs = require('fs');
const vk = require('./video-key.js');
const path = require('path');
const { execFile } = require('child_process');

module.exports = function (app, getDb) {
  const OK_CODEC = ['h264', 'avc1', 'vp8', 'vp9', 'av1', 'av01', 'theora'];
  const OK_CODEC_SQL = OK_CODEC.map((c) => "'" + c + "'").join(',');

  // 跟video-migrate.js/video-conv.js同款的入库路径->真实磁盘路径解析规则(各自独立一份,
  // 保持模块自包含, 不互相依赖)
  const _cachedevCache = {};
  function toRealPath(dbPath) {
    if (dbPath.indexOf('/share/CACHEDEV') === 0) return dbPath;
    const m = dbPath.match(/^\/share\/([^\/]+)(\/.*)?$/);
    if (!m) return dbPath;
    const shareName = m[1], rest = m[2] || '';
    if (Object.prototype.hasOwnProperty.call(_cachedevCache, shareName)) {
      const cached = _cachedevCache[shareName];
      return cached ? ('/share/' + cached + '/' + shareName + rest) : dbPath;
    }
    for (let i = 1; i <= 8; i++) {
      const cand = '/share/CACHEDEV' + i + '_DATA/' + shareName + rest;
      try { if (fs.existsSync(cand)) { _cachedevCache[shareName] = 'CACHEDEV' + i + '_DATA'; return cand; } } catch (e) {}
    }
    _cachedevCache[shareName] = null;
    return dbPath;
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
  function losslessRemux(srcPath, destPath) {
    return new Promise((resolve, reject) => {
      // maxBuffer: 部分源文件流本身有损坏(NAL单元损坏等), ffmpeg会刷大量警告到stderr,
      // 默认1MB缓冲区很容易爆——但这些警告本身不代表修复一定失败, 真正靠不靠谱交给后面
      // 的时长核对来判断, 这里只是别让Node自己的缓冲区限制抢先误判成失败。
      execFile('ffmpeg', ['-y', '-fflags', '+genpts', '-i', srcPath, '-c', 'copy', '-avoid_negative_ts', 'make_zero', destPath],
        { timeout: 600000, maxBuffer: 100 * 1024 * 1024 }, (err) => { if (err) reject(err); else resolve(); });
    });
  }
  // 旧的有损转码副本路径(跟video-conv.js的convBase同一套命名规则), 修好之后这份就没用了, 删掉省空间
  function oldTranscodePath(dbPath) {
    const m = dbPath.match(/^(\/share\/[^\/]+)(\/.*)?\/([^\/]+)\.[A-Za-z0-9]{1,5}$/);
    if (!m) return null;
    const root = m[1], mid = m[2] || '', name = m[3];
    return root + '/转换' + mid + '/' + name + '_转码.mp4';
  }

  // ── ①扫描分类(只读, 快) ──
  app.get('/api/zhuanma/scan', (req, res) => {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT vcodec, web_ready, COUNT(*) c FROM photos WHERE media_type='video' GROUP BY vcodec, web_ready").all();
      let alreadyOk = 0, losslessFixable = 0, needsLossyTranscode = 0;
      for (const r of rows) {
        if (r.web_ready === 1) { alreadyOk += r.c; continue; }
        const codec = String(r.vcodec || '').toLowerCase();
        if (OK_CODEC.indexOf(codec) >= 0) losslessFixable += r.c;
        // web_ready=2 是"有损转码已完成"(旁边"转换/"目录里有_转码.mp4副本, 网页播的就是它),
        // 原文件编码浏览器虽然不认, 但已经转过了, 不能再算"需要转码"(2026-09-29: 之前这里
        // 把已转完的1224个也算进去了, 统计出来3467个, 其实真正没转的只有2243个)
        else if (r.web_ready === 2) alreadyOk += r.c;
        else needsLossyTranscode += r.c;
      }
      res.json({ alreadyOk, losslessFixable, needsLossyTranscode });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── ②列表查看 ──
  app.get('/api/zhuanma/list', (req, res) => {
    try {
      const db = getDb();
      const type = req.query.type === 'lossy' ? 'lossy' : 'lossless';
      const limit = Math.min(20000, Math.max(1, parseInt(req.query.limit || '200', 10) || 200));
      const codecCond = type === 'lossless'
        ? `vcodec IN (${OK_CODEC_SQL})`
        : `(vcodec IS NULL OR vcodec NOT IN (${OK_CODEC_SQL}))`;
      const where = `media_type='video' AND web_ready != 1 AND ${type === 'lossy' ? 'web_ready != 2 AND ' : ''}${codecCond}`;
      const total = db.prepare(`SELECT COUNT(*) c FROM photos WHERE ${where}`).get().c;
      const rows = db.prepare(`SELECT path, vcodec, size, dts_bad, web_ready FROM photos WHERE ${where} ORDER BY size DESC LIMIT ?`).all(limit);
      res.json({ items: rows, total });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── ③批量无损修复(只处理"能无损"的那批) ──
  async function fixOne(row) {
    const realOrig = toRealPath(row.path);
    if (!fs.existsSync(realOrig)) throw new Error('原文件不存在');
    const origDur = await ffprobeDuration(realOrig);
    if (!origDur) throw new Error('原文件本身读不出有效时长, 不敢拿它当基准, 已跳过');

    const newPath = realOrig.replace(/\.[A-Za-z0-9]{1,5}$/, '.mp4');
    // 安全检查: 目标位置已经有别的文件/DB记录就直接放弃, 不产生任何文件层面的动作
    // (换壳去重那边吃过一次亏: 目标已有别的文件时被静默覆盖, 见2026-09-26修复记录)
    if (newPath !== realOrig && fs.existsSync(newPath)) {
      throw new Error('目标位置已存在另一个文件(' + path.basename(newPath) + '), 为避免覆盖已跳过');
    }
    const dbNewPath = row.path.replace(/\.[A-Za-z0-9]{1,5}$/, '.mp4');
    const db0 = getDb();
    if (dbNewPath !== row.path) {
      const dup = db0.prepare('SELECT id FROM photos WHERE path = ?').get(dbNewPath);
      if (dup) throw new Error('数据库里已经有记录指向目标路径, 为避免覆盖已跳过');
    }

    const tmpFixed = realOrig + '.zhuanma.mp4';
    await losslessRemux(realOrig, tmpFixed);

    const fixedDur = await ffprobeDuration(tmpFixed);
    if (!fixedDur || Math.abs(fixedDur - origDur) > Math.max(2, origDur * 0.02)) {
      try { fs.unlinkSync(tmpFixed); } catch (e) {}
      throw new Error('修复后时长对不上(原' + origDur.toFixed(1) + 's, 修复后' + (fixedDur || 0).toFixed(1) + 's), 已跳过不替换, 原文件未动');
    }

    // 验证通过: 原文件进.zhuanma_trash(独立于video-migrate的回收目录, 便于区分是哪个
    // 功能挪的), 修复版顶替原位置
    const trashDir = path.join(path.dirname(realOrig), '.zhuanma_trash');
    fs.mkdirSync(trashDir, { recursive: true });
    const trashPath = path.join(trashDir, path.basename(realOrig));
    fs.renameSync(realOrig, trashPath);
    fs.renameSync(tmpFixed, newPath);
    const st = fs.statSync(newPath);
    // 2026-09-29: 视频key=快速内容指纹(video-key.js)。修复=文件字节变了, key也跟着变, 下面用remapKey把
    // 标签/标记/特征/缩略图一起改过去并记变更历史(不再用文件名哈希)。
    const finalMd5 = vk.quickKey(newPath);

    // 旧的有损转码副本(如果之前被误转过)不再需要, 删掉省空间
    const oldConv = oldTranscodePath(row.path);
    if (oldConv) { try { fs.unlinkSync(toRealPath(oldConv)); } catch (e) {} }

    const oldMd5 = row.md5;
    const dbrw = getDb();
    const tx = dbrw.transaction(() => {
      dbrw.prepare("UPDATE photos SET path=?, md5=?, size=?, web_ready=1, dts_bad=0, updated_at=strftime('%s','now') WHERE path=?")
        .run(dbNewPath, finalMd5, st.size, row.path);
      if (oldMd5 && oldMd5 !== finalMd5) vk.remapKey(dbrw, oldMd5, finalMd5, { path: dbNewPath, reason: 'zhuanma' });
    });
    tx();
    return { newPath: dbNewPath, finalMd5, trashPath, duration: fixedDur };
  }

  const tasks = {};
  let lastTaskId = null;
  function newTaskId() { return 'zm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

  app.post('/api/zhuanma/fix/start', (req, res) => {
    const db = getDb();
    const rows = db.prepare(`SELECT path, md5, vcodec FROM photos WHERE media_type='video' AND web_ready != 1 AND vcodec IN (${OK_CODEC_SQL})`).all();
    if (!rows.length) return res.status(400).json({ error: '没有可以无损修复的视频' });
    const tid = newTaskId();
    lastTaskId = tid;
    const task = tasks[tid] = {
      status: 'running', total: rows.length, done: 0,
      okCount: 0, failCount: 0, currentPath: null, results: [], stopRequested: false,
    };
    res.json({ ok: true, taskId: tid, total: rows.length });
    (async () => {
      for (const row of rows) {
        if (task.stopRequested) { task.status = 'stopped'; task.currentPath = null; return; }
        task.currentPath = row.path;
        try { const r = await fixOne(row); task.results.push({ path: row.path, ok: true, ...r }); task.okCount++; }
        catch (e) { task.results.push({ path: row.path, ok: false, error: e.message }); task.failCount++; }
        task.done++;
      }
      task.status = 'done';
      task.currentPath = null;
    })().catch((e) => { task.status = 'error'; task.error = e.message; });
  });
  app.get('/api/zhuanma/fix/progress/:taskId', (req, res) => res.json(tasks[req.params.taskId] || { status: 'unknown' }));
  app.get('/api/zhuanma/fix/current', (req, res) => {
    if (!lastTaskId) return res.json({ status: 'none' });
    res.json(Object.assign({ taskId: lastTaskId }, tasks[lastTaskId] || { status: 'unknown' }));
  });
  app.post('/api/zhuanma/fix/stop/:taskId', (req, res) => {
    const t = tasks[req.params.taskId];
    if (!t) return res.json({ ok: false });
    t.stopRequested = true;
    res.json({ ok: true });
  });

  // ── ④验证+释放空间(2026-09-26加) ──
  // 修复只是把"原文件挪进.zhuanma_trash", 净空间没变(原文件还占着地方); 要先用ffprobe验证
  // 顶替上去的新文件确实能正常读出完整时长, 验证通过才删trash里的原文件, 真正腾出空间。
  // 跟video-migrate.js的verify-and-clear同一个思路, 但这里不依赖内存态的任务对象——直接
  // 扫web_ready=1的视频, 找它们目录下.zhuanma_trash里对应的原文件(按去掉扩展名之后的
  // 文件名前缀匹配, 因为改名时只换了扩展名, 主文件名不变), 存在就是这次(或以前某次)
  // zhuanma修复留下的, 不管进程重启多少次都能找全, 比内存态任务列表更可靠。
  function findTrashCounterpart(realNewPath) {
    const dir = path.dirname(realNewPath);
    const trashDir = path.join(dir, '.zhuanma_trash');
    const baseNoExt = path.basename(realNewPath).replace(/\.[A-Za-z0-9]{1,5}$/, '');
    let entries;
    try { entries = fs.readdirSync(trashDir); } catch (e) { return null; }
    const hit = entries.find((f) => f.indexOf(baseNoExt + '.') === 0 || f === baseNoExt);
    return hit ? path.join(trashDir, hit) : null;
  }

  const verifyTasks = {};
  let lastVerifyTaskId = null;
  app.post('/api/zhuanma/verify-and-clear', (req, res) => {
    const db = getDb();
    const rows = db.prepare(`SELECT path FROM photos WHERE media_type='video' AND web_ready=1 AND path LIKE '%.mp4'`).all();
    const candidates = [];
    for (const row of rows) {
      const realNewPath = toRealPath(row.path);
      const trashPath = findTrashCounterpart(realNewPath);
      if (trashPath) candidates.push({ path: row.path, newPath: realNewPath, trashPath });
    }
    if (!candidates.length) return res.status(400).json({ error: '没有找到zhuanma修复留下的待清理项(可能还没修复过, 或者已经清过了)' });
    const tid = newTaskId();
    lastVerifyTaskId = tid;
    const task = verifyTasks[tid] = {
      status: 'running', total: candidates.length, done: 0,
      verifiedOk: 0, verifyFailed: 0, freedBytes: 0, currentPath: null,
      failedItems: [], stopRequested: false,
    };
    res.json({ ok: true, taskId: tid, total: candidates.length });
    (async () => {
      for (const c of candidates) {
        if (task.stopRequested) { task.status = 'stopped'; task.currentPath = null; return; }
        task.currentPath = c.newPath;
        const dur = await ffprobeDuration(c.newPath);
        if (!dur) {
          task.verifyFailed++;
          task.failedItems.push({ path: c.path, trashPath: c.trashPath, reason: '新文件读不出有效时长, 保留trash原文件不删' });
        } else {
          task.verifiedOk++;
          try {
            const sz = fs.statSync(c.trashPath).size;
            fs.unlinkSync(c.trashPath);
            task.freedBytes += sz;
          } catch (e) {}
        }
        task.done++;
      }
      task.status = 'done';
      task.currentPath = null;
    })().catch((e) => { task.status = 'error'; task.error = e.message; });
  });
  app.get('/api/zhuanma/verify-and-clear/progress/:taskId', (req, res) => res.json(verifyTasks[req.params.taskId] || { status: 'unknown' }));
  app.get('/api/zhuanma/verify-and-clear/current', (req, res) => {
    if (!lastVerifyTaskId) return res.json({ status: 'none' });
    res.json(Object.assign({ taskId: lastVerifyTaskId }, verifyTasks[lastVerifyTaskId] || { status: 'unknown' }));
  });
  app.post('/api/zhuanma/verify-and-clear/stop/:taskId', (req, res) => {
    const t = verifyTasks[req.params.taskId];
    if (!t) return res.json({ ok: false });
    t.stopRequested = true;
    res.json({ ok: true });
  });

  console.log('[zhuanma] 初始化完成(无损转码: 只处理编码兼容但容器/时间戳有问题的视频)');
};
