/*
 * video-migrate-worker-thread.js — "换壳去重"体检: 只读扫描+比对, 不改动任何文件。
 * 对每个已经换壳完成(web_ready=1)的视频: 用ffprobe分别读原文件和换壳文件的音视频/字幕轨道数、
 * 时长, 比对是否一致; 顺手把换壳文件的md5算出来存进结果表(以后真要执行替换时直接复用, 不用重算)。
 * 结果写进video_migrate_check表(不是丢内存里), 页面关了/程序重启结果还在, 不用重新跑一遍。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { parentPort, workerData } = require('worker_threads');

let BetterSqlite3;
try { BetterSqlite3 = require('better-sqlite3'); } catch (e) {}
const db = new BetterSqlite3('/share/ssd001/nas.db');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

function post(msg) { parentPort.postMessage(msg); }

// ── 路径互转, 跟video-conv.js的toRealPath/convBase保持完全一致的规则 ──
var _cachedevCache = {};
function toRealPath(dbPath) {
  if (dbPath.indexOf('/share/CACHEDEV') === 0) return dbPath;
  var m = dbPath.match(/^\/share\/([^\/]+)(\/.*)?$/);
  if (!m) return dbPath;
  var shareName = m[1], rest = m[2] || '';
  if (Object.prototype.hasOwnProperty.call(_cachedevCache, shareName)) {
    var cached = _cachedevCache[shareName];
    return cached ? ('/share/' + cached + '/' + shareName + rest) : dbPath;
  }
  for (var i = 1; i <= 8; i++) {
    var cand = '/share/CACHEDEV' + i + '_DATA/' + shareName + rest;
    try { if (fs.existsSync(cand)) { _cachedevCache[shareName] = 'CACHEDEV' + i + '_DATA'; return cand; } } catch (e) {}
  }
  _cachedevCache[shareName] = null;
  return dbPath;
}
function convBase(dbPath, suffix) {
  var m = dbPath.match(/^(\/share\/[^\/]+)(\/.*)?\/([^\/]+)\.[A-Za-z0-9]{1,5}$/);
  if (!m) return null;
  var root = m[1], mid = m[2] || '', name = m[3];
  return root + '/转换' + mid + '/' + name + '_' + suffix + '.mp4';
}

function md5File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function probe(filePath) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath], { maxBuffer: 20 * 1024 * 1024 }).toString();
    const j = JSON.parse(out);
    const streams = j.streams || [];
    return {
      duration: parseFloat((j.format || {}).duration) || 0,
      video: streams.filter(s => s.codec_type === 'video').length,
      audio: streams.filter(s => s.codec_type === 'audio').length,
      subtitle: streams.filter(s => s.codec_type === 'subtitle').length
    };
  } catch (e) { return null; }
}

async function runCheck() {
  (function initSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS video_migrate_check (
        orig_path   TEXT PRIMARY KEY,
        orig_md5    TEXT,
        conv_path   TEXT,
        conv_md5    TEXT,
        status      TEXT,
        reason      TEXT,
        checked_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
    `);
  })();

  // 2026-09-25修复: 之前每次重跑(比如nas-media热重载重启)都是从头查全量6873条重新扫一遍,
  // 而这个体检本身就慢(ffprobe两次+md5哈希一遍换壳文件), 中途又特别容易被后续的部署重启打断,
  // 结果就是"总在处理前面这几千条, 永远够不到后面没查过的" ——加LEFT JOIN排除掉已经查过的
  // (不管之前结果是ok还是mismatch, 只要查过就跳过), 这样每次重跑都是接着上次的进度往后走,
  // 而不是白白重复劳动。想强制重新体检某个文件, 从video_migrate_check表里删掉那一行即可。
  const rows = db.prepare(
    "SELECT p.path, p.md5, p.size FROM photos p " +
    "LEFT JOIN video_migrate_check c ON c.orig_path = p.path " +
    "WHERE p.media_type='video' AND p.web_ready=1 AND c.orig_path IS NULL"
  ).all();
  const alreadyChecked = db.prepare("SELECT COUNT(*) c FROM video_migrate_check").get().c;
  const priorStats = db.prepare("SELECT status, COUNT(*) c FROM video_migrate_check GROUP BY status").all()
    .reduce((m, r) => { m[r.status] = r.c; return m; }, {});
  const total = rows.length + alreadyChecked;
  let done = alreadyChecked, ok = priorStats.ok || 0, mismatch = priorStats.mismatch || 0, skipped = 0;

  const upsert = db.prepare(
    'INSERT INTO video_migrate_check (orig_path, orig_md5, conv_path, conv_md5, status, reason, checked_at) VALUES (?,?,?,?,?,?,strftime(\'%s\',\'now\')) ' +
    'ON CONFLICT(orig_path) DO UPDATE SET orig_md5=excluded.orig_md5, conv_path=excluded.conv_path, conv_md5=excluded.conv_md5, status=excluded.status, reason=excluded.reason, checked_at=excluded.checked_at'
  );

  for (const r of rows) {
    // convBase要用入库风格的原始path算(跟video-conv.js存文件时的算法一致, 结果也是入库风格),
    // 算完再各自单独转真实磁盘路径——两个不能对调, 不然"/share/CACHEDEV4_DATA"会被误当成
    // "/share/xxx"这一段代入转换规则, 拼出来的转换路径整个是错的。
    const origReal = toRealPath(r.path);
    const convPath = toRealPath(convBase(r.path, '换壳') || '');
    done++;

    if (!convBase(r.path, '换壳') || !fs.existsSync(convPath) || !fs.existsSync(origReal)) {
      skipped++;
      if (done % 20 === 0 || done === total) post({ type: 'progress', task: { total, done, ok, mismatch, skipped, currentPath: r.path } });
      continue;
    }

    const pOrig = probe(origReal);
    const pConv = probe(convPath);
    let status = 'ok', reasons = [];
    if (!pOrig || !pConv) {
      status = 'mismatch'; reasons.push('ffprobe读取失败');
    } else {
      if (pConv.video !== pOrig.video) reasons.push(`视频轨道数不一致(原${pOrig.video}/换壳${pConv.video})`);
      if (pConv.audio !== pOrig.audio) reasons.push(`音频轨道数不一致(原${pOrig.audio}/换壳${pConv.audio})`);
      if (pConv.subtitle < pOrig.subtitle) reasons.push(`字幕轨道变少了(原${pOrig.subtitle}/换壳${pConv.subtitle})`);
      if (Math.abs(pOrig.duration - pConv.duration) > 2) reasons.push(`时长差异较大(原${pOrig.duration.toFixed(1)}s/换壳${pConv.duration.toFixed(1)}s)`);
      if (reasons.length) status = 'mismatch';
    }

    let convMd5 = null;
    try { convMd5 = await md5File(convPath); } catch (e) { reasons.push('换壳文件md5计算失败'); status = 'mismatch'; }

    upsert.run(r.path, r.md5, convPath, convMd5, status, reasons.join('; ') || null);
    if (status === 'ok') ok++; else mismatch++;

    // 换壳文件普遍是大文件(整段视频), 算md5这一步本身就慢, 进度上报间隔不能靠"跳过项"
    // 撑数量(那些几乎不耗时), 命中一个就报一次, 让页面看起来是"活的"而不是卡住没反应。
    post({ type: 'progress', task: { total, done, ok, mismatch, skipped, currentPath: r.path } });
  }
  return { total, done, ok, mismatch, skipped };
}

(async () => {
  try {
    const result = await runCheck();
    post({ type: 'done', result });
  } catch (e) {
    post({ type: 'error', message: e.message });
  }
})();
