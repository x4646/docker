/*
 * backup-worker-thread.js — 备份系统真正干活的地方, 独立worker线程跑(不卡主服务)。
 * 三种任务类型(workerData.jobType):
 *   'index' — 给备份盘现有文件建md5索引(不管路径/文件名多乱, 只认内容), 按target_path分开存,
 *             这样不同的备份计划就算用不同的盘, 索引也不会串。
 *   'scan'  — 拿NAS库里的md5跟"这块目标盘"的索引比对, 找出缺失的, 按profile_id存进待复制清单
 *             (同一份源文件如果被多套计划各自比对一次, 各自会在自己名下留一条missing记录)。
 *   'copy'  — 把"这套计划"的待复制清单里的文件复制到它自己的目标盘, 按NAS原路径镜像存放。
 * 进度通过parentPort.postMessage定期上报, 主线程(backup.js)负责转成HTTP轮询接口。
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

// 流式算md5, 不整个读进内存——视频文件动辄几个GB, readFileSync会爆内存
function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// 2026-09-25加: pc-scripts/write_md5_to_exif.py会把photos.md5(照片入库时的原始身份)
// 写进JPEG的EXIF UserComment里(格式"NAS_MD5=<32位hex>"), 这一写会改变文件自身的字节
// (EXIF数据变了), 导致"重新算一遍文件的md5"得到的是写标记之后的新哈希, 跟数据库里
// 记的原始身份对不上——之前一直拿这个"重新算的md5"去跟NAS库比对, 结果永远比不上,
// 平白把已经备份好的文件当成缺失。EXIF里既然存了原始身份, 就该优先读它当身份用,
// 没有这个标记的文件(非jpg, 或者还没被那个脚本处理过的)才退回老办法整个文件流式算。
// UserComment在文件开头附近(EXIF段通常在前64KB内), 不用读整个文件, 顺带比全文件哈希快很多。
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

// 统一的"算这个文件的身份md5"入口: 有EXIF标记优先用标记(快、且是真正的原始身份),
// 没有就退回整个文件流式哈希。
async function identityMd5(filePath) {
  const exifMd5 = extractExifMd5(filePath);
  if (exifMd5) return exifMd5;
  return md5File(filePath);
}

function walkFiles(dir, onFile) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name.startsWith('@')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, onFile);
    else onFile(full);
  }
}

// ── index: 给备份盘建md5索引(按target_path分开存) ──────────────
async function runIndex(targetPath) {
  const files = [];
  walkFiles(targetPath, (f) => files.push(f));
  const total = files.length;
  let done = 0, indexed = 0, skipped = 0, failed = 0;

  const upsert = db.prepare(
    'INSERT INTO backup_index (path, size, md5, mtime, indexed_at, target_path) VALUES (?,?,?,?,strftime(\'%s\',\'now\'),?) ' +
    'ON CONFLICT(path) DO UPDATE SET size=excluded.size, md5=excluded.md5, mtime=excluded.mtime, indexed_at=excluded.indexed_at, target_path=excluded.target_path'
  );
  // 2026-09-25修复: 原来这里查"是否已经索引过"没有按target_path过滤, 只看path本身
  // (backup_index.path全局主键)——如果同一个绝对路径曾经在另一套(哪怕已经删掉的)计划的
  // target下被索引过, 这里会误判"已索引、跳过", 沿用的还是那套旧计划遗留的target_path,
  // 而不是这次真正要建索引的这个target。加上target_path条件, 只有"确实是在这个target下
  // 索引过"才允许跳过重算。
  const existing = db.prepare('SELECT size, mtime FROM backup_index WHERE path = ? AND target_path = ?');

  for (const f of files) {
    try {
      const st = fs.statSync(f);
      const mtime = Math.floor(st.mtimeMs / 1000);
      const old = existing.get(f, targetPath);
      // 已经索引过, 且大小+修改时间都没变——跳过重新算md5(断点续跑的关键优化)
      if (old && old.size === st.size && old.mtime === mtime) {
        skipped++;
      } else {
        const md5 = await identityMd5(f);
        upsert.run(f, st.size, md5, mtime, targetPath);
        indexed++;
      }
    } catch (e) { failed++; }
    done++;
    if (done % 20 === 0 || done === total) {
      post({ type: 'progress', task: { total, done, indexed, skipped, failed, currentPath: f } });
    }
  }
  return { total, done, indexed, skipped, failed };
}

// ── scan: 纯镜像比对——NAS这份文件在目标盘的镜像路径上"在不在", 不比md5、不比大小
//    (2026-09-26改: 之前拿md5当身份去匹配, 结果NAS自己的后台维护脚本——视频转封装、
//    EXIF回写md5——会悄悄改文件字节, 导致md5漂移、明明镜像着的文件被判定成"缺失"。
//    用户明确要的是"备份盘跟NAS长一样"的镜像, 不是内容去重式的"NAS哪都能找到一份"。
//    镜像判断只需要一件事: 目标盘上, NAS路径对应的那个镜像路径, 文件存不存在。) ──
async function runScan(sourcePaths, targetPath, profileId) {
  const rows = db.prepare(
    `SELECT id, path, size, md5 FROM photos WHERE status='done' AND (` +
    sourcePaths.map(() => 'path LIKE ?').join(' OR ') + `)`
  ).all(...sourcePaths.map(p => p.replace(/\/$/, '') + '/%'));

  const total = rows.length;
  let done = 0, missing = 0, matched = 0;

  db.prepare('DELETE FROM backup_missing WHERE profile_id = ?').run(profileId);
  const insertMissing = db.prepare('INSERT OR REPLACE INTO backup_missing (path, size, md5, profile_id) VALUES (?,?,?,?)');

  for (const r of rows) {
    // 跟runCopy镜像到目标盘时用的是同一条相对路径规则, 两边必须保持一致
    const rel = r.path.replace(/^\/share\//, '');
    const destPath = path.join(targetPath, rel);
    const hit = fs.existsSync(destPath);
    if (hit) matched++;
    else { insertMissing.run(r.path, r.size, r.md5 || null, profileId); missing++; }
    done++;
    if (done % 200 === 0 || done === total) {
      post({ type: 'progress', task: { total, done, matched, missing, currentPath: r.path } });
    }
  }
  const sizeRow = db.prepare('SELECT COALESCE(SUM(size),0) s FROM backup_missing WHERE profile_id = ?').get(profileId);
  return { total, done, matched, missing, missingSize: sizeRow.s };
}

// ── copy: 把这套计划的待复制清单复制到它自己的目标盘, 按原路径镜像 ─────
async function runCopy(targetPath, profileId) {
  const rows = db.prepare('SELECT path, size FROM backup_missing WHERE copied = 0 AND profile_id = ?').all(profileId);
  const total = rows.length;
  const totalSize = rows.reduce((s, r) => s + (r.size || 0), 0);
  let done = 0, doneSize = 0, failed = 0;

  const markCopied = db.prepare('UPDATE backup_missing SET copied = 1, error = NULL WHERE path = ? AND profile_id = ?');
  const markFailed = db.prepare('UPDATE backup_missing SET error = ? WHERE path = ? AND profile_id = ?');

  for (const r of rows) {
    try {
      // 2026-09-25改: 去掉"nas_mirror"这层中间目录, 直接同步成跟NAS上一样的相对目录结构,
      // 同名文件直接覆盖(copyFileSync默认行为就是覆盖, 不用额外处理):
      // /share/BAK/Gcloud/xxx.jpg -> <targetPath>/BAK/Gcloud/xxx.jpg
      const rel = r.path.replace(/^\/share\//, '');
      const destPath = path.join(targetPath, rel);
      // 2026-09-25修复重要bug: 原来拿r.size(比对差异那一步存进backup_missing表里的、
      // 当时查到的DB记录值)去校验复制是否完整——但源文件如果在"比对差异"之后、"复制"
      // 之前又被别的东西改过(实测发现是exif回写md5的脚本导致, 影响了几千个文件), DB里
      // 的size早就跟磁盘上的真实大小对不上了, 拿一个过期的值去比, 复制明明成功也会被
      // 误判成"大小不一致"而失败。改成复制前现读一次源文件真实大小, 拿这个新鲜值去比对
      // 复制后的结果, 才是真正检验"复制这个动作本身有没有出错", 不掺和DB数据是否过期。
      const srcSize = fs.statSync(r.path).size;
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(r.path, destPath);
      const st = fs.statSync(destPath);
      if (st.size !== srcSize) throw new Error('复制后大小不一致(源文件现在' + srcSize + '字节, 复制后' + st.size + '字节)');
      markCopied.run(r.path, profileId);
      doneSize += srcSize || 0;
    } catch (e) {
      failed++;
      try { markFailed.run(e.message, r.path, profileId); } catch (e2) {}
    }
    done++;
    if (done % 20 === 0 || done === total) {
      post({ type: 'progress', task: { total, done, totalSize, doneSize, failed, currentPath: r.path } });
    }
  }
  return { total, done, failed, totalSize, doneSize };
}

(async () => {
  try {
    let result;
    if (workerData.jobType === 'index') result = await runIndex(workerData.targetPath);
    else if (workerData.jobType === 'scan') result = await runScan(workerData.sourcePaths, workerData.targetPath, workerData.profileId);
    else if (workerData.jobType === 'copy') result = await runCopy(workerData.targetPath, workerData.profileId);
    else throw new Error('未知任务类型: ' + workerData.jobType);
    post({ type: 'done', result });
  } catch (e) {
    post({ type: 'error', message: e.message });
  }
})();
