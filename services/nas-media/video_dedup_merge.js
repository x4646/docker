// video_dedup_merge.js — 按去重报告处理重复视频: 保留一份, 合并评分, 移走冗余
//
// 输入: video_content_dedup.js 生成的报告文件
// 保留规则: 每组里目录层级最浅的优先; 层级相同比完整路径长度; 再相同按字母序
//           (规则确定, 每次跑结果一致)
// 合并规则: 评分取各份里最高的; 收藏只要任一份收藏过就算收藏; 标签取并集
// 冗余处理: 文件【移动】到各自根目录下的 删除/ 文件夹(镜像原路径层级), 不是直接删,
//           数据库记录/评分/标签/缩略图照常清理
//
// 移动示例:
//   /share/Media/deep/nested/x.mp4  ->  /share/Media/删除/deep/nested/x.mp4
//
// 安全措施:
//   - 只处理 media_type='video' 的记录
//   - 默认只预览不执行, 加 --go 才真正动手
//   - 操作清单写入日志文件, 万一出问题可追溯; 文件都在 删除/ 里, 随时能搬回来
//
// 用法:
//   node video_dedup_merge.js <报告文件路径>          预览
//   node video_dedup_merge.js <报告文件路径> --go     执行

'use strict';

var fs     = require('fs');
var crypto = require('crypto');
var Database = require('better-sqlite3');

var DB_PATH    = '/share/ssd001/nas.db';
var VTHUMB_DIR = (process.env.PROJECT_DIR || '/share/Container/docker/services/nas-media') + '/vthumbs';

var argv = process.argv.slice(2);
var GO = argv.indexOf('--go') >= 0;
var reportPath = argv.filter(function (a) { return a.indexOf('--') !== 0; })[0];

if (!reportPath || !fs.existsSync(reportPath)) {
  console.log('用法: node video_dedup_merge.js <报告文件路径> [--go]');
  console.log('');
  console.log('可用的报告文件:');
  try {
    var projectDir = process.env.PROJECT_DIR || '/share/Container/docker/services/nas-media';
    fs.readdirSync(projectDir)
      .filter(function (f) { return /^dedup_report_.*\.txt$/.test(f); })
      .forEach(function (f) { console.log('  ' + projectDir + '/' + f); });
  } catch (e) {}
  process.exit(1);
}

// ── 解析报告 ────────────────────────────────────────
// 格式: [组 N]  内容MD5: xxx   每份大小: N MB   共 N 份
//         /path/to/file1
//         /path/to/file2
var lines = fs.readFileSync(reportPath, 'utf8').split('\n');
var groups = [];
var cur = null;
lines.forEach(function (line) {
  var m = line.match(/^\[组 \d+\]\s+内容MD5:\s*([0-9a-f]{32})/);
  if (m) {
    cur = { hash: m[1], files: [] };
    groups.push(cur);
    return;
  }
  if (cur && /^\s{2}\S/.test(line)) {
    var p = line.trim();
    if (p) cur.files.push(p);
  } else if (cur && !line.trim()) {
    cur = null;   // 空行结束当前组
  }
});
groups = groups.filter(function (g) { return g.files.length > 1; });

console.log('报告文件: ' + reportPath);
console.log('解析到重复组: ' + groups.length + ' 组, 涉及文件 ' +
            groups.reduce(function (a, g) { return a + g.files.length; }, 0) + ' 个');
console.log('');

if (!groups.length) { console.log('没有需要处理的重复组。'); process.exit(0); }

// ── 保留规则: 目录层级最浅 -> 路径最短 -> 字母序 ──────
function pickKeeper(files) {
  return files.slice().sort(function (a, b) {
    var da = a.split('/').length, db2 = b.split('/').length;
    if (da !== db2) return da - db2;
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : 1;
  })[0];
}

// 报告里是真实路径(/share/CACHEDEVn_DATA/...), 数据库里是入库路径(/share/Xxx/...)
function toDbPath(realPath) {
  var m = String(realPath).match(/^\/share\/CACHEDEV\d+_DATA(\/.*)$/);
  return m ? ('/share' + m[1]) : String(realPath);
}

function md5OfFile(p) {
  return new Promise(function (resolve, reject) {
    var hash = crypto.createHash('md5');
    var st = fs.createReadStream(p);
    st.on('data', function (c) { hash.update(c); });
    st.on('end', function () { resolve(hash.digest('hex')); });
    st.on('error', reject);
  });
}

// 冗余文件的去处: 各自根目录下的 删除/ 文件夹, 镜像原来的中间路径层级
//   /share/CACHEDEV2_DATA/Media/deep/x.mp4 -> /share/CACHEDEV2_DATA/Media/删除/deep/x.mp4
// 根目录 = /share/CACHEDEVn_DATA/<共享名>, 之后的层级原样保留
function trashPathOf(realPath) {
  var m = String(realPath).match(/^(\/share\/CACHEDEV\d+_DATA\/[^\/]+)(\/.*)$/);
  if (!m) return null;
  return m[1] + '/\u5220\u9664' + m[2];   // \u5220\u9664 = 删除
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); return true; }
  catch (e) { return false; }
}

// 移动文件; 同分区用 rename(瞬间完成), 跨分区退回复制+删除
function moveFile(src, dst) {
  var dir = dst.slice(0, dst.lastIndexOf('/'));
  if (!ensureDir(dir)) throw new Error('无法创建目标目录: ' + dir);
  // 目标已存在同名文件时加后缀, 避免互相覆盖
  var finalDst = dst;
  if (fs.existsSync(finalDst)) {
    var dot = dst.lastIndexOf('.');
    var base = dot > 0 ? dst.slice(0, dot) : dst;
    var ext  = dot > 0 ? dst.slice(dot) : '';
    finalDst = base + '_' + Date.now() + ext;
  }
  try {
    fs.renameSync(src, finalDst);
  } catch (e) {
    if (e.code === 'EXDEV') {   // 跨分区, rename 用不了
      fs.copyFileSync(src, finalDst);
      fs.unlinkSync(src);
    } else throw e;
  }
  return finalDst;
}

var db = new Database(DB_PATH, GO ? {} : { readonly: true });

(async function () {
  var plan = [];        // {keeper, keeperDb, drops:[{real, dbPath, row}], mergeMark}
  var skipped = 0;

  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    // 文件都还在吗(报告是刚生成的, 不再重算哈希核对, 只确认文件存在)
    var alive = g.files.filter(function (f) { return fs.existsSync(f); });
    if (alive.length < 2) { skipped++; continue; }   // 已经被处理过 / 文件没了, 不用再管

    var keeper = pickKeeper(alive);
    var drops = alive.filter(function (f) { return f !== keeper; });

    // ③ 查数据库记录(只认 video)
    var keeperDb = toDbPath(keeper);
    var keeperRow = db.prepare("SELECT id, md5, path FROM photos WHERE path = ? AND media_type = 'video'").get(keeperDb);

    var dropRows = [];
    drops.forEach(function (d) {
      var dbP = toDbPath(d);
      var row = db.prepare("SELECT id, md5, path FROM photos WHERE path = ? AND media_type = 'video'").get(dbP);
      dropRows.push({ real: d, dbPath: dbP, row: row || null });
    });

    plan.push({ groupNo: i + 1, hash: g.hash, keeper: keeper, keeperDb: keeperDb,
                keeperRow: keeperRow || null, drops: dropRows });
  }

  // ── 汇总预览 ──────────────────────────────────────
  var totalDrop = plan.reduce(function (a, p) { return a + p.drops.length; }, 0);
  var freeBytes = 0;
  plan.forEach(function (p) {
    p.drops.forEach(function (d) {
      try { freeBytes += fs.statSync(d.real).size; } catch (e) {}
    });
  });

  console.log('');
  console.log('=== 处理计划 ===');
  console.log('有效重复组      : ' + plan.length + (skipped ? ('  (跳过 ' + skipped + ' 组)') : ''));
  console.log('将移走文件      : ' + totalDrop + ' 个  (移到各根目录下的 删除/ 文件夹)');
  console.log('涉及空间        : ' + (freeBytes / 1073741824).toFixed(2) + 'GB');
  console.log('');
  console.log('=== 前 10 组明细 ===');
  plan.slice(0, 10).forEach(function (p) {
    console.log('[组 ' + p.groupNo + ']');
    console.log('  保留: ' + p.keeper + (p.keeperRow ? '' : '   (注意: 数据库里没有这条记录)'));
    p.drops.forEach(function (d) {
      console.log('  移走: ' + d.real + (d.row ? '' : '   (数据库里没有对应记录, 只移文件)'));
      var previewDst = trashPathOf(d.real);
      if (previewDst) console.log('     -> ' + previewDst);
    });
  });

  if (!GO) {
    console.log('');
    console.log('以上仅为预览, 未做任何改动。确认无误后加 --go 执行。');
    db.close();
    process.exit(0);
  }

  // ── 执行 ──────────────────────────────────────────
  var logPath = (process.env.PROJECT_DIR || '/share/Container/docker/services/nas-media') + '/dedup_merge_log_' + Date.now() + '.txt';
  var logLines = ['视频去重合并日志  ' + new Date().toISOString(), '报告来源: ' + reportPath,
                  '冗余文件移动到各根目录下的 删除/ 文件夹(未真正删除, 可随时搬回)', ''];

  var movedFile = 0, delRow = 0, mergedMark = 0, mergedTag = 0, delThumb = 0, errN = 0;

  plan.forEach(function (p) {
    logLines.push('[组 ' + p.groupNo + ']  保留: ' + p.keeper);

    // 先合并评分/收藏/标签到保留的那份(在删记录之前做)
    if (p.keeperRow) {
      var keeperMd5 = p.keeperRow.md5;
      var bestRating = 0, anyFav = 0;
      try {
        var km = db.prepare('SELECT favorite, rating FROM photo_marks WHERE md5 = ?').get(keeperMd5);
        if (km) { bestRating = km.rating || 0; anyFav = km.favorite || 0; }
      } catch (e) {}

      p.drops.forEach(function (d) {
        if (!d.row) return;
        try {
          var dm = db.prepare('SELECT favorite, rating FROM photo_marks WHERE md5 = ?').get(d.row.md5);
          if (dm) {
            if ((dm.rating || 0) > bestRating) bestRating = dm.rating || 0;   // 评分取最高
            if (dm.favorite) anyFav = 1;                                       // 收藏任一为真
          }
          // 标签并到保留的那份(同名标签靠 INSERT OR IGNORE 天然去重需要唯一索引, 这里手工查重)
          var tags = db.prepare('SELECT tag, score, source FROM photo_tags WHERE md5 = ?').all(d.row.md5);
          tags.forEach(function (t) {
            var exists = db.prepare('SELECT 1 FROM photo_tags WHERE md5 = ? AND tag = ?').get(keeperMd5, t.tag);
            if (!exists) {
              db.prepare('INSERT INTO photo_tags (md5, tag, score, source) VALUES (?,?,?,?)')
                .run(keeperMd5, t.tag, t.score, t.source);
              mergedTag++;
            }
          });
        } catch (e) { }
      });

      if (bestRating > 0 || anyFav) {
        try {
          db.prepare("INSERT INTO photo_marks (md5, favorite, rating, updated_at) VALUES (?,?,?,strftime('%s','now')) " +
                     "ON CONFLICT(md5) DO UPDATE SET favorite=excluded.favorite, rating=excluded.rating, updated_at=excluded.updated_at")
            .run(keeperMd5, anyFav, bestRating);
          mergedMark++;
          logLines.push('    合并评分: rating=' + bestRating + ' favorite=' + anyFav);
        } catch (e) { logLines.push('    合并评分失败: ' + e.message); }
      }
    }

    // 再把冗余的文件移走 + 删记录 + 清缩略图
    p.drops.forEach(function (d) {
      var dst = trashPathOf(d.real);
      if (!dst) {
        errN++;
        logLines.push('    路径格式无法识别, 跳过: ' + d.real);
        return;
      }
      var finalDst;
      try {
        finalDst = moveFile(d.real, dst);
        movedFile++;
        logLines.push('    已移动: ' + d.real);
        logLines.push('        -> ' + finalDst);
      } catch (e) {
        errN++;
        logLines.push('    移动失败: ' + d.real + '  ' + e.message);
        return;   // 文件没移走, 记录就别删了, 保持一致
      }

      if (d.row) {
        try {
          db.prepare('DELETE FROM photos WHERE id = ?').run(d.row.id);
          delRow++;
          db.prepare('DELETE FROM photo_marks WHERE md5 = ?').run(d.row.md5);
          db.prepare('DELETE FROM photo_tags WHERE md5 = ?').run(d.row.md5);
          // 清缩略图
          var dir = VTHUMB_DIR + '/' + d.row.md5.slice(0, 2);
          if (fs.existsSync(dir)) {
            fs.readdirSync(dir).forEach(function (f) {
              if (f.indexOf(d.row.md5 + '_') === 0) {
                try { fs.unlinkSync(dir + '/' + f); delThumb++; } catch (e) {}
              }
            });
          }
        } catch (e) {
          errN++;
          logLines.push('    删记录失败: ' + d.dbPath + '  ' + e.message);
        }
      }
    });
    logLines.push('');
  });

  fs.writeFileSync(logPath, logLines.join('\n'), 'utf8');

  console.log('');
  console.log('=== 完成 ===');
  console.log('移动文件      : ' + movedFile + '  (已移到各根目录下的 删除/ 文件夹)');
  console.log('删除数据库记录: ' + delRow);
  console.log('合并评分收藏  : ' + mergedMark + ' 组');
  console.log('合并标签      : ' + mergedTag + ' 条');
  console.log('清理缩略图    : ' + delThumb + ' 张');
  if (errN) console.log('出错          : ' + errN + ' 处(详见日志)');
  console.log('');
  console.log('操作日志: ' + logPath);
  console.log('');
  console.log('文件都还在 删除/ 文件夹里, 确认无误后再手动清空那些文件夹即可。');

  db.close();
})();
