// video_cleanup.js — 清理数据库里"文件已不存在"的视频孤儿记录
//
// 只删数据库记录(photos 表 + 对应的评分收藏 photo_marks + 标签 photo_tags + 缩略图文件),
// 绝不碰磁盘上的任何真实文件。
//
// 用法:
//   node video_cleanup.js [--root a] [--roots a,b,c]      先看会删多少条(不执行)
//   node video_cleanup.js [--root a] [--roots a,b,c] --go  确认后执行删除
//
// 判定与 video_diff_check.js 完全一致(同一套根目录解析、同一套文件遍历规则),
// 建议先跑 video_diff_check.js 看清楚情况, 数字对上了再跑这个。

'use strict';

var fs   = require('fs');
var path = require('path');
var Database = require('better-sqlite3');

var DB_PATH    = '/share/ssd001/nas.db';
var VTHUMB_DIR = (process.env.PROJECT_DIR || '/share/Container/docker/services/nas-media') + '/vthumbs';
var VIDEO_EXT  = ['.mp4', '.mkv', '.avi', '.wmv', '.ts', '.rmvb', '.mov', '.webm',
                   '.flv', '.m4v', '.mpg', '.mpeg', '.m2ts', '.vob', '.asf'];

function resolveReal(r) {
  r = String(r).replace(/\\/g, '/').replace(/\/+$/, '');
  if (r.indexOf('/share/CACHEDEV') === 0) return r;
  var m = r.match(/^\/share\/(.+)$/);
  if (m) {
    for (var k = 1; k <= 8; k++) {
      var c = '/share/CACHEDEV' + k + '_DATA/' + m[1];
      try { if (fs.existsSync(c)) return c; } catch (e) {}
    }
  }
  return r;
}
function toDbPath(realPath) {
  var m = realPath.match(/^\/share\/CACHEDEV\d+_DATA(\/.*)$/);
  return m ? ('/share' + m[1]) : realPath;
}
function isVideoName(n) { return VIDEO_EXT.indexOf(path.extname(n).toLowerCase()) >= 0; }
function walk(dir, depth, out) {
  if (depth > 14) return;
  var ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (var i = 0; i < ents.length; i++) {
    var e = ents[i], full = dir + '/' + e.name;
    var isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = fs.statSync(full).isDirectory(); } catch (er) { continue; } }
    if (isDir) {
      if (e.name.charAt(0) === '@' || e.name.charAt(0) === '.') continue;
      walk(full, depth + 1, out);
    } else if (isVideoName(e.name)) {
      out.push(toDbPath(full));
    }
  }
}

var argv = process.argv.slice(2);
var GO = argv.indexOf('--go') >= 0;

var roots = [];
for (var i = 0; i < argv.length; i++) {
  if ((argv[i] === '--root' || argv[i] === '--roots') && argv[i + 1]) {
    argv[i + 1].split(',').forEach(function (x) { if (x.trim()) roots.push(x.trim()); });
  }
}
var db = new Database(DB_PATH, GO ? {} : { readonly: true });
if (!roots.length) {
  var br = db.prepare("SELECT path FROM browser_roots WHERE enabled = 1 AND source = 'nas'").all();
  roots = br.map(function (r) { return r.path; });
  if (!roots.length) roots = ['/share/Person'];
}
roots = roots.map(resolveReal).filter(function (r) { return fs.existsSync(r); });

console.log('扫描根目录 (' + roots.length + ' 个):');
roots.forEach(function (r) { console.log('  ' + r); });

var diskPaths = [];
roots.forEach(function (r) { walk(r, 0, diskPaths); });
var diskSet = new Set(diskPaths);
console.log('磁盘视频文件数: ' + diskPaths.length);

var dbRows = db.prepare("SELECT id, path, md5 FROM photos WHERE media_type = 'video'").all();
var orphans = dbRows.filter(function (r) { return !diskSet.has(r.path); });

console.log('数据库视频记录数: ' + dbRows.length);
console.log('孤儿记录(文件已不存在): ' + orphans.length);

if (!orphans.length) {
  console.log('没有需要清理的记录。');
  db.close();
  process.exit(0);
}

if (!GO) {
  console.log('');
  console.log('=== 只看不改, 前 20 条 ===');
  orphans.slice(0, 20).forEach(function (r) { console.log('  [' + r.id + ']  ' + r.path); });
  console.log('');
  console.log('确认无误后加 --go 执行删除(只删数据库记录, 不碰磁盘文件)。');
  db.close();
  process.exit(0);
}

// ── 执行删除 ────────────────────────────────────────
var delPhoto = db.prepare('DELETE FROM photos WHERE id = ?');
var delMark  = db.prepare('DELETE FROM photo_marks WHERE md5 = ?');
var delTag   = db.prepare('DELETE FROM photo_tags WHERE md5 = ?');

var okN = 0, thumbN = 0, markN = 0, tagN = 0;
var tx = db.transaction(function (rows) {
  rows.forEach(function (r) {
    delPhoto.run(r.id);
    okN++;
    if (r.md5) {
      markN += delMark.run(r.md5).changes;
      tagN  += delTag.run(r.md5).changes;
      // 顺手清掉这条记录的缩略图文件(vthumbs 目录, 不是 NAS 原始视频)
      var dir = VTHUMB_DIR + '/' + r.md5.slice(0, 2);
      try {
        if (fs.existsSync(dir)) {
          fs.readdirSync(dir).forEach(function (f) {
            if (f.indexOf(r.md5 + '_') === 0) { try { fs.unlinkSync(dir + '/' + f); thumbN++; } catch (e) {} }
          });
        }
      } catch (e) {}
    }
  });
});
tx(orphans);

console.log('');
console.log('完成:');
console.log('  删除记录数    : ' + okN);
console.log('  清理评分收藏  : ' + markN);
console.log('  清理标签      : ' + tagN);
console.log('  清理缩略图    : ' + thumbN + ' 张');

var left = db.prepare("SELECT COUNT(*) c FROM photos WHERE media_type = 'video'").get().c;
console.log('  剩余视频记录  : ' + left);

db.close();
