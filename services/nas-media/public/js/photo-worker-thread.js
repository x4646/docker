/*
 * photo-worker-thread.js — 2026-09-20新增
 * 真正干重活的worker线程, 跟主线程(负责HTTP服务)完全隔离。
 *
 * 背景: 之前nasProcess/md5Process直接在主线程里跑, 批量目录一多(实测/share/Person
 * 2530个含图目录), 扫描+缩略图生成要连续跑很久, 期间Node单线程事件循环被占满,
 * 网站(viewer/videoer/media-admin)所有请求全部卡住直到超时。这个文件把同一套处理
 * 逻辑原样搬进独立的worker_threads线程——CPU/IO密集的活儿在这个线程里干多久,
 * 都不会影响主线程接待HTTP请求。
 *
 * 主线程通过 workerData 传入任务参数({jobType:'process'|'md5', target}),
 * 通过 postMessage 汇报进度('progress')/完成('done')/出错('error')。
 * 一个worker只跑一个任务, 跑完自然退出(不需要维护跨任务的tasks{}表, 那是主线程的事)。
 */
const { parentPort, workerData } = require('worker_threads');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const zlib   = require('zlib');
const BetterSqlite3 = require('better-sqlite3');
let sharp = null;
try { sharp = require('sharp'); } catch (e) { console.error('[photo-worker-thread] sharp 未安装:', e.message); }
// 2026-09-30: 批量处理时 sharp 默认用满所有 CPU 核(实测 nas-media 占 380% CPU、负载 8~10), 主线程(接 HTTP 请求)被挤得响应变慢/超时,
// 管理页就"连不上服务器"。限制并发为2个线程、关掉解码缓存(超大图会占很多内存), 给主线程留出 CPU。
if (sharp) { try { sharp.concurrency(2); sharp.cache(false); } catch (e) {} }
let piexif = null;
try { piexif = require('piexifjs'); } catch (e) { console.error('[photo-worker-thread] piexifjs 未安装:', e.message); }

const IMG_EXTS = new Set(['.jpg','.jpeg','.png','.heic','.heif','.webp','.gif','.bmp','.tiff','.tif']);
const DATA = '/data';

// 每个worker线程独立开一个DB连接——主线程的Database.ts已经把journal_mode设成了WAL,
// WAL模式下多个连接(不管同进程多线程还是跨进程)并发读写本来就是安全设计, 不需要
// 额外加锁协调, 只要都设好busy_timeout, 遇到短暂冲突会自动重试而不是立刻报错。
const db = new BetterSqlite3('/share/ssd001/nas.db');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
function getDb() { return db; }

function sys(key, def) {
  try { return (JSON.parse(fs.readFileSync('/data/config.json','utf8'))[key]) || def; }
  catch (e) { return def; }
}

// ── 遍历含图末层目录(异步版, 每访问完一个目录让一次事件循环——虽然在独立worker线程里
//    阻塞不阻塞主线程都无所谓了, 但保留这个写法也没坏处, 顺便如果以后worker要接收
//    取消信号, 这些让出点也是天然的检查时机) ──
async function leafImageDirs(root) {
  const out = [];
  async function walk(dir) {
    let ents; try { ents = await fs.promises.readdir(dir, { withFileTypes:true }); } catch { return; }
    let hasImg = false;
    for (const e of ents) {
      if (e.isDirectory()) { if (!e.name.startsWith('.') && !e.name.startsWith('@')) await walk(path.join(dir, e.name)); }
      else if (IMG_EXTS.has(path.extname(e.name).toLowerCase())) hasImg = true;
    }
    if (hasImg) out.push(dir);
    await new Promise((r) => setImmediate(r));
  }
  await walk(root.replace(/\/+$/,''));
  return out;
}

// ── 扫描一个目录入库(写pending) ──
async function scanDirToDb(dir) {
  let ents; try { ents = await fs.promises.readdir(dir, { withFileTypes:true }); } catch { return 0; }
  const nextP = db.prepare("SELECT COALESCE(MAX(priority),0)+1 AS p FROM photos").get().p;
  const exists = db.prepare("SELECT 1 FROM photos WHERE REPLACE(path,'\\\\','/')=? LIMIT 1");
  const ins = db.prepare("INSERT INTO photos (path,dir,size,mtime,status,priority) VALUES (@path,@dir,@size,@mtime,'pending',@priority)");
  let n = 0;
  const tx = db.transaction((files) => { for (const f of files) ins.run(f); });
  const batch = [];
  for (const e of ents) {
    if (!e.isFile()) continue;
    if (!IMG_EXTS.has(path.extname(e.name).toLowerCase())) continue;
    const fp = path.join(dir, e.name).replace(/\\/g,'/');
    if (exists.get(fp)) continue;
    let st; try { st = await fs.promises.stat(fp); } catch { continue; }
    batch.push({ path: fp, dir: dir.replace(/\\/g,'/'), size: st.size, mtime: Math.floor(st.mtimeMs/1000), priority: nextP + n });
    n++;
  }
  if (batch.length) tx(batch);
  return batch.length;
}

// ── 用sharp生成缩略图, 处理该目录所有pending ──
async function processDirThumbs(dir, prog) {
  const thumbDir   = sys('thumb_dir',   '/share/Container/docker/data/photos/thumbs').replace('/share/Container/docker/data', DATA);
  const previewDir = sys('preview_dir', '/share/Container/docker/data/photos/preview').replace('/share/Container/docker/data', DATA);
  fs.mkdirSync(thumbDir,   { recursive:true });
  fs.mkdirSync(previewDir, { recursive:true });

  const rows = db.prepare("SELECT id,path FROM photos WHERE status='pending' AND REPLACE(path,'\\','/') LIKE ?").all(dir.replace(/\\/g,'/') + '/%');
  let done = 0, fail = 0;
  if (prog) { prog.dir = dir.replace(/\\/g,'/'); prog.total = rows.length; prog.done = 0; prog.current = ''; }
  for (const row of rows) {
    const p = row.path.replace(/\\/g,'/');
    if (prog) prog.current = p.split('/').pop();
    try {
      const buf = fs.readFileSync(p);
      const ext = path.extname(p).toLowerCase();
      let md5 = null;
      // 2026-09-30: 按文件头字节判断真实格式(不信扩展名: .png 其实是 JPEG 之类), 只有真 JPEG/PNG 才读写 md5 标记, 其它格式只算 md5 不写
      const isJpg = buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
      const isPng = buf.length > 8 && buf.readUInt32BE(0) === 0x89504E47;
      if (isJpg) {
        md5 = readExifMd5(buf);
        if (!md5) {
          md5 = crypto.createHash('md5').update(buf).digest('hex');
          try { writeExifMd5(p, buf, md5); } catch (werr) { console.error('[photo-worker-thread] 写EXIF md5失败:', p, werr.message); }
        }
      } else if (isPng) {
        md5 = pngReadMd5(buf);
        if (!md5) {
          md5 = crypto.createHash('md5').update(buf).digest('hex');
          try { pngWriteMd5(p, buf, md5); } catch (werr) { console.error('[photo-worker-thread] 写PNG md5失败:', p, werr.message); }
        }
      } else {
        md5 = crypto.createHash('md5').update(buf).digest('hex');
        try { db.prepare("UPDATE photos SET exif_written=2 WHERE id=?").run(row.id); } catch {}
      }
      const img = sharp(buf, { failOn: 'none', limitInputPixels: false }).rotate();
      const meta = await img.metadata();
      const shard = md5.slice(0, 2);
      const thumbShardDir = path.join(thumbDir, shard);
      const previewShardDir = path.join(previewDir, shard);
      fs.mkdirSync(thumbShardDir, { recursive: true });
      fs.mkdirSync(previewShardDir, { recursive: true });
      await img.clone().resize(200, 200, { fit:'inside', withoutEnlargement:true }).jpeg({ quality:85 }).toFile(path.join(thumbShardDir, `${md5}_thumb.jpg`));
      await img.clone().resize(1920, 1920, { fit:'inside', withoutEnlargement:true }).jpeg({ quality:90 }).toFile(path.join(previewShardDir, `${md5}_preview.jpg`));
      db.prepare("UPDATE photos SET status='done', thumb_path=?, preview_path=?, md5=?, width=?, height=? WHERE id=?")
        .run(`thumbs/${shard}/${md5}_thumb.jpg`, `preview/${shard}/${md5}_preview.jpg`, md5, meta.width||0, meta.height||0, row.id);
      done++;
      if (prog) { prog.done = done; prog.task.doneFiles++; }
    } catch (e) {
      fail++;
      if (prog) prog.task.failFiles++;
      try { db.prepare("UPDATE photos SET status='error' WHERE id=?").run(row.id); } catch {}
      try { db.prepare("INSERT INTO process_logs (path,status,error,created_at) VALUES (?,'error',?,strftime('%s','now'))").run(p, String(e.message).slice(0,500)); } catch {}
    }
  }
  return { done, fail, total: rows.length };
}

// ════════ 打MD5 ════════
const EXIF_EXTS = new Set(['.jpg','.jpeg','.tiff','.tif']);
const PNG_EXTS  = new Set(['.png']);

function readExifMd5(buf) {
  try {
    const bin = buf.toString('binary');
    const ex = piexif.load(bin);
    const uc = ex['Exif'] && ex['Exif'][piexif.ExifIFD.UserComment];
    if (uc && uc.indexOf('NAS_MD5=') >= 0) return uc.split('NAS_MD5=')[1].slice(0,32);
  } catch (e) {}
  return null;
}
function toXPBytes(str) {
  const arr = [];
  for (let i = 0; i < str.length; i++) {
    arr.push(str.charCodeAt(i) & 0xff, (str.charCodeAt(i) >> 8) & 0xff);
  }
  arr.push(0, 0);
  return arr;
}
function writeExifMd5(filePath, buf, md5) {
  const bin = buf.toString('binary');
  let ex;
  try { ex = piexif.load(bin); } catch (e) { ex = { '0th':{}, 'Exif':{}, 'GPS':{}, '1st':{} }; }
  if (!ex['Exif']) ex['Exif'] = {};
  if (!ex['0th']) ex['0th'] = {};
  if (!ex.thumbnail) { delete ex.thumbnail; ex['1st'] = {}; }   // 2026-10-01: 内嵌缩略图损坏时 dump 会抛 "Given data isn't JPEG."
  const comment = 'NAS_MD5=' + md5;
  ex['Exif'][piexif.ExifIFD.UserComment] = 'ASCII\u0000\u0000\u0000' + comment;
  ex['0th'][piexif.ImageIFD.XPComment] = toXPBytes(comment);
  const exifStr = piexif.dump(ex);
  const newBin = piexif.insert(exifStr, bin);
  atomicWriteKeepMeta(filePath, Buffer.from(newBin, 'binary'), (b) => readExifMd5(b) === md5);
}
// 2026-09-30: 写原图改成"先写临时文件 → 读回校验 md5 标记 → 原子替换", 并保持原来的修改时间/权限/所有者。
// 原来是直接覆盖写原文件: 写一半断电/重启会把照片写坏, 而且写完 mtime 变成"现在"、所有者变 root。
function atomicWriteKeepMeta(filePath, data, verify) {
  const st = fs.statSync(filePath);
  const tmp = filePath + '.nas_tmp';
  fs.writeFileSync(tmp, data);
  try {
    if (verify && !verify(fs.readFileSync(tmp))) throw new Error('写入后读回校验失败, 已放弃, 原图未改动');
    try { fs.chmodSync(tmp, st.mode & 0o7777); } catch {}
    try { fs.chownSync(tmp, st.uid, st.gid); } catch {}
    fs.renameSync(tmp, filePath);
  } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
  try { fs.utimesSync(filePath, st.atime, st.mtime); } catch {}
}
function pngReadMd5(buf) {
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off+4, off+8);
    if (type === 'tEXt') {
      const data = buf.slice(off+8, off+8+len).toString('latin1');
      const i = data.indexOf('\u0000');
      if (i >= 0 && data.slice(0,i) === 'NAS_MD5') return data.slice(i+1, i+33);
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  return null;
}
function pngWriteMd5(filePath, buf, md5) {
  const keyword = 'NAS_MD5';
  const textData = Buffer.from(keyword + '\u0000' + md5, 'latin1');
  const len = Buffer.alloc(4); len.writeUInt32BE(textData.length, 0);
  const typeBuf = Buffer.from('tEXt', 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(zlib.crc32 ? zlib.crc32(Buffer.concat([typeBuf, textData])) >>> 0 : crc32(Buffer.concat([typeBuf, textData])), 0);
  const chunk = Buffer.concat([len, typeBuf, textData, crcBuf]);
  let off = 8, iendOff = -1;
  while (off < buf.length) {
    const l = buf.readUInt32BE(off);
    const t = buf.toString('ascii', off+4, off+8);
    if (t === 'IEND') { iendOff = off; break; }
    off += 12 + l;
  }
  if (iendOff < 0) throw new Error('PNG无IEND');
  const out = Buffer.concat([buf.slice(0, iendOff), chunk, buf.slice(iendOff)]);
  atomicWriteKeepMeta(filePath, out, (b) => pngReadMd5(b) === md5);
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function md5DirFiles(dir, prog) {
  let ents; try { ents = await fs.promises.readdir(dir, { withFileTypes:true }); } catch { return { done:0, skip:0, mark:0, fail:0 }; }
  const imgs = ents.filter(e => e.isFile() && IMG_EXTS.has(path.extname(e.name).toLowerCase()));
  let done = 0, skip = 0, mark = 0, fail = 0;
  if (prog) { prog.dir = dir; prog.total = imgs.length; prog.done = 0; prog.current = ''; }
  for (const e of imgs) {
    const fp = path.join(dir, e.name).replace(/\\/g,'/');
    const ext = path.extname(e.name).toLowerCase();
    if (prog) prog.current = e.name;
    try {
      const buf = fs.readFileSync(fp);
      if (EXIF_EXTS.has(ext)) {
        if (readExifMd5(buf)) { skip++; }
        else {
          const md5 = crypto.createHash('md5').update(buf).digest('hex');
          writeExifMd5(fp, buf, md5);
          try { db.prepare("UPDATE photos SET md5=?, exif_written=1 WHERE REPLACE(path,'\\','/')=?").run(md5, fp); } catch {}
          done++;
        }
      } else if (PNG_EXTS.has(ext)) {
        if (pngReadMd5(buf)) { skip++; }
        else {
          const md5 = crypto.createHash('md5').update(buf).digest('hex');
          pngWriteMd5(fp, buf, md5);
          try { db.prepare("UPDATE photos SET md5=?, exif_written=1 WHERE REPLACE(path,'\\','/')=?").run(md5, fp); } catch {}
          done++;
        }
      } else {
        try { db.prepare("UPDATE photos SET exif_written=2 WHERE REPLACE(path,'\\','/')=?").run(fp); } catch {}
        mark++;
      }
      if (prog) { prog.done++; prog.task.doneFiles++; }
    } catch (err) {
      fail++;
      if (prog) prog.task.failFiles++;
      try { db.prepare("INSERT INTO process_logs (path,status,error,created_at) VALUES (?,'md5_error',?,strftime('%s','now'))").run(fp, String(err.message).slice(0,500)); } catch {}
    }
  }
  return { done, skip, mark, fail };
}

async function md5Process(target, task) {
  const dirs = await leafImageDirs(target.replace(/\\/g,'/'));
  console.log('[photo-worker-thread] 打MD5', target, '含图目录', dirs.length, '个');
  task.queued = dirs.slice();
  let tot = 0;
  for (const d of dirs) {
    try { tot += (await fs.promises.readdir(d)).filter(f => IMG_EXTS.has(path.extname(f).toLowerCase())).length; } catch {}
  }
  task.totalFiles = tot;
  let totDone = 0, totSkip = 0, totMark = 0, totFail = 0;
  for (const d of dirs) {
    task.queued = task.queued.filter(x => x !== d);
    const prog = { task, dir:d, done:0, total:0, current:'' };
    task.running = [prog];
    const r = await md5DirFiles(d, prog);
    totDone += r.done; totSkip += r.skip; totMark += r.mark; totFail += r.fail;
  }
  task.running = [];
  return { ok:true, dirs: dirs.length, done: totDone, skip: totSkip, marked: totMark, fail: totFail };
}

async function nasProcess(target, task) {
  const dirs = await leafImageDirs(target.replace(/\\/g,'/'));
  console.log('[photo-worker-thread] NAS处理', target, '含图目录', dirs.length, '个');
  task.queued = dirs.slice();
  let totIn = 0;
  for (const d of dirs) totIn += await scanDirToDb(d);
  try {
    let tot = 0;
    for (const d of dirs) {
      const c = db.prepare("SELECT COUNT(*) c FROM photos WHERE status='pending' AND REPLACE(path,'\\','/') LIKE ?").get(d.replace(/\\/g,'/')+'/%').c;
      tot += c;
    }
    task.totalFiles = tot;
  } catch {}
  let totDone = 0, totFail = 0;
  for (const d of dirs) {
    task.queued = task.queued.filter(x => x !== d);
    const prog = { task, dir:d, done:0, total:0, current:'' };
    task.running = [prog];
    const r = await processDirThumbs(d, prog);
    totDone += r.done; totFail += r.fail;
  }
  task.running = [];
  return { ok:true, by:'nas', dirs: dirs.length, inserted: totIn, done: totDone, fail: totFail };
}

// ── 入口: 根据主线程传入的workerData跑对应任务, 定期汇报进度 ──
function serializeTask(t) {
  return {
    status: t.status,
    queued: t.queued || [],
    running: (t.running || []).map(r => ({ dir: r.dir, done: r.done, total: r.total, current: r.current })),
    totalFiles: t.totalFiles || 0,
    doneFiles: t.doneFiles || 0,
    failFiles: t.failFiles || 0,
  };
}

(async () => {
  const task = { status:'running', queued:[], running:[], totalFiles:0, doneFiles:0, failFiles:0 };
  const reportTimer = setInterval(() => {
    parentPort.postMessage({ type:'progress', task: serializeTask(task) });
  }, 1000);
  try {
    let result;
    if (workerData.jobType === 'md5') {
      if (!piexif) throw new Error('piexifjs未安装');
      result = await md5Process(workerData.target, task);
    } else {
      if (!sharp) throw new Error('sharp未安装');
      result = await nasProcess(workerData.target, task);
    }
    clearInterval(reportTimer);
    parentPort.postMessage({ type:'done', task: serializeTask(task), result });
  } catch (e) {
    clearInterval(reportTimer);
    parentPort.postMessage({ type:'error', task: serializeTask(task), message: e.message });
  }
})();
