/*
 * refresh-stale-md5-worker-thread.js — 刷新过期的照片md5记录。
 *
 * 根因: 照片入库扫描只管发现"新文件", 不会再去检查"已经入库、标记done的文件,
 * 内容是不是后来又被替换/修改过"(比如手动同步/覆盖了新版本)。文件变了但mtime/size
 * 也会跟着变, 数据库这两项却一直停在第一次入库的旧值, 导致md5也是旧的——凡是拿这个
 * md5去跟别的地方比对(备份差异、diff工具等), 都会误判成"内容不一样/缺失"。
 *
 * 这里的做法: 每个文件都重新算一次身份md5(JPG优先读EXIF里的NAS_MD5标记, 没有才整个
 * 文件流式算, 跟backup那边保持一致的判断逻辑), 直接拿这个新算出来的值跟数据库比对——
 * 不再用size/mtime当"跳过"的依据, 那两个值不可靠(复制/同步工具保不保留mtime、
 * 文件系统时间精度都可能带来误差), 只有真正比对内容本身才靠谱。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parentPort, workerData } = require('worker_threads');

let BetterSqlite3;
try { BetterSqlite3 = require('better-sqlite3'); } catch (e) {}
const db = new BetterSqlite3('/share/ssd001/nas.db');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

function post(msg) { parentPort.postMessage(msg); }

function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// 跟backup-worker-thread.js完全一样的EXIF识别逻辑, 保持两边判断一致
function extractExifMd5(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.jpg' && ext !== '.jpeg') return null;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(65536);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    const idx = buf.slice(0, bytesRead).indexOf('NAS_MD5=');
    if (idx < 0) return null;
    const candidate = buf.slice(idx + 8, idx + 8 + 32).toString('latin1');
    return /^[0-9a-f]{32}$/i.test(candidate) ? candidate.toLowerCase() : null;
  } catch (e) {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e2) {}
  }
}
async function identityMd5(filePath) {
  const exifMd5 = extractExifMd5(filePath);
  if (exifMd5) return exifMd5;
  return md5File(filePath);
}

async function run(dryRun) {
  const rows = db.prepare("SELECT id, path, size, mtime, md5 FROM photos WHERE status='done'").all();
  const total = rows.length;
  let done = 0, checked = 0, refreshed = 0, unchanged = 0, missing = 0, failed = 0;

  const update = db.prepare("UPDATE photos SET size=?, mtime=?, md5=?, updated_at=strftime('%s','now') WHERE id=?");
  const staleSample = [];

  for (const r of rows) {
    done++;
    try {
      const st = fs.statSync(r.path);
      const realMtime = Math.floor(st.mtimeMs / 1000);
      checked++;
      // 2026-09-26改: 不再用mtime判断"文件是不是被改过"——mtime这东西不可靠(复制/同步
      // 工具保不保留mtime看具体实现, 时区/文件系统精度也可能带来误差), 只认内容本身:
      // 每个文件都重新算一次身份md5, 跟数据库比对, 真的不一样才算过期、才更新。
      const newMd5 = await identityMd5(r.path);
      if (newMd5 === r.md5 && st.size === r.size) {
        unchanged++;
      } else {
        if (staleSample.length < 500) {
          staleSample.push({ id: r.id, path: r.path, oldSize: r.size, newSize: st.size, oldMd5: r.md5, newMd5 });
        }
        if (!dryRun) update.run(st.size, realMtime, newMd5, r.id);
        refreshed++;
      }
    } catch (e) {
      if (e.code === 'ENOENT') missing++;
      else failed++;
    }
    if (done % 200 === 0 || done === total) {
      post({ type: 'progress', task: { total, done, checked, refreshed, unchanged, missing, failed, currentPath: r.path } });
    }
  }
  return { total, done, checked, refreshed, unchanged, missing, failed, staleSample };
}

(async () => {
  try {
    const result = await run(!!workerData.dryRun);
    post({ type: 'done', result });
  } catch (e) {
    post({ type: 'error', message: e.message });
  }
})();
