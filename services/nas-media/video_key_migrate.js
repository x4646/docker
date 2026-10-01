// video_key_migrate.js — 一次性迁移: 视频的photos.md5 从(文件名哈希/换壳产生的内容md5)统一换成快速内容指纹。
// 用法(容器内): node /share/Container/docker/services/nas-media/video_key_migrate.js [--dry]
// 前置: PC抽帧程序(video_thumbs.ps1)必须先停(它按key写缩略图), 这里会检查, 没停就退出。
// 每个视频: 算新key -> 更新photos.md5 -> 标签/标记/特征跟着换 -> 缩略图文件改名 -> 记变更历史。
const fs = require('fs');
const http = require('http');
const path = require('path');
const BetterSqlite3 = require('/app/node_modules/better-sqlite3');
const { quickKey, remapKey, ensureHistoryTable } = require('/share/Container/docker/services/nas-media/public/js/video-key.js');

const DRY = process.argv.indexOf('--dry') >= 0;
const db = new BetterSqlite3('/share/ssd001/nas.db');
db.pragma('journal_mode = WAL'); db.pragma('busy_timeout = 15000');
const THUMBS = '/share/Container/docker/services/nas-media/vthumbs';

const _c = {};
function toRealPath(p) {
  if (p.indexOf('/share/CACHEDEV') === 0) return p;
  const m = p.match(/^\/share\/([^\/]+)(\/.*)?$/); if (!m) return p;
  if (!(m[1] in _c)) { _c[m[1]] = null; for (let i = 1; i <= 8; i++) if (fs.existsSync('/share/CACHEDEV' + i + '_DATA/' + m[1])) { _c[m[1]] = 'CACHEDEV' + i + '_DATA'; break; } }
  return _c[m[1]] ? '/share/' + _c[m[1]] + '/' + m[1] + (m[2] || '') : p;
}
function agentOnline() {
  return new Promise((res) => http.get('http://localhost:3050/api/video/agent-status', (r) => {
    let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d).online); } catch (e) { res(false); } });
  }).on('error', () => res(false)));
}

(async () => {
  if (!DRY && await agentOnline()) { console.log('PC抽帧程序还在线(最近60秒内领过任务), 先在电脑上Ctrl+C停掉它再跑。退出。'); process.exit(2); }
  ensureHistoryTable(db);
  const rows = db.prepare("SELECT id, path, md5, shots FROM photos WHERE media_type='video'").all();
  const upPhoto = db.prepare('UPDATE photos SET md5=?, updated_at=strftime(\'%s\',\'now\') WHERE id=?');
  const setShots0 = db.prepare('UPDATE photos SET shots=0 WHERE id=? AND shots>0');
  const remapped = new Map();
  let same = 0, changed = 0, missing = 0, err = 0, thumbsMoved = 0, needRegen = 0, done = 0;
  const t0 = Date.now();
  for (const r of rows) {
    done++;
    try {
      const real = toRealPath(r.path);
      if (!fs.existsSync(real)) { missing++; continue; }
      const nk = quickKey(real);
      if (nk === r.md5) { same++; continue; }
      if (!DRY) {
        db.transaction(() => {
          upPhoto.run(nk, r.id);
          if (!remapped.has(r.md5)) {
            const x = remapKey(db, r.md5, nk, { path: r.path, reason: 'migrate-to-quickkey' });
            thumbsMoved += x.thumbs; remapped.set(r.md5, nk);
          }
        })();
        if (!fs.existsSync(path.join(THUMBS, nk.slice(0, 2), nk + '_01.jpg')) && r.shots > 0) { setShots0.run(r.id); needRegen++; }
      }
      changed++;
    } catch (e) { err++; if (err <= 5) console.log('ERR', r.path, e.message); }
    if (done % 1000 === 0) console.log(`进度 ${done}/${rows.length} 已换 ${changed} 没变 ${same} 文件不在 ${missing} 出错 ${err} 缩略图搬 ${thumbsMoved} 需重抽 ${needRegen} 用时${((Date.now() - t0) / 60000).toFixed(1)}分`);
  }
  console.log(`${DRY ? '[试运行] ' : ''}完成: 共${rows.length} 已换key ${changed} 本来就对 ${same} 文件不在 ${missing} 出错 ${err} 缩略图文件搬了 ${thumbsMoved} 张 标记为待重抽 ${needRegen} 用时${((Date.now() - t0) / 60000).toFixed(1)}分`);
})();
