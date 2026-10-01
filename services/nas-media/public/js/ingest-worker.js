/*
 * ingest-worker.js — 照片"入库+处理"队列的后台工人(独立线程, 由 ingest-queue.js 启动)。2026-09-30
 *
 * 一条龙: 扫描目录发现图片 → 登记入库(photos, status=pending) → 放进队列(ingest_queue) → 逐张处理:
 *   读/写 md5 标记(图片里已有 NAS_MD5 就沿用、不重算不重写; 没有才算一次并原子写入, 保持修改时间/权限) →
 *   缩略图(最长边200)+预览图(最长边1920) → phash → EXIF 拍摄时间/相机 → photos 置 done。
 * 只有这一个工人线程, 页面请求(主线程)永远有 CPU 余量: 每批最多 N 张(速度档: 慢1/稳2/快4), 大文件单独处理, 批与批之间让出时间。
 * 所有状态在数据库里: ingest_state(running/speed/heartbeat)、ingest_jobs(扫描任务)、ingest_queue(每张图一行)。
 * 暂停 = running=0, 工人在两张图之间检查; 重启后自动接着做(处理中的会被主线程放回排队)。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFile } = require('child_process');
const Database = require('better-sqlite3');
const sharp = require('sharp');
let piexif = null; try { piexif = require('piexifjs'); } catch (e) { console.error('[ingest] piexifjs 未安装, 无法写 JPG 的 md5 标记'); }

const R = '/share/ssd001/nas-thumbs/';
const db = new Database('/share/ssd001/nas.db');
db.pragma('journal_mode = WAL'); db.pragma('synchronous = NORMAL'); db.pragma('busy_timeout = 8000'); db.pragma('cache_size = -65536');

const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.bmp', '.tiff', '.tif']);
const HEAVY_BYTES = 30 * 1024 * 1024;         // 超过这个大小的图一次只处理一张(解码很吃 CPU/内存)
const SPEEDS = { slow: { conc: 1, delay: 200, sharp: 1 }, stable: { conc: 2, delay: 30, sharp: 1 }, fast: { conc: 4, delay: 0, sharp: 2 } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);

const _c = {};
function toRealPath(p) {
  if (p.indexOf('/share/CACHEDEV') === 0) return p;
  const m = p.match(/^\/share\/([^\/]+)(\/.*)?$/);
  if (!m) return p;
  if (!(m[1] in _c)) { _c[m[1]] = null; for (let i = 1; i <= 8; i++) { try { if (fs.existsSync('/share/CACHEDEV' + i + '_DATA/' + m[1])) { _c[m[1]] = 'CACHEDEV' + i + '_DATA'; break; } } catch (e) {} } }
  return _c[m[1]] ? '/share/' + _c[m[1]] + '/' + m[1] + (m[2] || '') : p;
}

const qState = db.prepare('SELECT value FROM ingest_state WHERE key=?');
const state = (k, d) => { const r = qState.get(k); return r ? r.value : d; };
const setState = (k, v) => db.prepare('INSERT INTO ingest_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

// ══════════ md5 标记读写(与 photo-worker-thread.js / photo_core.py 同格式) ══════════
function readExifMd5(buf) {
  if (!piexif) return null;
  try {
    const ex = piexif.load(buf.toString('binary'));
    const uc = ex['Exif'] && ex['Exif'][piexif.ExifIFD.UserComment];
    if (uc && uc.indexOf('NAS_MD5=') >= 0) { const v = uc.split('NAS_MD5=')[1].slice(0, 32); if (/^[0-9a-f]{32}$/i.test(v)) return v.toLowerCase(); }
  } catch (e) {}
  return null;
}
function toXPBytes(str) { const a = []; for (let i = 0; i < str.length; i++) a.push(str.charCodeAt(i) & 0xff, (str.charCodeAt(i) >> 8) & 0xff); a.push(0, 0); return a; }
function pngReadMd5(buf) {
  try {
    let off = 8;
    while (off + 12 <= buf.length) {
      const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
      if (type === 'tEXt') { const d = buf.slice(off + 8, off + 8 + len).toString('latin1'); const i = d.indexOf('\u0000'); if (i >= 0 && d.slice(0, i) === 'NAS_MD5') { const v = d.slice(i + 1, i + 33); if (/^[0-9a-f]{32}$/i.test(v)) return v.toLowerCase(); } }
      if (type === 'IEND') break;
      off += 12 + len;
    }
  } catch (e) {}
  return null;
}
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
// 先写临时文件 → 读回校验 → 原子替换; 保持原来的修改时间/权限/所有者(写一半断电不会写坏原图)
function atomicWriteKeepMeta(filePath, data, verify) {
  const st = fs.statSync(filePath); const tmp = filePath + '.nas_tmp';
  fs.writeFileSync(tmp, data);
  try {
    if (verify && !verify(fs.readFileSync(tmp))) throw new Error('写入后读回校验失败, 已放弃, 原图未改动');
    try { fs.chmodSync(tmp, st.mode & 0o7777); } catch (e) {} try { fs.chownSync(tmp, st.uid, st.gid); } catch (e) {}
    fs.renameSync(tmp, filePath);
  } catch (e) { try { fs.unlinkSync(tmp); } catch (x) {} throw e; }
  try { fs.utimesSync(filePath, st.atime, st.mtime); } catch (e) {}
}
function writeJpgMd5(filePath, buf, md5) {
  const bin = buf.toString('binary'); let ex;
  try { ex = piexif.load(bin); } catch (e) { ex = { '0th': {}, 'Exif': {}, 'GPS': {}, '1st': {} }; }
  if (!ex['Exif']) ex['Exif'] = {}; if (!ex['0th']) ex['0th'] = {};
  // 2026-10-01: 有些 JPEG 的内嵌缩略图信息是坏的(有 1st IFD 却没有缩略图数据), piexif.dump 会抛 "Given data isn't JPEG." → 丢掉这块再写
  if (!ex.thumbnail) { delete ex.thumbnail; ex['1st'] = {}; }
  const cm = 'NAS_MD5=' + md5;
  ex['Exif'][piexif.ExifIFD.UserComment] = 'ASCII\u0000\u0000\u0000' + cm;
  ex['0th'][piexif.ImageIFD.XPComment] = toXPBytes(cm);
  atomicWriteKeepMeta(filePath, Buffer.from(piexif.insert(piexif.dump(ex), bin), 'binary'), (b) => readExifMd5(b) === md5);
}
function writePngMd5(filePath, buf, md5) {
  const td = Buffer.from('NAS_MD5\u0000' + md5, 'latin1'); const len = Buffer.alloc(4); len.writeUInt32BE(td.length, 0);
  const tb = Buffer.from('tEXt', 'ascii'); const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(Buffer.concat([tb, td])) >>> 0 : crc32(Buffer.concat([tb, td])), 0);
  const chunk = Buffer.concat([len, tb, td, crc]);
  let off = 8, iend = -1;
  while (off + 12 <= buf.length) { const l = buf.readUInt32BE(off); if (buf.toString('ascii', off + 4, off + 8) === 'IEND') { iend = off; break; } off += 12 + l; }
  if (iend < 0) throw new Error('PNG无IEND');
  atomicWriteKeepMeta(filePath, Buffer.concat([buf.slice(0, iend), chunk, buf.slice(iend)]), (b) => pngReadMd5(b) === md5);
}

// ══════════ EXIF 时间/相机 + phash ══════════
function parseExif(exifBuf) {
  const out = { time: null, camera: null };
  try {
    let b = exifBuf; if (b.slice(0, 6).toString('latin1') === 'Exif\0\0') b = b.slice(6);
    const le = b.slice(0, 2).toString('latin1') === 'II';
    const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o)); const u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
    const str = (e) => { const n = u32(e + 4); const off = n > 4 ? u32(e + 8) : e + 8; return b.slice(off, off + n).toString('utf8').replace(/\0.*$/, '').trim(); };
    const ifd = (off, cb) => { const n = u16(off); for (let k = 0; k < n; k++) cb(off + 2 + k * 12); };
    let exifIfd = 0, make = '', model = '';
    ifd(u32(4), (e) => { const t = u16(e); if (t === 0x8769) exifIfd = u32(e + 8); else if (t === 0x010F) make = str(e); else if (t === 0x0110) model = str(e); });
    if (exifIfd) ifd(exifIfd, (e) => { if (u16(e) === 0x9003) { const m = str(e).match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/); if (m) out.time = Math.floor(new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() / 1000); } });
    if (make || model) out.camera = (make + ' ' + model).trim();
  } catch (e) {}
  return out;
}
const COS = (() => { const t = []; for (let u = 0; u < 8; u++) { t[u] = []; for (let x = 0; x < 32; x++) t[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / 64); } return t; })();
async function phash(buf) {
  const px = await sharp(buf, { failOn: 'none', limitInputPixels: false }).rotate().greyscale().resize(32, 32, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  const low = [];
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let s = 0; for (let y = 0; y < 32; y++) { const cy = COS[u][y]; for (let x = 0; x < 32; x++) s += px[y * 32 + x] * cy * COS[v][x]; } low.push(s); }
  const sorted = low.slice().sort((a, b) => a - b); const med = (sorted[31] + sorted[32]) / 2;
  let hex = ''; for (let i = 0; i < 64; i += 4) { let n = 0; for (let j = 0; j < 4; j++) n = (n << 1) | (low[i + j] > med ? 1 : 0); hex += n.toString(16); }
  return hex;
}

// ══════════ HEIC/HEIF: sharp 自带的 libheif 只认 AVIF, 解不了 iPhone 的 HEVC(HEIC) → 用 heif-convert(libheif-tools) 转成临时 JPEG 再处理 ══════════
// iPhone 的 HEIC 是 24~48 块小方块拼成的整图, heif-convert 会自动拼接并转正; 原 HEIC 文件不改动(不写 md5 标记)。
function looksHeic(buf, ext) {
  if (buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    const brands = buf.toString('latin1', 8, Math.min(buf.length, 64));
    if (/heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(brands) && !/avif|avis/.test(buf.toString('latin1', 8, 12))) return true;
  }
  return ext === '.heic' || ext === '.heif';
}
function heifToJpegBuffer(realPath) {
  const base = '/tmp/heic_' + process.pid + '_' + Math.random().toString(36).slice(2, 8);
  const out = base + '.jpg';
  return new Promise((resolve, reject) => {
    execFile('heif-convert', ['-q', '92', realPath, out], { timeout: 180000, maxBuffer: 8 * 1024 * 1024 }, (err) => {
      const cands = [out, base + '-1.jpg'];            // 多图 HEIF 会输出 xxx-1.jpg
      const hit = cands.find((p) => fs.existsSync(p));
      const cleanup = () => { try { fs.readdirSync('/tmp').filter((n) => n.indexOf(path.basename(base)) === 0).forEach((n) => { try { fs.unlinkSync('/tmp/' + n); } catch (e) {} }); } catch (e) {} };
      if (!hit) { cleanup(); return reject(new Error('HEIC 转换失败' + (err ? ': ' + String(err.message).slice(0, 80) : '(可能 libheif-tools 没装)'))); }
      try { const b = fs.readFileSync(hit); cleanup(); resolve(b); } catch (e) { cleanup(); reject(e); }
    });
  });
}

// ══════════ 处理一张图 ══════════
const updPhoto = db.prepare("UPDATE photos SET status='done', thumb_path=?, preview_path=?, md5=?, width=?, height=?, phash=COALESCE(?,phash), exif_time=COALESCE(?,exif_time), exif_camera=COALESCE(?,exif_camera), size=?, updated_at=strftime('%s','now') WHERE path=?");
async function processPhoto(p) {
  const real = toRealPath(p);
  if (!fs.existsSync(real)) throw new Error('原图不在磁盘上');
  const buf = fs.readFileSync(real);
  const isJpg = buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
  const isPng = buf.length > 8 && buf.readUInt32BE(0) === 0x89504E47;
  let md5 = null, note = '';
  if (isJpg) md5 = readExifMd5(buf); else if (isPng) md5 = pngReadMd5(buf);
  if (md5) note = 'md5标记:沿用';
  else {
    md5 = crypto.createHash('md5').update(buf).digest('hex');
    if (isJpg || isPng) {
      try { if (isJpg) { if (!piexif) throw new Error('piexifjs 未安装'); writeJpgMd5(real, buf, md5); } else writePngMd5(real, buf, md5); note = 'md5标记:已写入'; }
      catch (e) { note = 'md5标记:写入失败(' + String(e.message).slice(0, 60) + ')'; }
    } else note = 'md5标记:该格式不写';
  }
  const sub = md5.slice(0, 2);
  const tRel = 'thumbs/' + sub + '/' + md5 + '_thumb.jpg', pRel = 'preview/' + sub + '/' + md5 + '_preview.jpg';
  const tAbs = R + tRel, pAbs = R + pRel;
  let src = buf;                                   // 喂给 sharp 的内容: 普通图片就是原文件; HEIC 是转换出来的 JPEG
  if (!isJpg && !isPng && looksHeic(buf, path.extname(p).toLowerCase())) { src = await heifToJpegBuffer(real); note = 'HEIC→JPEG转换(原文件不动); ' + note; }
  const meta = await sharp(src, { failOn: 'none', limitInputPixels: false }).metadata();
  const swap = meta.orientation && meta.orientation >= 5;
  const width = swap ? meta.height : meta.width, height = swap ? meta.width : meta.height;
  if (!width || !height) throw new Error('读不出图片尺寸(可能不是有效图片)');
  if (!(fs.existsSync(tAbs) && fs.existsSync(pAbs))) {
    fs.mkdirSync(path.dirname(tAbs), { recursive: true }); fs.mkdirSync(path.dirname(pAbs), { recursive: true });
    const base = () => sharp(src, { failOn: 'none', limitInputPixels: false }).rotate();
    // 2026-10-01: 临时文件名带随机后缀 —— 内容相同(md5 相同)的文件会生成同一个缩略图路径, 并发处理时原来共用同一个 .tmp,
    // 后到的那个 rename 报 ENOENT 整张失败。现在各用各的临时文件; 目标已被另一份生成好了就直接用它。
    const uniq = () => '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp';
    const emit = async (dst, build) => {
      const tmp = dst + uniq();
      try { await build().toFile(tmp); try { fs.renameSync(tmp, dst); } catch (e) { if (!fs.existsSync(dst)) throw e; try { fs.unlinkSync(tmp); } catch (x) {} } }
      catch (e) { try { fs.unlinkSync(tmp); } catch (x) {} if (!fs.existsSync(dst)) throw e; }
    };
    await emit(tAbs, () => base().resize(200, 200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }));
    await emit(pAbs, () => base().resize(1920, 1920, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }));
  }
  let ph = null; try { ph = await phash(src); } catch (e) {}
  const ex = meta.exif ? parseExif(meta.exif) : { time: null, camera: null };
  let size = buf.length; try { size = fs.statSync(real).size; } catch (e) {}   // 写了标记后文件变大, 同步到库里
  const r = updPhoto.run(tRel, pRel, md5, width, height, ph, ex.time, ex.camera, size, p);
  if (!r.changes) throw new Error('库里没有这条照片记录');
  return note;
}

const qDone = db.prepare("UPDATE ingest_queue SET status='done', error=NULL, note=?, finished_at=?, ms=? WHERE id=?");
const qErr = db.prepare("UPDATE ingest_queue SET status='error', error=?, finished_at=?, ms=?, attempts=attempts+1 WHERE id=?");
async function processItem(row) {
  const t0 = Date.now();
  try {
    const note = await processPhoto(row.path);
    qDone.run(note, now(), Date.now() - t0, row.id);
  } catch (e) {
    const msg = String(e && e.message || e).slice(0, 300);
    qErr.run(msg, now(), Date.now() - t0, row.id);
    try { db.prepare("UPDATE photos SET status='error' WHERE path=?").run(row.path); } catch (x) {}
    try { db.prepare("INSERT INTO process_logs (path,status,error,created_at) VALUES (?,'error',?,strftime('%s','now'))").run(row.path, msg); } catch (x) {}
  }
}

// ══════════ 扫描任务: 发现图片 → 入库 → 排队(分批, 每批让出 CPU) ══════════
const selPhoto = db.prepare('SELECT id, status FROM photos WHERE path=?');
const insPhoto = db.prepare("INSERT INTO photos (path,dir,size,mtime,status,priority) VALUES (?,?,?,?,'pending',?)");
const resetPhoto = db.prepare("UPDATE photos SET status='pending' WHERE id=?");
const upQueue = db.prepare("INSERT INTO ingest_queue (path,dir,size,status,created_at) VALUES (?,?,?,'queued',?) ON CONFLICT(path) DO UPDATE SET status='queued', error=NULL, note=NULL, started_at=NULL, finished_at=NULL, ms=NULL, size=excluded.size WHERE ingest_queue.status IN ('done','error','skipped')");
const jobUpd = db.prepare('UPDATE ingest_jobs SET status=?, found=?, added=?, skipped_done=?, skipped_err=?, error=?, finished_at=? WHERE id=?');

async function scanJob(job) {
  const stat = { found: 0, added: 0, skipDone: 0, skipErr: 0 };
  const root = job.path.replace(/\\/g, '/').replace(/\/+$/, '');
  const save = (status, err, fin) => jobUpd.run(status, stat.found, stat.added, stat.skipDone, stat.skipErr, err || null, fin ? now() : null, job.id);
  save('scanning');
  const rootReal = toRealPath(root);
  let rst; try { rst = fs.statSync(rootReal); } catch (e) { save('error', '目录不存在: ' + root, true); return; }
  const stack = rst.isDirectory() ? [root] : [null];
  const single = rst.isDirectory() ? null : root;
  let nextP = db.prepare('SELECT COALESCE(MAX(priority),0)+1 AS p FROM photos').get().p;

  const handleFiles = db.transaction((files) => {
    for (const f of files) {
      const ph = selPhoto.get(f.path);
      stat.found++;
      if (!ph) { insPhoto.run(f.path, f.dir, f.size, f.mtime, nextP++); upQueue.run(f.path, f.dir, f.size, now()); stat.added++; }
      else if (ph.status === 'done') stat.skipDone++;
      else if (ph.status === 'error' && !job.retry_errors) stat.skipErr++;
      else { if (ph.status === 'error') resetPhoto.run(ph.id); upQueue.run(f.path, f.dir, f.size, now()); stat.added++; }
    }
  });

  while (stack.length || single) {
    if (state('running', '1') !== '1') { save('queued'); return; }         // 暂停: 任务退回排队, 恢复后重新扫(已处理的会被跳过, 很快)
    let files = [];
    if (single) { const st = fs.statSync(rootReal); files.push({ path: single, dir: single.slice(0, single.lastIndexOf('/')), size: st.size, mtime: Math.floor(st.mtimeMs / 1000) }); stack.length = 0; }
    else {
      const dir = stack.pop();
      let ents; try { ents = await fs.promises.readdir(toRealPath(dir), { withFileTypes: true }); } catch (e) { continue; }
      for (const e of ents) {
        const nm = e.name;
        if (nm[0] === '.' || nm[0] === '@' || nm === '转换' || nm === '删除' || nm === '#recycle') continue;
        const full = dir + '/' + nm;
        if (e.isDirectory()) { if (job.recursive !== 0) stack.push(full); }          // recursive=0: 只入库这个目录本身
        else if (e.isFile() && IMG_EXTS.has(path.extname(nm).toLowerCase())) {
          let st; try { st = await fs.promises.stat(toRealPath(full)); } catch (x) { continue; }
          files.push({ path: full, dir, size: st.size, mtime: Math.floor(st.mtimeMs / 1000) });
        }
      }
    }
    if (files.length) { for (let i = 0; i < files.length; i += 300) handleFiles(files.slice(i, i + 300)); }
    save('scanning');
    setState('heartbeat', now());
    await sleep(5);                                                         // 让出时间, 不霸占事件循环
    if (single) break;
  }
  save('done', null, true);
}

// ══════════ 主循环 ══════════
async function main() {
  let lastSharp = -1;
  for (;;) {
    try {
      setState('heartbeat', now());
      if (state('running', '1') !== '1') { await sleep(1000); continue; }
      const job = db.prepare("SELECT * FROM ingest_jobs WHERE status IN ('queued','scanning') ORDER BY id LIMIT 1").get();
      if (job) { await scanJob(job); continue; }
      const cfg = SPEEDS[state('speed', 'stable')] || SPEEDS.stable;
      if (cfg.sharp !== lastSharp) { try { sharp.concurrency(cfg.sharp); sharp.cache(false); } catch (e) {} lastSharp = cfg.sharp; }
      let rows = db.prepare("SELECT id, path, size FROM ingest_queue WHERE status='queued' ORDER BY id LIMIT ?").all(cfg.conc);
      if (!rows.length) { await sleep(1500); continue; }
      const heavy = rows.find((r) => (r.size || 0) > HEAVY_BYTES);
      if (heavy) rows = [rows[0]];                                          // 遇到大文件: 只处理队首这一张
      const t = now();
      for (const r of rows) db.prepare("UPDATE ingest_queue SET status='running', started_at=? WHERE id=?").run(t, r.id);
      await Promise.all(rows.map(processItem));
      if (cfg.delay) await sleep(cfg.delay);
    } catch (e) {
      console.error('[ingest-worker] 循环出错:', e && e.message);
      await sleep(2000);
    }
  }
}
main();
