// video_content_dedup.js — 按文件内容查找重复视频(不是文件名, 是真实字节内容)
//
// 与数据库里的 md5(=文件名哈希, 用于身份识别)完全是两回事, 这个脚本只读文件内容,
// 不碰数据库, 不改任何东西, 纯粹扫描输出一份重复清单报告。
//
// 策略: 大小不同的文件内容不可能相同, 先按文件大小分组过滤掉绝大部分,
// 只对"大小相同的一组"里的文件真正读内容算哈希, 大幅减少要读的文件数据量。
//
// 用法:
//   node video_content_dedup.js [--root a] [--roots a,b,c]     用默认设置跑
//   node video_content_dedup.js --max-size 20                  超过20GB的文件跳过(默认50GB)
//   node video_content_dedup.js --out /path/to/report.txt      指定报告输出位置
//
// 不指定 --root/--roots 时, 自动从 browser_roots 表读启用的 nas 根目录。

'use strict';

var fs     = require('fs');
var path   = require('path');
var crypto = require('crypto');
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
      var st;
      try { st = fs.statSync(full); } catch (er) { continue; }
      out.push({ path: full, size: st.size });
    }
  }
}

function md5OfFile(p) {
  return new Promise(function (resolve, reject) {
    var hash = crypto.createHash('md5');
    var stream = fs.createReadStream(p);
    stream.on('data', function (chunk) { hash.update(chunk); });
    stream.on('end', function () { resolve(hash.digest('hex')); });
    stream.on('error', reject);
  });
}

// ── 参数解析 ────────────────────────────────────────
var argv = process.argv.slice(2);
var roots = [];
var maxSizeGB = 50;
var outPath = (process.env.PROJECT_DIR || '/share/Container/docker/services/nas-media') + '/dedup_report_' +
              new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + '.txt';

for (var i = 0; i < argv.length; i++) {
  if ((argv[i] === '--root' || argv[i] === '--roots') && argv[i + 1]) {
    argv[i + 1].split(',').forEach(function (x) { if (x.trim()) roots.push(x.trim()); });
  }
  if (argv[i] === '--max-size' && argv[i + 1]) maxSizeGB = parseFloat(argv[i + 1]) || 50;
  if (argv[i] === '--out' && argv[i + 1]) outPath = argv[i + 1];
}
var maxSizeBytes = maxSizeGB * 1024 * 1024 * 1024;

if (!roots.length) {
  var db0 = new Database(DB_PATH, { readonly: true });
  var br = db0.prepare("SELECT path FROM browser_roots WHERE enabled = 1 AND source = 'nas'").all();
  db0.close();
  roots = br.map(function (r) { return r.path; });
  if (!roots.length) roots = ['/share/Person'];
}
roots = roots.map(resolveReal).filter(function (r) { return fs.existsSync(r); });

console.log('扫描根目录 (' + roots.length + ' 个):');
roots.forEach(function (r) { console.log('  ' + r); });
console.log('超过 ' + maxSizeGB + 'GB 的文件将跳过(不算哈希, 太慢)');
console.log('');

// ── 第一步: 遍历磁盘, 按大小分组 ─────────────────────
console.log('正在扫描磁盘...');
var all = [];
roots.forEach(function (r) { walk(r, 0, all); });
console.log('磁盘视频文件总数: ' + all.length);

var oversized = all.filter(function (f) { return f.size > maxSizeBytes; });
if (oversized.length) console.log('超过大小上限跳过: ' + oversized.length + ' 个');

var candidates = all.filter(function (f) { return f.size > 0 && f.size <= maxSizeBytes; });

var bySize = {};
candidates.forEach(function (f) { (bySize[f.size] = bySize[f.size] || []).push(f); });

var sizeGroups = Object.keys(bySize).filter(function (s) { return bySize[s].length > 1; });
var needHash = sizeGroups.reduce(function (a, s) { return a + bySize[s].length; }, 0);

console.log('大小唯一(不可能重复, 跳过哈希): ' + (candidates.length - needHash) + ' 个');
console.log('大小相同, 需要算哈希核实: ' + needHash + ' 个 (共 ' + sizeGroups.length + ' 组)');
console.log('');

if (!needHash) {
  console.log('没有大小相同的文件, 不存在内容重复, 结束。');
  process.exit(0);
}

var totalBytesToHash = 0;
sizeGroups.forEach(function (s) { totalBytesToHash += Number(s) * bySize[s].length; });
console.log('预计要读取 ' + (totalBytesToHash / 1073741824).toFixed(1) + 'GB 数据来算哈希');
console.log('开始计算哈希(这一步会花较长时间, 请耐心等待)...');
console.log('');

// ── 第二步: 对候选组算哈希, 按哈希再分组 ─────────────
(async function () {
  var byHash = {};
  var done = 0, errCount = 0;
  var startTs = Date.now();

  for (var s = 0; s < sizeGroups.length; s++) {
    var group = bySize[sizeGroups[s]];
    for (var g = 0; g < group.length; g++) {
      var f = group[g];
      try {
        var h = await md5OfFile(f.path);
        (byHash[h] = byHash[h] || []).push(f);
      } catch (e) {
        errCount++;
        console.log('  读取失败: ' + f.path + '  (' + e.message + ')');
      }
      done++;
      if (done % 50 === 0 || done === needHash) {
        var elapsed = (Date.now() - startTs) / 1000;
        var rate = done / elapsed;
        var eta = rate > 0 ? Math.round((needHash - done) / rate) : 0;
        console.log('  进度 ' + done + '/' + needHash + '  (' + elapsed.toFixed(0) + 's 已用, 预计还剩 ' + eta + 's)');
      }
    }
  }

  var dupGroups = Object.keys(byHash).filter(function (h) { return byHash[h].length > 1; });

  console.log('');
  console.log('=== 结果 ===');
  console.log('内容重复的组数: ' + dupGroups.length);
  var totalDupFiles = dupGroups.reduce(function (a, h) { return a + byHash[h].length; }, 0);
  var wastedBytes = 0;
  dupGroups.forEach(function (h) {
    var files = byHash[h];
    wastedBytes += files[0].size * (files.length - 1);
  });
  console.log('涉及文件总数: ' + totalDupFiles);
  console.log('可释放空间(保留每组一份): ' + (wastedBytes / 1073741824).toFixed(2) + 'GB');
  if (errCount) console.log('读取失败: ' + errCount + ' 个(见上方日志)');

  var lines = [];
  lines.push('视频内容去重报告  ' + new Date().toISOString());
  lines.push('扫描根目录: ' + roots.join('  |  '));
  lines.push('磁盘视频总数: ' + all.length);
  lines.push('重复组数: ' + dupGroups.length + '   涉及文件: ' + totalDupFiles +
             '   可释放空间: ' + (wastedBytes / 1073741824).toFixed(2) + 'GB');
  lines.push('='.repeat(70));
  lines.push('');

  dupGroups.sort(function (a, b) { return byHash[b][0].size - byHash[a][0].size; });
  dupGroups.forEach(function (h, idx) {
    var files = byHash[h];
    lines.push('[组 ' + (idx + 1) + ']  内容MD5: ' + h + '   每份大小: ' +
               (files[0].size / 1048576).toFixed(1) + 'MB   共 ' + files.length + ' 份');
    files.forEach(function (f) { lines.push('  ' + f.path); });
    lines.push('');
  });

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  console.log('');
  console.log('详细报告已写入: ' + outPath);
})();
