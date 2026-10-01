/*
 * conv-replace.js — 已经有"_转码.mp4"副本(web_ready=2)的视频, 用转码副本顶替原文件, 省一份空间。
 * 规则(用户2026-09-29定): BAK共享下的一律保留原文件不动, 其他共享(Person/Media...)可以替换;
 * 2026-09-30补: 超过6GB的视频也保留原文件(不转码、不顶替)。
 *
 * 每条独立、可回滚: 先核对副本(时长跟原文件对得上、编码是h264), 再原文件挪进同目录
 * .conv_replace_trash、副本改名顶替原位置, 顶替后再ffprobe验一遍新文件时长, 通过才删trash里
 * 的原文件; 没通过就原样改回去。视频的md5字段=快速内容指纹(video-key.js), 顶替后字节变了就
 * 按新文件重算key并remapKey。
 */
const fs = require('fs');
const vk = require('./video-key.js');
const path = require('path');
const VTHUMB_DIR = '/share/Container/docker/services/nas-media/vthumbs';
const { execFile } = require('child_process');

module.exports = function (app, getDb) {
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
  function convCopyPath(dbPath) {
    const m = dbPath.match(/^(\/share\/[^\/]+)(\/.*)?\/([^\/]+)\.[A-Za-z0-9]{1,5}$/);
    return m ? m[1] + '/转换' + (m[2] || '') + '/' + m[3] + '_转码.mp4' : null;
  }
  const isBak = (p) => String(p.split('/')[2] || '').toLowerCase() === 'bak';
  const yieldLoop = () => new Promise((r) => setImmediate(r));

  function probe(filePath) {
    return new Promise((resolve) => {
      execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', filePath],
        { timeout: 30000 }, (err, stdout) => {
          if (err) return resolve(null);
          try {
            const j = JSON.parse(stdout);
            const d = parseFloat(j.format && j.format.duration);
            resolve({ duration: Number.isFinite(d) && d > 0 ? d : null, codec: j.streams && j.streams[0] && j.streams[0].codec_name });
          } catch (e) { resolve(null); }
        });
    });
  }
  const durOk = (a, b) => a && b && Math.abs(a - b) <= Math.max(2, a * 0.02);

  function candidates() {
    const rows = getDb().prepare("SELECT path, md5, size FROM photos WHERE media_type='video' AND web_ready=2").all();
    const out = [];
    for (const r of rows) {
      if (isBak(r.path)) continue;
      if ((r.size || 0) > 6e9) continue;   // 规则: 超过6GB的保留源文件, 不顶替不删
      const cp = convCopyPath(r.path);
      if (!cp) continue;
      const realCopy = toRealPath(cp);
      if (fs.existsSync(realCopy)) out.push({ path: r.path, md5: r.md5, size: r.size || 0, realCopy });
    }
    return out;
  }

  async function replaceOne(row) {
    const real = toRealPath(row.path);
    if (!fs.existsSync(real)) throw new Error('原文件不存在');
    const po = await probe(real), pc = await probe(row.realCopy);
    if (!po || !po.duration) throw new Error('原文件读不出时长, 没法核对副本, 已跳过');
    if (!pc || !pc.duration) throw new Error('转码副本读不出时长, 已跳过');
    if (pc.codec !== 'h264') throw new Error('转码副本编码不是h264(' + pc.codec + '), 已跳过');
    if (!durOk(po.duration, pc.duration)) throw new Error('副本时长对不上(原' + po.duration.toFixed(1) + 's/副本' + pc.duration.toFixed(1) + 's), 已跳过');

    const newReal = real.replace(/\.[A-Za-z0-9]{1,5}$/, '.mp4');
    const dbNew = row.path.replace(/\.[A-Za-z0-9]{1,5}$/, '.mp4');
    if (newReal !== real && fs.existsSync(newReal)) throw new Error('目标位置已存在另一个文件, 为避免覆盖已跳过');
    if (dbNew !== row.path && getDb().prepare('SELECT id FROM photos WHERE path = ?').get(dbNew)) throw new Error('数据库里已有记录指向目标路径, 已跳过');

    const trashDir = path.join(path.dirname(real), '.conv_replace_trash');
    fs.mkdirSync(trashDir, { recursive: true });
    const trashPath = path.join(trashDir, path.basename(real));
    fs.renameSync(real, trashPath);
    try { fs.renameSync(row.realCopy, newReal); }
    catch (e) { fs.renameSync(trashPath, real); throw new Error('副本改名失败, 已还原: ' + e.message); }

    const pn = await probe(newReal);
    if (!pn || !durOk(po.duration, pn.duration)) {
      try { fs.renameSync(newReal, row.realCopy); fs.renameSync(trashPath, real); } catch (e) {}
      throw new Error('顶替后新文件校验没通过, 已全部还原');
    }
    const st = fs.statSync(newReal);
    fs.unlinkSync(trashPath);
    try { fs.rmdirSync(trashDir); } catch (e) {}

    const db = getDb();
    // 顶替=文件字节变了, key按新文件重算(快速内容指纹), 标签/标记/特征/缩略图用remapKey跟过去
    const newKey = vk.quickKey(newReal);
    db.transaction(() => {
      db.prepare("UPDATE photos SET path=?, md5=?, size=?, vcodec='h264', web_ready=1, dts_bad=0, updated_at=strftime('%s','now') WHERE path=?")
        .run(dbNew, newKey, st.size, row.path);
      if (row.md5 && row.md5 !== newKey) vk.remapKey(db, row.md5, newKey, { path: dbNew, reason: 'conv-replace' });
      if (!fs.existsSync(VTHUMB_DIR + '/' + newKey.slice(0, 2) + '/' + newKey + '_01.jpg')) db.prepare("UPDATE photos SET shots=0 WHERE md5=? AND media_type='video' AND shots>0").run(newKey);
    })();
    return { freed: row.size };
  }

  app.get('/api/conv-replace/preview', async (req, res) => {
    try {
      const c = candidates();
      const all = getDb().prepare("SELECT path, size FROM photos WHERE media_type='video' AND web_ready=2").all();
      const bak = all.filter((r) => isBak(r.path));
      const big = all.filter((r) => !isBak(r.path) && (r.size || 0) > 6e9);
      res.json({ count: c.length, bytes: c.reduce((a, b) => a + b.size, 0), bakKept: bak.length, bakBytes: bak.reduce((a, b) => a + (b.size || 0), 0), bigKept: big.length, bigBytes: big.reduce((a, b) => a + (b.size || 0), 0) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  const tasks = {};
  let lastId = null;
  app.post('/api/conv-replace/start', (req, res) => {
    const list = candidates();
    if (!list.length) return res.status(400).json({ error: '没有可替换的视频(非BAK且已有转码副本)' });
    const tid = 'cr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    lastId = tid;
    const task = tasks[tid] = { status: 'running', total: list.length, done: 0, okCount: 0, failCount: 0, freedBytes: 0, currentPath: null, failedItems: [], stopRequested: false };
    res.json({ ok: true, taskId: tid, total: list.length });
    (async () => {
      for (const row of list) {
        if (task.stopRequested) { task.status = 'stopped'; task.currentPath = null; return; }
        task.currentPath = row.path;
        try { const r = await replaceOne(row); task.okCount++; task.freedBytes += r.freed || 0; }
        catch (e) { task.failCount++; if (task.failedItems.length < 200) task.failedItems.push({ path: row.path, error: e.message }); }
        task.done++;
        await yieldLoop();
      }
      task.status = 'done'; task.currentPath = null;
    })().catch((e) => { task.status = 'error'; task.error = e.message; });
  });
  app.get('/api/conv-replace/progress/:id', (req, res) => res.json(tasks[req.params.id] || { status: 'unknown' }));
  app.get('/api/conv-replace/current', (req, res) => {
    if (!lastId) return res.json({ status: 'none' });
    res.json(Object.assign({ taskId: lastId }, tasks[lastId] || { status: 'unknown' }));
  });
  app.post('/api/conv-replace/stop/:id', (req, res) => {
    const t = tasks[req.params.id];
    if (!t) return res.json({ ok: false });
    t.stopRequested = true; res.json({ ok: true });
  });

  console.log('[conv-replace] 初始化完成(BAK保留原文件, 其他用转码副本顶替)');
};
