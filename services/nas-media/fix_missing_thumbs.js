// fix_missing_thumbs.js — 补生成"库里有 thumb_path 但 SSD 上文件不存在"的照片缩略图/预览图 (2026-09-30)
//
// 背景: 缩略图迁到 SSD(/share/ssd001/nas-thumbs)时, 有约 3000 张照片的旧格式路径 thumbs/<md5>_thumb.jpg(无分目录)对应的文件没带过来,
//       viewer 里这些目录的瀑布流是空白格。这里直接用 NAS 上的 sharp 从原图补生成, 不需要电脑上的处理程序。
// 规格(与现有文件一致): 缩略图最长边 200px, 预览图最长边 1920px(不放大), 自动按 EXIF 转正, 输出 JPEG;
//       路径统一用分目录格式 thumbs/<md5前2位>/<md5>_thumb.jpg 、 preview/<md5前2位>/<md5>_preview.jpg
// 用法: docker exec nas-media node /app/fix_missing_thumbs.js [--dry]     (--dry 只统计不生成)
// 幂等: 已存在的文件不重生成; 同 md5 的多条记录共用同一份文件, 一起更新路径。

'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const D = require('better-sqlite3');

const DRY = process.argv.includes('--dry');
const R = '/share/ssd001/nas-thumbs/';
const db = new D('/share/ssd001/nas.db');
db.pragma('busy_timeout = 8000');

const _c = {};
function toRealPath(p) {
  if (p.indexOf('/share/CACHEDEV') === 0) return p;
  const m = p.match(/^\/share\/([^\/]+)(\/.*)?$/);
  if (!m) return p;
  if (!(m[1] in _c)) { _c[m[1]] = null; for (let i = 1; i <= 8; i++) { try { if (fs.existsSync('/share/CACHEDEV' + i + '_DATA/' + m[1])) { _c[m[1]] = 'CACHEDEV' + i + '_DATA'; break; } } catch (e) {} } }
  return _c[m[1]] ? '/share/' + _c[m[1]] + '/' + m[1] + (m[2] || '') : p;
}

const rows = db.prepare("SELECT id, path, md5, thumb_path, preview_path FROM photos WHERE media_type='photo' AND thumb_path IS NOT NULL AND status='done'").all()
  .filter((r) => r.md5 && (!fs.existsSync(R + r.thumb_path) || (r.preview_path && !fs.existsSync(R + r.preview_path))));
console.log('缺文件的记录:', rows.length);

const byMd5 = new Map();
for (const r of rows) { if (!byMd5.has(r.md5)) byMd5.set(r.md5, []); byMd5.get(r.md5).push(r); }
console.log('涉及不同内容(md5):', byMd5.size);
if (DRY) process.exit(0);

const upd = db.prepare("UPDATE photos SET thumb_path=?, preview_path=? WHERE md5=? AND media_type='photo'");
let ok = 0, fixedPathOnly = 0, failed = 0, noSrc = 0, i = 0;
const fails = [];
const entries = [...byMd5.entries()];

async function one([md5, list]) {
  const sub = md5.slice(0, 2);
  const tRel = 'thumbs/' + sub + '/' + md5 + '_thumb.jpg', pRel = 'preview/' + sub + '/' + md5 + '_preview.jpg';
  const tAbs = R + tRel, pAbs = R + pRel;
  if (fs.existsSync(tAbs) && fs.existsSync(pAbs)) { upd.run(tRel, pRel, md5); fixedPathOnly++; return; }
  const src = list.map((r) => toRealPath(r.path)).find((p) => fs.existsSync(p));
  if (!src) { noSrc++; fails.push({ md5, why: '原图不在磁盘上', path: list[0].path }); return; }
  try {
    fs.mkdirSync(path.dirname(tAbs), { recursive: true });
    fs.mkdirSync(path.dirname(pAbs), { recursive: true });
    const base = () => sharp(src, { failOn: 'none', limitInputPixels: false }).rotate();
    if (!fs.existsSync(tAbs)) await base().resize(200, 200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(tAbs + '.tmp').then(() => fs.renameSync(tAbs + '.tmp', tAbs));
    if (!fs.existsSync(pAbs)) await base().resize(1920, 1920, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(pAbs + '.tmp').then(() => fs.renameSync(pAbs + '.tmp', pAbs));
    upd.run(tRel, pRel, md5);
    ok++;
  } catch (e) {
    failed++; fails.push({ md5, why: e.message.slice(0, 120), path: list[0].path });
    try { fs.unlinkSync(tAbs + '.tmp'); } catch (x) {} try { fs.unlinkSync(pAbs + '.tmp'); } catch (x) {}
  }
}

(async () => {
  const N = 3;
  async function worker() { while (i < entries.length) { const e = entries[i++]; await one(e); if ((ok + failed + noSrc + fixedPathOnly) % 100 === 0) console.log('进度', ok + failed + noSrc + fixedPathOnly, '/', entries.length, '成功', ok, '仅改路径', fixedPathOnly, '失败', failed, '无原图', noSrc); } }
  await Promise.all(Array.from({ length: N }, worker));
  console.log('完成: 新生成', ok, '仅修正路径', fixedPathOnly, '失败', failed, '原图不在', noSrc);
  fails.slice(0, 30).forEach((f) => console.log('  ✗', f.why, '|', f.path));
  fs.writeFileSync('/share/ssd001/fix_missing_thumbs_result.json', JSON.stringify({ ok, fixedPathOnly, failed, noSrc, fails }, null, 1));
})();
