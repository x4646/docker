// rename_preview.js — 视频文件改名【预演】, 只生成报告, 不改动任何文件
//
// 运行: docker exec nas-media node /app/rename_preview.js
// 报告: $PROJECT_DIR/rename_preview.txt (PROJECT_DIR见Dockerfile里的ENV)
//
// 规则: 保留中日韩文; 去掉推广域名/emoji/装饰符号/括号/全角标点/多余空格; 扩展名转小写;
//       主名截断 60 字符; 同目录内撞名自动加 _2 _3

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
var OUT = (process.env.PROJECT_DIR || '/share/Container/docker/services/nas-media') + '/rename_preview.txt';
var MAX_LEN  = 60;
var VIDEO_EXT = ['.mp4', '.mkv', '.avi', '.wmv', '.ts', '.rmvb', '.mov', '.webm', '.flv', '.m4v', '.mpg', '.mpeg', '.m2ts', '.vob', '.asf'];

// ══ 清洗规则 ══════════════════════════════════════════
// ══ 命名规则 ══════════════════════════════════════════
// 不做任何清洗, 原名保持不动。
// 仅当文件名在全部根目录范围内重复时, 给「非第一个」加上文件修改时间戳。
// 用修改时间而非当前时间 —— 同一文件每次运行结果一致, 中断续跑不会重复改名。

function cleanFileName(orig) { return orig; }   // 保留接口, 不做改动

function isVideo(name) {
  var e = require('path').extname(name).toLowerCase();
  return VIDEO_EXT.indexOf(e) >= 0;
}

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

var byDir = {};   // dir -> { videos:[name], others:Set }
var scanned = 0, dirs = 0;

function walk(dir, depth) {
  if (depth > 12) return;
  var ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  dirs++;
  var vids = [], others = {};
  for (var i = 0; i < ents.length; i++) {
    var e = ents[i];
    var full = dir + '/' + e.name;
    var isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      try { isDir = fs.statSync(full).isDirectory(); } catch (err) { continue; }
    }
    if (isDir) {
      if (e.name.charAt(0) === '@' || e.name.charAt(0) === '.' || e.name === '转换' || e.name === '删除') continue;
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

// ══ 计算改名方案 (只处理重名) ═════════════════════════
var lines = [];
var nChange = 0, nSame = 0, nStamped = 0;
var samples = [];

// 收集全部文件
var all = [];
Object.keys(byDir).sort().forEach(function (dir) {
  byDir[dir].videos.slice().sort().forEach(function (orig) {
    all.push({ dir: dir, orig: orig, want: orig, stamped: false });
  });
});

// 按文件名分组(不区分大小写, 因为 Windows 侧不区分)
var groups = {};
all.forEach(function (e) {
  var k = e.orig.toLowerCase();
  (groups[k] = groups[k] || []).push(e);
});

// 每组第一个(按完整路径排序)保持原名, 其余加文件修改时间戳
var taken = {};
all.forEach(function (e) { if (groups[e.orig.toLowerCase()].length === 1) taken[e.orig.toLowerCase()] = 1; });

Object.keys(groups).forEach(function (k) {
  var g = groups[k];
  if (g.length === 1) return;
  g.sort(function (a, b) {
    var x = a.dir + '/' + a.orig, y = b.dir + '/' + b.orig;
    return x < y ? -1 : (x > y ? 1 : 0);
  });
  taken[g[0].orig.toLowerCase()] = 1;      // 第一个保持原名
  for (var i = 1; i < g.length; i++) {
    var e = g[i];
    var st2 = 0;
    try { st2 = Math.floor(fs.statSync(e.dir + '/' + e.orig).mtimeMs / 1000); } catch (er) { st2 = 0; }
    var cand = addStamp(e.orig, st2);
    var n = 2;
    // 同一秒内修改的同名文件(极罕见)再补序号
    while (taken[cand.toLowerCase()]) { cand = addStamp(e.orig, st2 + '_' + n); n++; }
    taken[cand.toLowerCase()] = 1;
    e.want = cand;
    e.stamped = true;
    nStamped++;
  }
});

// 同目录内避开非视频文件同名
all.forEach(function (e) {
  if (e.want === e.orig) return;
  var others = byDir[e.dir].others;
  for (var k2 in others) {
    if (k2.toLowerCase() === e.want.toLowerCase()) {
      e.want = addStamp(e.want, 'x');
      break;
    }
  }
});

var planByDir = {};
all.forEach(function (e) {
  (planByDir[e.dir] = planByDir[e.dir] || []).push(e);
  if (e.want === e.orig) nSame++; else nChange++;
});

Object.keys(planByDir).sort().forEach(function (dir) {
  var changed = planByDir[dir].filter(function (p) { return p.want !== p.orig; });
  if (!changed.length) return;
  lines.push('');
  lines.push('[目录] ' + dir);
  changed.forEach(function (p) {
    lines.push('  旧: ' + p.orig);
    lines.push('  新: ' + p.want + '     <<< 重名, 加修改时间戳');
    if (samples.length < 40) samples.push(p);
  });
});

// ══ 输出 ══════════════════════════════════════════════
var head = [
  '视频改名预演报告  ' + new Date().toISOString(),
  '扫描根目录:',
  '  ' + ROOTS.join('\n  '),
  '',
  '视频文件总数 : ' + scanned,
  '需要改名     : ' + nChange,
  '本来就干净   : ' + nSame,
  '  (全部为重名加时间戳)',
  '',
  '注意: 本次仅生成报告, 未改动任何文件。',
  '='.repeat(70)
];

try {
  fs.writeFileSync(OUT, head.concat(lines).join('\n'), 'utf8');
  console.log('\n报告已写入:', OUT);
} catch (e) {
  console.log('\n写报告失败:', e.message);
}

console.log('');
head.forEach(function (l) { console.log(l); });
console.log('\n──── 前 40 条示例 ────');
samples.forEach(function (p) {
  console.log('  旧: ' + p.orig);
  console.log('  新: ' + p.want + (p.deduped ? '     <<< 撞名' : ''));
});
