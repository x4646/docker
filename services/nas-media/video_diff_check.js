// video_diff_check.js — 只读诊断: 数据库记录 vs 磁盘真实文件
//
// 检查三类问题:
//   ① 数据库有记录, 但磁盘文件已不存在(该删除的旧记录)
//   ② 磁盘有视频文件, 但数据库里没有记录(还没入库的新文件)
//   ③ 已入库但还没抽帧的(shots=0), 以及抽帧失败的(shots=-1)
//
// 只读, 不修改任何数据。看完结果再决定要不要用 video_cleanup.js 清理。
//
// 用法: node video_diff_check.js [--root /share/Media] [--roots a,b,c]
//   不指定 --root/--roots 时, 自动从 browser_roots 表读启用的 nas 根目录
//   (和 rename_preview.js / video_scan.js 保持一致的根目录来源)

'use strict';

var fs   = require('fs');
var path = require('path');
var Database = require('better-sqlite3');

var DB_PATH = '/share/ssd001/nas.db';
var VIDEO_EXT = ['.mp4', '.mkv', '.avi', '.wmv', '.ts', '.rmvb', '.mov', '.webm',
                  '.flv', '.m4v', '.mpg', '.mpeg', '.m2ts', '.vob', '.asf'];

// ── 根目录解析(与 rename_preview.js 同一套逻辑) ──────
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

function getRoots() {
  var a = process.argv.slice(2);
  var list = [];
  for (var i = 0; i < a.length; i++) {
    if ((a[i] === '--root' || a[i] === '--roots') && a[i + 1]) {
      a[i + 1].split(',').forEach(function (x) { if (x.trim()) list.push(x.trim()); });
    }
  }
  if (list.length) return list.map(resolveReal).filter(function (r) { return fs.existsSync(r); });

  var db = new Database(DB_PATH, { readonly: true });
  var rows = db.prepare("SELECT path FROM browser_roots WHERE enabled = 1 AND source = 'nas'").all();
  db.close();
  var out = rows.map(function (r) { return resolveReal(r.path); }).filter(function (r) { return fs.existsSync(r); });
  return out.length ? out : [resolveReal('/share/Person')];
}

// ── 遍历磁盘, 收集所有真实视频文件(与 video-ext.js 的 walkVideos 同一套过滤规则) ──
function isVideoName(n) {
  return VIDEO_EXT.indexOf(path.extname(n).toLowerCase()) >= 0;
}
function walk(dir, depth, out) {
  if (depth > 14) return;
  var ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (var i = 0; i < ents.length; i++) {
    var e = ents[i], full = dir + '/' + e.name;
    var isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = fs.statSync(full).isDirectory(); } catch (er) { continue; } }
    if (isDir) {
      if (e.name.charAt(0) === '@' || e.name.charAt(0) === '.') continue;   // 跳过系统/隐藏目录(含 .@__thumb 这类)
      walk(full, depth + 1, out);
    } else if (isVideoName(e.name)) {
      out.push(toDbPath(full));
    }
  }
}

// ── 主流程 ──────────────────────────────────────────
var roots = getRoots();
console.log('扫描根目录 (' + roots.length + ' 个):');
roots.forEach(function (r) { console.log('  ' + r); });
console.log('');

console.log('正在扫描磁盘...');
var diskPaths = [];
roots.forEach(function (r) { walk(r, 0, diskPaths); });
var diskSet = new Set(diskPaths);
console.log('磁盘实际视频文件数: ' + diskPaths.length);
console.log('');

var db = new Database(DB_PATH, { readonly: true });
var dbRows = db.prepare("SELECT id, path, md5, shots FROM photos WHERE media_type = 'video'").all();
console.log('数据库视频记录数: ' + dbRows.length);
console.log('');

// ① 数据库有, 磁盘没有(该删除的孤儿记录)
var orphans = dbRows.filter(function (r) { return !diskSet.has(r.path); });
console.log('=== ① 数据库有记录但磁盘文件已不存在 ===');
console.log('数量: ' + orphans.length);
if (orphans.length) {
  console.log('前 15 条:');
  orphans.slice(0, 15).forEach(function (r) { console.log('  [' + r.id + ']  ' + r.path); });
  var byRoot = {};
  orphans.forEach(function (r) {
    var parts = r.path.split('/').filter(Boolean);
    var key = '/' + parts.slice(0, 2).join('/');
    byRoot[key] = (byRoot[key] || 0) + 1;
  });
  console.log('按根目录分布:');
  Object.keys(byRoot).sort(function (a, b) { return byRoot[b] - byRoot[a]; })
    .forEach(function (k) { console.log('  ' + String(byRoot[k]).padStart(6) + '  ' + k); });
}
console.log('');

// ② 磁盘有, 数据库没有(还没入库的新文件)
var dbPathSet = new Set(dbRows.map(function (r) { return r.path; }));
var newOnes = diskPaths.filter(function (p) { return !dbPathSet.has(p); });
console.log('=== ② 磁盘有文件但数据库里没有记录(还没入库) ===');
console.log('数量: ' + newOnes.length);
if (newOnes.length) {
  console.log('前 15 条:');
  newOnes.slice(0, 15).forEach(function (p) { console.log('  ' + p); });
  var byRoot2 = {};
  newOnes.forEach(function (p) {
    var parts = p.split('/').filter(Boolean);
    var key = '/' + parts.slice(0, 2).join('/');
    byRoot2[key] = (byRoot2[key] || 0) + 1;
  });
  console.log('按根目录分布:');
  Object.keys(byRoot2).sort(function (a, b) { return byRoot2[b] - byRoot2[a]; })
    .forEach(function (k) { console.log('  ' + String(byRoot2[k]).padStart(6) + '  ' + k); });
}
console.log('');

// ③ 已入库但还没抽帧 / 抽帧失败的(只统计仍然在磁盘上存在的, 排除孤儿)
var alive = dbRows.filter(function (r) { return diskSet.has(r.path); });
var pending = alive.filter(function (r) { return r.shots === 0; });
var failed  = alive.filter(function (r) { return r.shots === -1; });
var done    = alive.filter(function (r) { return r.shots > 0; });
console.log('=== ③ 抽帧状态(仅统计磁盘上仍存在的视频) ===');
console.log('有效记录总数: ' + alive.length);
console.log('  已抽帧    : ' + done.length);
console.log('  待抽帧    : ' + pending.length);
console.log('  抽帧失败  : ' + failed.length);
console.log('');

console.log('=== 总结 ===');
console.log('磁盘视频: ' + diskPaths.length);
console.log('数据库记录: ' + dbRows.length + ' (其中孤儿 ' + orphans.length + ' 条)');
console.log('需要新入库: ' + newOnes.length + ' 条');
console.log('需要抽帧(待处理+失败): ' + (pending.length + failed.length) + ' 条');
console.log('');
console.log('确认无误后, 用 video_cleanup.js 清理孤儿记录(不会碰磁盘文件本身)。');
console.log('新文件入库走目录树右键菜单的"扫描视频入库", 或重跑 video_scan.js。');

db.close();
