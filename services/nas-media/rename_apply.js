// rename_apply.js — 视频文件改名【执行】
//
// 规则与 rename_preview.js 完全一致(同一份清洗代码), 因此改名结果与预演报告一一对应。
//
// 用法:
//   docker exec nas-media node /app/rename_apply.js            <- 只算不改(等同预演)
//   docker exec nas-media node /app/rename_apply.js --go       <- 真正执行
//   docker exec nas-media node /app/rename_apply.js --go --limit 50   <- 只改前50个(先小批验证)
//   docker exec nas-media node /app/rename_apply.js --rollback <日志文件>  <- 按日志回滚
//
// 日志: $PROJECT_DIR/rename_log_<时间戳>.tsv (PROJECT_DIR见Dockerfile里的ENV)
//       每行 "旧完整路径 <TAB> 新完整路径", 回滚就靠它。

'use strict';

var fs   = require('fs');
var path = require('path');

// 扫描根目录: --roots a,b,c 或 --root a (可多次)
// 支持 /share/Xxx 与 /share/CACHEDEV?_DATA/Xxx 两种写法, 自动解析真实路径
// 根目录: 默认从数据库 browser_roots 读(与图片管理共用同一份配置)
// 也可用 --roots a,b 手动指定; --db 指定库路径
var ROOTS = (function () {
  var a = process.argv.slice(2);
  var fsx = require('fs');

  var resolveReal = function (r) {
    r = String(r).replace(/\\/g, '/').replace(/\/+$/, '');
    if (r.indexOf('/share/CACHEDEV') === 0) return r;
    var m = r.match(/^\/share\/(.+)$/);
    if (m) {
      for (var k = 1; k <= 8; k++) {
        var c = '/share/CACHEDEV' + k + '_DATA/' + m[1];
        try { if (fsx.existsSync(c)) return c; } catch (e) {}
      }
    }
    return r;
  };

  var list = [];
  for (var i = 0; i < a.length; i++) {
    if ((a[i] === '--root' || a[i] === '--roots') && a[i + 1]) {
      a[i + 1].split(',').forEach(function (x) { if (x.trim()) list.push(x.trim()); });
    }
  }

  if (!list.length) {
    // 从 browser_roots 取启用的 nas 根目录
    var dbi = a.indexOf('--db');
    var dbPath = (dbi >= 0 && a[dbi + 1]) ? a[dbi + 1] : '/share/ssd001/nas.db';
    try {
      var D = require('better-sqlite3');
      var d = new D(dbPath, { readonly: true });
      d.prepare("SELECT path FROM browser_roots WHERE enabled = 1 AND source = 'nas'")
       .all().forEach(function (r) { list.push(r.path); });
      d.close();
      console.log('从 browser_roots 读到', list.length, '个根目录');
    } catch (e) {
      console.log('[警告] 读 browser_roots 失败:', e.message, '— 回退到 /share/Person');
      list = ['/share/Person'];
    }
  }

  // 去掉被其它根包含的子目录, 避免重复扫描
  var real = list.map(resolveReal).filter(function (r) {
    var ok = false;
    try { ok = fsx.existsSync(r); } catch (e) {}
    if (!ok) console.log('[警告] 根目录不存在, 跳过:', r);
    return ok;
  });
  real.sort();
  var out = [];
  real.forEach(function (r) {
    var covered = out.some(function (o) { return r === o || r.indexOf(o + '/') === 0; });
    if (!covered) out.push(r);
  });
  return out;
})();
var ROOT = ROOTS[0] || '';
var LOGDIR   = process.env.PROJECT_DIR || '/share/Container/docker/services/nas-media';
var MAX_LEN  = 60;
var VIDEO_EXT = ['.mp4', '.mkv', '.avi', '.wmv', '.ts', '.rmvb', '.mov', '.webm', '.flv', '.m4v', '.mpg', '.mpeg', '.m2ts', '.vob', '.asf'];

// ══ 参数 ══════════════════════════════════════════════
var argv     = process.argv.slice(2);
var GO       = argv.indexOf('--go') >= 0;
var ROLLBACK = argv.indexOf('--rollback') >= 0 ? argv[argv.indexOf('--rollback') + 1] : null;
var LIMIT    = argv.indexOf('--limit') >= 0 ? parseInt(argv[argv.indexOf('--limit') + 1], 10) : 0;

// ══ 回滚模式 ══════════════════════════════════════════
if (ROLLBACK) {
  if (!fs.existsSync(ROLLBACK)) { console.log('[失败] 日志文件不存在:', ROLLBACK); process.exit(1); }
  var rows = fs.readFileSync(ROLLBACK, 'utf8').split('\n').filter(Boolean);
  console.log('日志共', rows.length, '条, 开始回滚(逆序)...');
  var ok = 0, skip = 0, err = 0;
  for (var i = rows.length - 1; i >= 0; i--) {
    var p = rows[i].split('\t');
    if (p.length < 2) continue;
    var oldPath = p[0], newPath = p[1];
    if (!fs.existsSync(newPath)) { skip++; continue; }
    if (fs.existsSync(oldPath))  { console.log('  跳过(原名已被占用):', oldPath); skip++; continue; }
    try { fs.renameSync(newPath, oldPath); ok++; }
    catch (e) { console.log('  失败:', newPath, e.message); err++; }
  }
  console.log('回滚完成: 成功', ok, '跳过', skip, '失败', err);
  process.exit(0);
}

// ══ 清洗规则(与预演脚本一致)══════════════════════════
// ══ 命名规则 ══════════════════════════════════════════
// 不做任何清洗, 原名保持不动。
// 仅当文件名在全部根目录范围内重复时, 给「非第一个」加上文件修改时间戳。
// 用修改时间而非当前时间 —— 同一文件每次运行结果一致, 中断续跑不会重复改名。

function cleanFileName(orig) { return orig; }   // 保留接口, 不做改动

function addStamp(name, stamp) {
  var m = name.match(/^(.*?)(\.[A-Za-z0-9]{1,5})?$/);
  return m[1] + '_' + stamp + (m[2] || '');
}

function shortHash(str) {
  var h1 = 0x811c9dc5, h2 = 0x01000193;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    h1 = ((h1 ^ c) * 0x01000193) >>> 0;
    h2 = (((h2 + c) >>> 0) * 0x85ebca6b) >>> 0;
  }
  return ('00000000' + h1.toString(16)).slice(-8).slice(0, 3) +
         ('00000000' + h2.toString(16)).slice(-8).slice(0, 3);
}

function addSuffix(name, sfx) {
  var m = name.match(/^(.*?)(\.[A-Za-z0-9]{1,5})?$/);
  return m[1] + '_' + sfx + (m[2] || '');
}

function dirTag(dir, levels) {
  var parts = dir.split('/').filter(Boolean);
  var t = parts.slice(-levels).map(function (x) { return cleanBase(x); }).join('_');
  t = t.replace(/[_\-.]{2,}/g, '_').replace(/^[_\-.]+|[_\-.]+$/g, '');
  return truncate(t, 24);
}

// ══ 扫描 ══════════════════════════════════════════════
function isVideo(name) { return VIDEO_EXT.indexOf(path.extname(name).toLowerCase()) >= 0; }

var byDir = {}, scanned = 0, dirs = 0;

function walk(dir, depth) {
  if (depth > 12) return;
  var ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  dirs++;
  var vids = [], others = {};
  for (var i = 0; i < ents.length; i++) {
    var e = ents[i], full = dir + '/' + e.name, isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = fs.statSync(full).isDirectory(); } catch (err) { continue; } }
    if (isDir) {
      if (e.name.charAt(0) === '@' || e.name.charAt(0) === '.') continue;
      walk(full, depth + 1);
    } else {
      if (isVideo(e.name)) { vids.push(e.name); scanned++; }
      else others[e.name] = 1;
    }
  }
  if (vids.length) byDir[dir] = { videos: vids, others: others };
}

console.log('扫描根目录:');
ROOTS.forEach(function (r) { console.log('  ' + r); });
ROOTS.forEach(function (r) { walk(r, 0); });
console.log('目录', dirs, '个, 视频', scanned, '个');

// ══ 计算方案 (只处理重名, 逻辑与预演完全一致) ═════════
var all = [];
Object.keys(byDir).sort().forEach(function (dir) {
  byDir[dir].videos.slice().sort().forEach(function (orig) {
    all.push({ dir: dir, orig: orig, want: orig, stamped: false });
  });
});

var groups = {};
all.forEach(function (e) {
  var k = e.orig.toLowerCase();
  (groups[k] = groups[k] || []).push(e);
});

var taken = {};
all.forEach(function (e) { if (groups[e.orig.toLowerCase()].length === 1) taken[e.orig.toLowerCase()] = 1; });

Object.keys(groups).forEach(function (k) {
  var g = groups[k];
  if (g.length === 1) return;
  g.sort(function (a, b) {
    var x = a.dir + '/' + a.orig, y = b.dir + '/' + b.orig;
    return x < y ? -1 : (x > y ? 1 : 0);
  });
  taken[g[0].orig.toLowerCase()] = 1;
  for (var i = 1; i < g.length; i++) {
    var e = g[i];
    var mt = 0;
    try { mt = Math.floor(fs.statSync(e.dir + '/' + e.orig).mtimeMs / 1000); } catch (er) { mt = 0; }
    var cand = addStamp(e.orig, mt);
    var n = 2;
    while (taken[cand.toLowerCase()]) { cand = addStamp(e.orig, mt + '_' + n); n++; }
    taken[cand.toLowerCase()] = 1;
    e.want = cand;
    e.stamped = true;
  }
});

all.forEach(function (e) {
  if (e.want === e.orig) return;
  var others = byDir[e.dir].others;
  for (var k2 in others) {
    if (k2.toLowerCase() === e.want.toLowerCase()) { e.want = addStamp(e.want, 'x'); break; }
  }
});

var todo = all.filter(function (e) { return e.want !== e.orig; });
console.log('需要改名:', todo.length, '/ 总数', all.length);

// ══ 执行前自检 ════════════════════════════════════════
var problems = [];
var seenTarget = {};
todo.forEach(function (e) {
  var target = e.dir + '/' + e.want;
  if (seenTarget[target.toLowerCase()]) problems.push('目标路径重复: ' + target);
  seenTarget[target.toLowerCase()] = 1;
  if (e.want.indexOf('/') >= 0) problems.push('新名含路径分隔符: ' + e.want);
  if (!e.want.trim()) problems.push('新名为空: ' + e.dir + '/' + e.orig);
});
if (problems.length) {
  console.log('\n[中止] 自检发现', problems.length, '个问题, 未改动任何文件:');
  problems.slice(0, 20).forEach(function (p) { console.log('   -', p); });
  process.exit(1);
}
console.log('自检通过: 无重复目标、无非法字符');

if (!GO) {
  console.log('\n=== 当前是【只算不改】模式 ===');
  console.log('确认无误后加 --go 参数真正执行。');
  console.log('建议先小批验证:  --go --limit 50');
  process.exit(0);
}

// ══ 执行 ══════════════════════════════════════════════
var list = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
var stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
var logPath = LOGDIR + '/rename_log_' + stamp + '.tsv';
var logFd;
try { logFd = fs.openSync(logPath, 'a'); }
catch (e) { console.log('[中止] 无法创建日志文件:', e.message); process.exit(1); }

console.log('\n开始执行, 共', list.length, '个');
console.log('日志:', logPath);

var done = 0, failed = 0;
for (var i = 0; i < list.length; i++) {
  var e = list[i];
  var oldPath = e.dir + '/' + e.orig;
  var newPath = e.dir + '/' + e.want;
  try {
    if (!fs.existsSync(oldPath)) { console.log('  源不存在, 跳过:', oldPath); continue; }
    if (fs.existsSync(newPath)) {
      console.log('\n[中止] 目标已存在, 停在第', i + 1, '个:', newPath);
      failed++;
      break;
    }
    fs.renameSync(oldPath, newPath);
    // 先落盘日志再继续, 保证任何时刻中断都能回滚
    fs.writeSync(logFd, oldPath + '\t' + newPath + '\n');
    done++;
    if (done % 500 === 0) console.log('  已完成', done, '/', list.length);
  } catch (err) {
    console.log('\n[中止] 第', i + 1, '个改名失败:', oldPath);
    console.log('       ', err.message);
    failed++;
    break;
  }
}
fs.closeSync(logFd);

console.log('\n完成: 成功', done, '个, 失败', failed, '个');
if (failed) {
  console.log('已在失败处停止, 之前的改动都记在日志里。');
  console.log('回滚命令:');
  console.log('  node ' + __filename + ' --rollback ' + logPath);
} else if (LIMIT > 0) {
  console.log('这是小批验证(--limit ' + LIMIT + ')。确认无误后去掉 --limit 跑完剩余。');
} else {
  console.log('全部完成。回滚命令(如需):');
  console.log('  node ' + __filename + ' --rollback ' + logPath);
}
