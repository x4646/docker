// video_dupname_check.js — 检查磁盘上是否存在"同一文件名出现在多个位置"
//
// 只读, 不改任何东西。在按文件名重新定位路径之前, 必须先确认这种情况的
// 严重程度 —— 如果同名文件分布在多处, 按文件名匹配就会有歧义, 不能瞎猜。
//
// 用法: node video_dupname_check.js [--root a] [--roots a,b,c]
//   不指定时自动从 browser_roots 读取启用的 nas 根目录

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
      if (e.name.charAt(0) === '@' || e.name.charAt(0) === '.') continue;
      walk(full, depth + 1, out);
    } else if (isVideoName(e.name)) {
      out.push(toDbPath(full));
    }
  }
}

var argv = process.argv.slice(2);
var roots = [];
for (var i = 0; i < argv.length; i++) {
  if ((argv[i] === '--root' || argv[i] === '--roots') && argv[i + 1]) {
    argv[i + 1].split(',').forEach(function (x) { if (x.trim()) roots.push(x.trim()); });
  }
}
var db = new Database(DB_PATH, { readonly: true });
if (!roots.length) {
  var br = db.prepare("SELECT path FROM browser_roots WHERE enabled = 1 AND source = 'nas'").all();
  roots = br.map(function (r) { return r.path; });
  if (!roots.length) roots = ['/share/Person'];
}
roots = roots.map(resolveReal).filter(function (r) { return fs.existsSync(r); });

console.log('扫描根目录 (' + roots.length + ' 个):');
roots.forEach(function (r) { console.log('  ' + r); });
console.log('');

var diskPaths = [];
roots.forEach(function (r) { walk(r, 0, diskPaths); });
console.log('磁盘视频文件总数: ' + diskPaths.length);

// 按文件名分组
var byName = {};
diskPaths.forEach(function (p) {
  var name = p.split('/').pop();
  (byName[name] = byName[name] || []).push(p);
});

var dupNames = Object.keys(byName).filter(function (n) { return byName[n].length > 1; });
console.log('文件名重复的组数: ' + dupNames.length);
console.log('涉及文件数: ' + dupNames.reduce(function (a, n) { return a + byName[n].length; }, 0));
console.log('');

if (dupNames.length) {
  console.log('=== 重复最多的前 20 组 ===');
  dupNames.sort(function (a, b) { return byName[b].length - byName[a].length; });
  dupNames.slice(0, 20).forEach(function (n) {
    console.log('  "' + n + '"  出现 ' + byName[n].length + ' 次:');
    byName[n].forEach(function (p) { console.log('      ' + p); });
  });
  console.log('');
  console.log('这些文件名如果用来"按文件名重新定位路径", 会有歧义(不知道该更新到哪一个),');
  console.log('后续脚本会自动跳过这些文件名, 不做修复, 只处理文件名全局唯一的情况。');
} else {
  console.log('磁盘上所有视频文件名全局唯一, 没有歧义, 可以放心按文件名重新定位路径。');
}

db.close();
