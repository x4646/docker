/*
 * ingest-discover.js — "待入库目录"扫描(独立线程, 一次性任务)。2026-10-01
 * 找出: 磁盘上有图片、但数据库里没有(或比数据库里多)的目录, 结果写入 ingest_discovery 表, 供 nasmgr ⑭ 列出并一键入库。
 * 只读磁盘目录名(readdir, 不 stat、不读文件内容), 每 50 个目录让出一次时间; 只比较"目录自己直接包含的图片数" vs "库里 path 在该目录下的记录数"。
 * 进度写在 ingest_state(disc_*): disc_running / disc_scanned / disc_found / disc_images / disc_started / disc_finished / disc_stop。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { workerData } = require('worker_threads');
const Database = require('better-sqlite3');

const db = new Database('/share/ssd001/nas.db');
db.pragma('journal_mode = WAL'); db.pragma('busy_timeout = 8000'); db.pragma('cache_size = -65536');
const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.gif', '.bmp', '.tiff', '.tif']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const setState = (k, v) => db.prepare('INSERT INTO ingest_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
const getState = (k) => { const r = db.prepare('SELECT value FROM ingest_state WHERE key=?').get(k); return r ? r.value : null; };

const _c = {};
function toRealPath(p) {
  if (p.indexOf('/share/CACHEDEV') === 0) return p;
  const m = p.match(/^\/share\/([^\/]+)(\/.*)?$/);
  if (!m) return p;
  if (!(m[1] in _c)) { _c[m[1]] = null; for (let i = 1; i <= 8; i++) { try { if (fs.existsSync('/share/CACHEDEV' + i + '_DATA/' + m[1])) { _c[m[1]] = 'CACHEDEV' + i + '_DATA'; break; } } catch (e) {} } }
  return _c[m[1]] ? '/share/' + _c[m[1]] + '/' + m[1] + (m[2] || '') : p;
}

(async () => {
  const roots = (workerData && workerData.roots || []).map((r) => String(r).replace(/\\/g, '/').replace(/\/+$/, '')).filter((r) => r.startsWith('/share/'));
  setState('disc_stop', 0); setState('disc_scanned', 0); setState('disc_found', 0); setState('disc_images', 0);
  setState('disc_started', now()); setState('disc_finished', ''); setState('disc_roots', roots.join('|')); setState('disc_error', ''); setState('disc_running', 1);
  try {
    db.exec('DELETE FROM ingest_discovery');
    // 1. 库里每个目录自己直接有多少条照片记录(media_type=photo, 含待处理/失败的)
    const own = new Map();
    const q = db.prepare("SELECT path FROM photos WHERE media_type='photo' AND path >= ? AND path < ?");
    for (const root of roots) for (const r of q.iterate(root + '/', root + '0')) { const d = r.path.slice(0, r.path.lastIndexOf('/')); own.set(d, (own.get(d) || 0) + 1); }
    // 2. 逐目录读磁盘
    const ins = db.prepare('INSERT OR REPLACE INTO ingest_discovery (dir, disk, indb, pending, scanned_at) VALUES (?,?,?,?,?)');
    const stack = roots.slice();
    let scanned = 0, found = 0, images = 0;
    while (stack.length) {
      if (getState('disc_stop') === '1') break;
      const dir = stack.pop();
      let ents; try { ents = await fs.promises.readdir(toRealPath(dir), { withFileTypes: true }); } catch (e) { continue; }
      let n = 0;
      for (const e of ents) {
        const nm = e.name;
        if (nm[0] === '.' || nm[0] === '@' || nm === '转换' || nm === '删除' || nm === '#recycle' || nm === 'nas-thumbs') continue;   // nas-thumbs = 缩略图库, 不是照片
        if (e.isDirectory()) stack.push(dir + '/' + nm);
        else if (e.isFile() && IMG_EXTS.has(path.extname(nm).toLowerCase())) n++;
      }
      scanned++; images += n;
      if (n > 0) { const have = own.get(dir) || 0; if (n > have) { ins.run(dir, n, have, n - have, now()); found++; } }
      if (scanned % 50 === 0) { setState('disc_scanned', scanned); setState('disc_found', found); setState('disc_images', images); await sleep(2); }
    }
    setState('disc_scanned', scanned); setState('disc_found', found); setState('disc_images', images);
  } catch (e) { setState('disc_error', String(e && e.message || e).slice(0, 200)); }
  setState('disc_running', 0); setState('disc_finished', now());
  process.exit(0);
})();
