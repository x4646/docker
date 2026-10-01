// video_scan.js — 视频扫描入库
//
// 设计要点:
//   1. md5 = 文件名(不含路径)的 32 位十六进制哈希 —— 换目录不丢身份, 改名才丢
//      文件名已经全库唯一(改名脚本保证), 所以哈希天然唯一
//   2. media_type='video' 区分照片; 该字段由本脚本按需 ALTER TABLE 添加
//   3. 队列字段全部填 1(已处理) —— PC 上 clip_service.py 正在轮询,
//      填 0 会被立刻领走, CLIP 拿 mp4 解码必然出错
//   4. path 是 UNIQUE, 用 INSERT OR IGNORE, 重复运行安全
//   5. 路径统一存 /share/Person 前缀, 与照片保持一致(库里 13.6 万条都是这个前缀)
//
// 用法:
//   node video_scan.js           <- 只统计不写库
//   node video_scan.js --go      <- 真正入库
//   node video_scan.js --go --limit 100

'use strict';

var fs   = require('fs');
var path = require('path');

var SCAN_ROOT = '/share/CACHEDEV4_DATA/Person';   // 真实路径(带符号链接的 /share/Person 扫不到)
var DB_PREFIX = '/share/Person';                  // 入库时用的前缀, 与照片一致
var DB_PATH   = '/share/ssd001/nas.db';
var VIDEO_EXT = ['.mp4', '.mkv', '.avi', '.wmv', '.ts', '.rmvb', '.mov', '.webm', '.flv', '.m4v', '.mpg', '.mpeg', '.m2ts', '.vob', '.asf'];

var argv  = process.argv.slice(2);
var GO    = argv.indexOf('--go') >= 0;
var LIMIT = argv.indexOf('--limit') >= 0 ? parseInt(argv[argv.indexOf('--limit') + 1], 10) : 0;

// ══ 文件名 -> 32位十六进制 ════════════════════════════
// 四路 FNV/xxhash 变体拼接, 128bit 空间, 9445 个文件碰撞概率可忽略
function nameHash(name) {
  var h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
  for (var i = 0; i < name.length; i++) {
    var c = name.charCodeAt(i);
    h1 = ((h1 ^ c) * 0x01000193) >>> 0;
    h2 = (((h2 + c) >>> 0) * 0x85ebca6b) >>> 0;
    h3 = ((h3 ^ (c + i)) * 0x27220a95) >>> 0;
    h4 = (((h4 << 5) - h4 + c) >>> 0) ^ (h3 >>> 7);
    h4 = h4 >>> 0;
  }
  var hex = function (x) { return ('00000000' + x.toString(16)).slice(-8); };
  return hex(h1) + hex(h2) + hex(h3) + hex(h4);
}

// ══ 扫描 ══════════════════════════════════════════════
function isVideo(n) { return VIDEO_EXT.indexOf(path.extname(n).toLowerCase()) >= 0; }

var files = [];
function walk(dir, depth) {
  if (depth > 12) return;
  var ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (var i = 0; i < ents.length; i++) {
    var e = ents[i], full = dir + '/' + e.name, isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = fs.statSync(full).isDirectory(); } catch (err) { continue; } }
    if (isDir) {
      if (e.name.charAt(0) === '@' || e.name.charAt(0) === '.' || e.name === '转换' || e.name === '删除') continue;
      walk(full, depth + 1);
    } else if (isVideo(e.name)) {
      var st;
      try { st = fs.statSync(full); } catch (err) { continue; }
      files.push({
        full: full,
        name: e.name,
        dbPath: DB_PREFIX + full.slice(SCAN_ROOT.length),
        size: st.size,
        mtime: Math.floor(st.mtimeMs / 1000),
        ctime: Math.floor(st.ctimeMs / 1000)
      });
    }
  }
}

console.log('扫描中:', SCAN_ROOT);
walk(SCAN_ROOT, 0);
console.log('找到视频:', files.length, '个');

// ══ 哈希碰撞自检 ══════════════════════════════════════
var seen = {}, dup = [];
files.forEach(function (f) {
  f.md5 = nameHash(f.name);
  if (seen[f.md5]) dup.push([seen[f.md5], f.name]);
  else seen[f.md5] = f.name;
});
if (dup.length) {
  console.log('\n[中止] 文件名哈希碰撞', dup.length, '组, 未写入任何数据:');
  dup.slice(0, 10).forEach(function (d) { console.log('   -', d[0], '<->', d[1]); });
  console.log('   (说明有同名文件, 请先跑改名脚本)');
  process.exit(1);
}
console.log('哈希自检通过: 无碰撞');

// ══ 打开库 ════════════════════════════════════════════
var Database = require('better-sqlite3');
var db = new Database(DB_PATH);

// media_type 字段按需添加
var cols = db.prepare('PRAGMA table_info(photos)').all().map(function (c) { return c.name; });
if (cols.indexOf('media_type') < 0) {
  if (!GO) {
    console.log('\n[待办] photos 表缺少 media_type 字段, --go 时会自动添加');
  } else {
    db.exec("ALTER TABLE photos ADD COLUMN media_type TEXT NOT NULL DEFAULT 'photo'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_photos_media_type ON photos(media_type)");
    console.log('已添加 media_type 字段(现有记录默认 photo)并建索引');
  }
} else {
  console.log('media_type 字段已存在');
}

// ══ 与现有记录比对 ════════════════════════════════════
var exist = {};
db.prepare("SELECT path FROM photos WHERE path LIKE ?").all(DB_PREFIX + '/%').forEach(function (r) {
  exist[r.path] = 1;
});
var todo = files.filter(function (f) { return !exist[f.dbPath]; });

// 与照片 md5 撞车检查(md5 只是普通索引, 不会报错, 但会串了评分收藏)
// media_type 尚未建立时跳过 —— 那种情况下库里本来就没有视频记录
var clash = 0;
var hasMediaType = db.prepare('PRAGMA table_info(photos)').all()
                     .some(function (c) { return c.name === 'media_type'; });
if (todo.length && hasMediaType) {
  var q = db.prepare("SELECT 1 FROM photos WHERE md5=? LIMIT 1");
  for (var i = 0; i < todo.length; i++) {
    if (q.get(todo[i].md5)) { clash++; console.log('  [警告] md5 与现有记录重复:', todo[i].name); }
  }
} else if (todo.length) {
  // 无 media_type 时退化为纯 md5 比对
  var q2 = db.prepare("SELECT 1 FROM photos WHERE md5=? LIMIT 1");
  for (var j = 0; j < todo.length; j++) {
    if (q2.get(todo[j].md5)) { clash++; console.log('  [警告] md5 与现有记录重复:', todo[j].name); }
  }
}

console.log('\n扫描到     :', files.length);
console.log('库中已存在 :', files.length - todo.length);
console.log('待入库     :', todo.length);
if (clash) console.log('md5 撞车   :', clash, '  <<< 需处理');

if (!GO) {
  console.log('\n=== 只统计不写库 ===');
  console.log('样例(前10条):');
  todo.slice(0, 10).forEach(function (f) {
    console.log('  ' + f.md5 + '  ' + f.dbPath);
  });
  console.log('\n确认无误后加 --go 执行。');
  db.close();
  process.exit(0);
}

// ══ 入库 ══════════════════════════════════════════════
var list = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
var now = Math.floor(Date.now() / 1000);

// 队列字段全填 1: PC 上 clip_service.py 正在轮询, 填 0 会被领走去解码 mp4
var ins = db.prepare(
  "INSERT OR IGNORE INTO photos " +
  "(path, size, mtime, ctime, md5, status, media_type, " +
  " ai_tags, user_tags, favorite, " +
  " ai_status, feat_status, vlm_status, clip_status, exif_written, priority, " +
  " created_at, updated_at) " +
  "VALUES (?,?,?,?,?, 'done','video', '[]','[]',0, 1,1,1,1,1,0, ?,?)"
);

var n = 0;
var tx = db.transaction(function (arr) {
  for (var i = 0; i < arr.length; i++) {
    var f = arr[i];
    var r = ins.run(f.dbPath, f.size, f.mtime, f.ctime, f.md5, now, now);
    n += r.changes;
  }
});

console.log('\n开始入库, 共', list.length, '条...');
tx(list);
console.log('实际写入:', n, '条');

var total = db.prepare("SELECT COUNT(*) c FROM photos WHERE media_type='video'").get().c;
console.log('库中视频总数:', total);
db.close();
console.log('\n完成。注意: 队列字段已全部置 1, CLIP/VLM/特征提取不会领取视频。');
