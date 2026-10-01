/*
 * video-key.js — 视频的身份key(存在photos.md5字段里, 缩略图/标签/标记/特征都按它关联)。
 *
 * 2026-09-29定: 视频不再用文件名哈希当key(改名/搬目录就断链), 也不整份算内容md5(几GB读不动),
 * 改用"快速内容指纹": 文件大小 + 头/中/尾各1MB 的md5。只跟文件字节有关、跟文件名/所在目录无关,
 * 改名搬家key不变; 文件字节真的变了(换壳/转码/无损修复)key才变, 此时必须调 remapKey 把
 * 标签/标记/特征/缩略图跟着改过去, 并留一条变更记录(video_key_history), 以后对不上能查表救回来。
 * 前缀'vk1:'保证不会跟图片那种真实内容md5撞车, 也方便以后升级算法(vk2:)。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const N = 1 << 20;
const VTHUMB_DIR = '/share/Container/docker/services/nas-media/vthumbs';

function quickKey(realPath) {
  const st = fs.statSync(realPath);
  const size = st.size;
  const h = crypto.createHash('md5');
  h.update('vk1:' + size + ':');
  const fd = fs.openSync(realPath, 'r');
  try {
    const buf = Buffer.alloc(N);
    const read = (pos) => { const n = fs.readSync(fd, buf, 0, N, pos); h.update(buf.subarray(0, n)); };
    if (size <= 3 * N) {
      read(0); if (size > N) read(N); if (size > 2 * N) read(2 * N);
    } else {
      read(0);
      read(Math.floor((size - N) / 2));
      read(size - N);
    }
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

function ensureHistoryTable(db) {
  db.exec('CREATE TABLE IF NOT EXISTS video_key_history (id INTEGER PRIMARY KEY AUTOINCREMENT, old_key TEXT, new_key TEXT, path TEXT, reason TEXT, changed_at INTEGER)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_vkh_old ON video_key_history(old_key)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_vkh_new ON video_key_history(new_key)');
}

// 缩略图跟着改名(新key下还没有图才搬); 返回搬了几张
function moveThumbs(oldKey, newKey) {
  if (!oldKey || oldKey === newKey) return 0;
  const od = path.join(VTHUMB_DIR, oldKey.slice(0, 2));
  const nd = path.join(VTHUMB_DIR, newKey.slice(0, 2));
  let files;
  try { files = fs.readdirSync(od).filter((f) => f.indexOf(oldKey + '_') === 0); } catch (e) { return 0; }
  if (!files.length) return 0;
  if (fs.existsSync(path.join(nd, newKey + '_01.jpg'))) return 0;
  fs.mkdirSync(nd, { recursive: true });
  let n = 0;
  for (const f of files) { fs.renameSync(path.join(od, f), path.join(nd, newKey + f.slice(oldKey.length))); n++; }
  return n;
}

// 关联表(标签/标记/特征)跟着换key + 记变更历史。photo_marks/photo_features的md5是主键,
// 新key已经有记录时用OR IGNORE保留新的、删掉旧的, 不报冲突。
function remapKey(db, oldKey, newKey, opts) {
  if (!oldKey || !newKey || oldKey === newKey) return { thumbs: 0 };
  db.prepare('UPDATE photo_tags SET md5=? WHERE md5=?').run(newKey, oldKey);
  db.prepare('UPDATE OR IGNORE photo_marks SET md5=? WHERE md5=?').run(newKey, oldKey);
  db.prepare('DELETE FROM photo_marks WHERE md5=?').run(oldKey);
  db.prepare('UPDATE OR IGNORE photo_features SET md5=? WHERE md5=?').run(newKey, oldKey);
  db.prepare('DELETE FROM photo_features WHERE md5=?').run(oldKey);
  ensureHistoryTable(db);
  db.prepare('INSERT INTO video_key_history (old_key,new_key,path,reason,changed_at) VALUES (?,?,?,?,strftime(\'%s\',\'now\'))')
    .run(oldKey, newKey, (opts && opts.path) || null, (opts && opts.reason) || null);
  return { thumbs: moveThumbs(oldKey, newKey) };
}

module.exports = { quickKey, remapKey, ensureHistoryTable, moveThumbs };
