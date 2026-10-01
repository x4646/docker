// video_relocate.js — 文件夹结构变了(文件被挪动)时, 按文件名重新定位并修复数据库路径
//
// 前提: 已用 video_dupname_check.js 确认磁盘上视频文件名全局唯一(本项目里已确认: 是)。
// md5 = 文件名的哈希, 所以文件挪到哪个文件夹都不影响它的"身份"——评分、标签、抽帧
// 状态全部继续有效, 只有 photos.path 这一列需要更新成新的实际位置。
//
// 流程:
//   ① 数据库记录按完整路径能在磁盘上找到 -> 什么都不做(路径本来就对)
//   ② 数据库记录按完整路径找不到, 但按文件名能在磁盘清单里唯一定位到 -> 更新 path
//      (md5/评分/标签/shots 全部不变, 因为身份没变, 只是挪了地方)
//   ③ 数据库记录按文件名也找不到(磁盘上真的没有这个文件了) -> 真孤儿, 交给
//      video_cleanup.js 处理, 这个脚本不碰
//
// 只改数据库的 path 字段, 绝不碰磁盘上的任何文件。
//
// 用法:
//   node video_relocate.js [--root a] [--roots a,b,c]        只看会修复多少条, 不执行
//   node video_relocate.js [--root a] [--roots a,b,c] --go   确认后执行

'use strict';

var fs   = require('fs');
var path = require('path');
var Database = require('better-sqlite3');

var DB_PATH = '/share/ssd001/nas.db';
var VIDEO_EXT = ['.mp4', '.mkv', '.avi', '.wmv', '.ts', '.rmvb', '.mov', '.webm',
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
      if (e.name.charAt(0) === '@' || e.name.charAt(0) === '.' || e.name === '转换' || e.name === '删除') continue;
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
var diskPathSet = new Set(diskPaths);
console.log('磁盘视频文件数: ' + diskPaths.length);

// 文件名 -> 路径 映射(仅收录全局唯一的文件名; 重复的直接跳过, 不参与定位, 避免歧义)
var byName = {};
diskPaths.forEach(function (p) {
  var name = p.split('/').pop();
  (byName[name] = byName[name] || []).push(p);
});
var nameToPath = {};
var skippedDup = 0;
Object.keys(byName).forEach(function (n) {
  if (byName[n].length === 1) nameToPath[n] = byName[n][0];
  else skippedDup++;
});
if (skippedDup) console.log('文件名重复(不参与按名定位, 跳过): ' + skippedDup + ' 组');
console.log('');

var dbRows = db.prepare("SELECT id, path, md5 FROM photos WHERE media_type = 'video'").all();
console.log('数据库视频记录数: ' + dbRows.length);

var okAsIs = 0;
var toRelocate = [];
var trueOrphan = 0;

dbRows.forEach(function (r) {
  if (diskPathSet.has(r.path)) { okAsIs++; return; }
  var name = r.path.split('/').pop();
  var newPath = nameToPath[name];
  if (newPath && newPath !== r.path) {
    toRelocate.push({ id: r.id, oldPath: r.path, newPath: newPath, md5: r.md5 });
  } else {
    trueOrphan++;
  }
});

console.log('');
console.log('=== 结果 ===');
console.log('路径本来就正确    : ' + okAsIs);
console.log('文件被挪动, 需要修复路径: ' + toRelocate.length);
console.log('按文件名也找不到(真孤儿, 不在本脚本处理范围): ' + trueOrphan);

if (toRelocate.length) {
  console.log('');
  console.log('=== 需要修复的前 20 条 ===');
  toRelocate.slice(0, 20).forEach(function (r) {
    console.log('  ' + r.oldPath);
    console.log('   -> ' + r.newPath);
  });
}

if (!toRelocate.length) {
  console.log('');
  console.log('没有需要修复的记录。');
  db.close();
  process.exit(0);
}

if (!GO) {
  console.log('');
  console.log('确认无误后加 --go 执行(只改数据库 path 字段, md5/评分/标签/抽帧状态都不变, 不碰磁盘文件)。');
  db.close();
  process.exit(0);
}

var upStmt = db.prepare("UPDATE photos SET path = ?, updated_at = strftime('%s','now') WHERE id = ?");
var okN = 0, errN = 0;
var tx = db.transaction(function (rows) {
  rows.forEach(function (r) {
    try { upStmt.run(r.newPath, r.id); okN++; }
    catch (e) { errN++; console.log('  失败 [' + r.id + '] ' + r.oldPath + ' : ' + e.message); }
  });
});
tx(toRelocate);

console.log('');
console.log('完成: 修复 ' + okN + ' 条' + (errN ? (', 失败 ' + errN + ' 条') : ''));
db.close();
