/*
 * video-playcheck.js — 后台批量检查"视频能不能在浏览器里在线播放"。
 * 页面(nasmgr向导)点开始, 服务端后台跑, 关页面没事; 结果逐条存进photos表(play_check/play_reason),
 * 进度=已检查数/总数, 从数据库算, 所以就算nas-media重启(开发改代码经常重启), 没跑完的也会自动接着跑。
 *
 * 判断依据(ffprobe读真正会被播放器加载的那个文件——有转换副本用副本, 没有就是原文件):
 *   -1 不能播: 文件不在/读不出时长(损坏)/容器浏览器不认(avi/flv/wmv/ts/rmvb...)/视频编码浏览器不认/
 *              H.264 是 10位或 4:2:2/4:4:4(浏览器都不解)
 *    2 可能有问题: HEVC(看系统解码器)/mkv(Chrome能, Firefox不能)/10位VP9·AV1/音频编码浏览器不认(会没声音)/
 *              超大分辨率或超高码率
 *    1 可以播
 * 这是"预测", 最终还是以浏览器实际播放为准(播放器遇到真的解码失败会自己记住)。
 * deep=true 时额外解码开头2秒, 能发现"能读出信息但解不出画面"的坏文件, 慢很多。
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

module.exports = function (app, getDb) {
  const CONCURRENCY = 4;
  const OK_CONTAINER = ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'ogg'];
  const OK_AUDIO = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];

  const _c = {};
  function toRealPath(p) {
    if (p.indexOf('/share/CACHEDEV') === 0) return p;
    const m = p.match(/^\/share\/([^\/]+)(\/.*)?$/);
    if (!m) return p;
    if (!(m[1] in _c)) { _c[m[1]] = null; for (let i = 1; i <= 8; i++) { try { if (fs.existsSync('/share/CACHEDEV' + i + '_DATA/' + m[1])) { _c[m[1]] = 'CACHEDEV' + i + '_DATA'; break; } } catch (e) {} } }
    return _c[m[1]] ? '/share/' + _c[m[1]] + '/' + m[1] + (m[2] || '') : p;
  }
  // 播放器实际加载的文件: web_ready>0 且转换副本还在 -> 副本; 否则原文件
  function playablePath(row) {
    if (row.web_ready > 0) {
      const m = row.path.match(/^(\/share\/[^\/]+)(\/.*)?\/([^\/]+)\.[A-Za-z0-9]{1,5}$/);
      if (m) {
        const cp = toRealPath(m[1] + '/转换' + (m[2] || '') + '/' + m[3] + '_' + (row.web_ready === 2 ? '转码' : '换壳') + '.mp4');
        if (fs.existsSync(cp)) return cp;
      }
    }
    return toRealPath(row.path);
  }

  (function init() {
    const db = getDb();
    const cols = db.prepare('PRAGMA table_info(photos)').all().map((c) => c.name);
    if (cols.indexOf('play_check') < 0) { db.exec('ALTER TABLE photos ADD COLUMN play_check INTEGER NOT NULL DEFAULT 0'); db.exec('CREATE INDEX IF NOT EXISTS idx_photos_play_check ON photos(play_check)'); }
    if (cols.indexOf('play_reason') < 0) db.exec('ALTER TABLE photos ADD COLUMN play_reason TEXT');
    if (cols.indexOf('play_checked_at') < 0) db.exec('ALTER TABLE photos ADD COLUMN play_checked_at INTEGER');
    db.exec('CREATE TABLE IF NOT EXISTS video_wizard_state (k TEXT PRIMARY KEY, v TEXT)');
  })();
  const getState = (k) => { try { const r = getDb().prepare('SELECT v FROM video_wizard_state WHERE k=?').get(k); return r ? JSON.parse(r.v) : null; } catch (e) { return null; } };
  const setState = (k, v) => getDb().prepare('INSERT INTO video_wizard_state (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, JSON.stringify(v));

  function probe(file) {
    return new Promise((resolve) => {
      execFile('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
        { timeout: 90000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) return resolve({ error: String(stderr || err.message).split('\n').filter(Boolean).slice(-1)[0] || err.message });
          try { resolve({ j: JSON.parse(stdout) }); } catch (e) { resolve({ error: '解析ffprobe输出失败' }); }
        });
    });
  }
  function deepDecode(file) {
    return new Promise((resolve) => {
      execFile('ffmpeg', ['-v', 'error', '-t', '2', '-i', file, '-map', '0:v:0', '-f', 'null', '-'],
        { timeout: 90000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => resolve(err ? String(stderr || err.message).split('\n').filter(Boolean)[0] : null));
    });
  }

  // 返回 {c: 1|2|-1, r: 原因}
  async function judge(row, deep) {
    const file = playablePath(row);
    let st; try { st = fs.statSync(file); } catch (e) { return { c: -1, r: '文件不在磁盘上' }; }
    if (!st.size) return { c: -1, r: '文件大小为0' };
    const p = await probe(file);
    if (p.error) return { c: -1, r: '文件损坏/读不出(' + p.error.slice(0, 60) + ')' };
    const j = p.j, streams = j.streams || [];
    const dur = parseFloat(j.format && j.format.duration);
    if (!(dur > 0)) return { c: -1, r: '读不出时长(文件可能不完整)' };
    const v = streams.find((s) => s.codec_type === 'video');
    if (!v) return { c: -1, r: '没有视频流' };

    const ext = path.extname(file).slice(1).toLowerCase();
    const fmt = String(j.format && j.format.format_name || '');
    const warns = [];
    if (OK_CONTAINER.indexOf(ext) < 0) {
      if (ext === 'mkv') warns.push('mkv容器(Chrome能播, Firefox不能)');
      else return { c: -1, r: '容器格式浏览器不支持(.' + ext + ')' };
    } else if (ext === 'mp4' && fmt.indexOf('mp4') < 0 && fmt.indexOf('mov') < 0) {
      warns.push('扩展名是mp4但实际容器是' + fmt);
    }

    const codec = String(v.codec_name || '').toLowerCase();
    const pix = String(v.pix_fmt || '');
    const prof = String(v.profile || '');
    if (codec === 'h264') {
      if (/10|422|444/.test(pix) || /High 10|High 4:2:2|High 4:4:4|Hi422|Hi444/i.test(prof)) return { c: -1, r: 'H.264 ' + (prof || pix) + '(10位/非4:2:0, 浏览器不解)' };
    } else if (codec === 'vp9' || codec === 'av1') {
      if (/10|12|422|444/.test(pix)) warns.push(codec.toUpperCase() + ' ' + pix + '(10位以上, 很多浏览器不支持)');
    } else if (codec === 'hevc' || codec === 'h265') {
      warns.push('HEVC(取决于系统解码器/浏览器)');
    } else if (['vp8', 'theora'].indexOf(codec) < 0) {
      return { c: -1, r: '视频编码浏览器不支持(' + codec + ')' };
    }

    const audios = streams.filter((s) => s.codec_type === 'audio');
    if (audios.length && !audios.some((a) => OK_AUDIO.indexOf(String(a.codec_name || '').toLowerCase()) >= 0)) {
      warns.push('音频编码浏览器不认(' + audios.map((a) => a.codec_name).join('/') + '), 会没声音');
    }
    const w = parseInt(v.width, 10) || 0, h = parseInt(v.height, 10) || 0;
    if (w * h > 4096 * 2304) warns.push('分辨率过高(' + w + '×' + h + ')');
    const br = parseInt(j.format && j.format.bit_rate, 10) || 0;
    if (br > 60e6) warns.push('码率过高(' + (br / 1e6).toFixed(0) + 'Mbps)');

    if (deep) {
      const e = await deepDecode(file);
      if (e) return { c: -1, r: '开头解码失败(' + e.slice(0, 60) + ')' };
    }
    return warns.length ? { c: 2, r: warns.join('; ') } : { c: 1, r: null };
  }

  // ── 任务循环(进度存库, 重启后自动续) ──
  let task = { status: 'idle' };
  async function runLoop(opts) {
    const db = getDb();
    if (opts.scope === 'all') db.prepare("UPDATE photos SET play_check=0 WHERE media_type='video'").run();
    task = { status: 'running', scope: opts.scope, deep: !!opts.deep, startedAt: Date.now(), checkedThisRun: 0, currentPaths: [], stopRequested: false };
    setState('playcheck', { running: true, deep: !!opts.deep });
    const upd = db.prepare("UPDATE photos SET play_check=?, play_reason=?, play_checked_at=strftime('%s','now') WHERE id=?");
    const worker = async () => {
      for (;;) {
        if (task.stopRequested) return;
        // 每次取一小批未检查的(按id), 不一次把几万行读进内存; 各worker原子地"领"行靠改状态占位不现实, 所以分批+按id取模分工
        const row = queue.shift();
        if (!row) return;
        task.currentPaths.push(row.path);
        let res;
        try { res = await judge(row, opts.deep); } catch (e) { res = { c: -1, r: '检查出错: ' + e.message }; }
        try { upd.run(res.c, res.r, row.id); } catch (e) {}
        task.checkedThisRun++;
        task.currentPaths = task.currentPaths.filter((x) => x !== row.path);
      }
    };
    const queue = db.prepare("SELECT id, path, web_ready FROM photos WHERE media_type='video' AND play_check=0 ORDER BY id").all();
    task.queued = queue.length;
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    task.status = task.stopRequested ? 'stopped' : 'done';
    task.currentPaths = [];
    setState('playcheck', { running: false });
  }

  app.post('/api/video-playcheck/start', require('express').json(), (req, res) => {
    if (task.status === 'running') return res.status(400).json({ error: '已经在跑了' });
    const scope = req.body && req.body.scope === 'all' ? 'all' : 'unchecked';
    runLoop({ scope, deep: !!(req.body && req.body.deep) }).catch((e) => { task.status = 'error'; task.error = e.message; });
    res.json({ ok: true });
  });
  app.post('/api/video-playcheck/stop', (req, res) => { if (task.status === 'running') task.stopRequested = true; res.json({ ok: true }); });

  app.get('/api/video-playcheck/status', (req, res) => {
    try {
      const db = getDb();
      const c = db.prepare("SELECT COUNT(*) total, SUM(play_check=0) unchecked, SUM(play_check=1) ok, SUM(play_check=2) warn, SUM(play_check=-1) bad FROM photos WHERE media_type='video'").get();
      // 原因分布: 只保留原因里第一个括号之前的部分归类, 免得每条都不一样
      const rs = db.prepare("SELECT play_check k, play_reason r, COUNT(*) n FROM photos WHERE media_type='video' AND play_check IN (-1,2) GROUP BY play_check, play_reason ORDER BY n DESC LIMIT 400").all();
      const agg = {};
      for (const x of rs) {
        const key = (x.k === -1 ? '不能播｜' : '可能有问题｜') + String(x.r || '').replace(/\(.*?\)/g, '').replace(/\d+×\d+|\d+Mbps/g, '').trim();
        agg[key] = (agg[key] || 0) + x.n;
      }
      const reasons = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => ({ reason: k, n }));
      res.json({ task: Object.assign({}, task, { stopRequested: undefined }), counts: c, reasons });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/video-playcheck/list', (req, res) => {
    try {
      const cls = req.query.class === 'warn' ? 2 : -1;
      const limit = Math.min(20000, Math.max(1, parseInt(req.query.limit || '500', 10) || 500));
      const rows = getDb().prepare("SELECT path, play_reason reason, size FROM photos WHERE media_type='video' AND play_check=? ORDER BY play_reason, path LIMIT ?").all(cls, limit);
      res.json({ items: rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 把"不能播"的一类(默认 H.264 10位/4:4:4)排进PC端GPU转码队列(VconvAgent.ps1) ──
  // video-conv.js 的 classify: 浏览器认的编码+容器一律算'ok'不排队(H.264 10位也被算成ok, 因为它只看编码名)。
  // 转码成功时它会把 dts_bad 重置成 0(见video-conv.js的done处理), 而 dts_bad=1 会被强制归到 transcode,
  // 所以借这个现成机制: 先把这批标成 dts_bad=1, 再调它的 /api/vconv/priority 入队。转码完成后 web_ready=2。
  // 注意: 队列在video-conv.js内存里, nas-media一重启就清空——这里入队是幂等的, 重启后再点一次即可
  // (只会重新排还没转完的)。
  const http = require('http');
  function callLocal(method, p, body) {
    return new Promise((resolve) => {
      const data = body ? JSON.stringify(body) : null;
      const req = http.request({ hostname: 'localhost', port: 3050, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (r) => {
        let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ error: d.slice(0, 100) }); } });
      });
      req.on('error', (e) => resolve({ error: e.message }));
      if (data) req.write(data);
      req.end();
    });
  }
  const LIKE_DEFAULT = 'H.264%';
  // 规则(2026-09-30): 超过6GB的视频不转码、保留源文件(只能用PotPlayer看)
  const MAX_TRANSCODE_BYTES = 6e9;
  // 规则(2026-09-30): 只自动转 Person 下的视频
  const PERSON_LIKE = '/share/Person/%';
  app.post('/api/video-playcheck/enqueue-transcode', require('express').json(), async (req, res) => {
    try {
      const like = String((req.body && req.body.reasonLike) || LIKE_DEFAULT);
      const db = getDb();
      // 超过6GB的: 撤销之前借用的 dts_bad=1 标记(转码不排它们了), 不入队
      const undone = db.prepare("UPDATE photos SET dts_bad=0 WHERE media_type='video' AND play_reason LIKE ? AND web_ready<2 AND size>? AND dts_bad=1").run(like, MAX_TRANSCODE_BYTES).changes;
      // 规则(2026-09-30): 自动排队只转 /share/Person 下的; Media 等其它目录不自动转, 要转由用户手动添加。
      // 撤销之前借用的 dts_bad=1 标记(它们不入队)
      const notPerson = db.prepare("UPDATE photos SET dts_bad=0 WHERE media_type='video' AND play_reason LIKE ? AND web_ready<2 AND path NOT LIKE ? AND dts_bad=1").run(like, PERSON_LIKE).changes;
      const rows = db.prepare("SELECT id, md5 FROM photos WHERE media_type='video' AND play_check=-1 AND play_reason LIKE ? AND web_ready<2 AND pending_delete=0 AND size<=? AND path LIKE ?").all(like, MAX_TRANSCODE_BYTES, PERSON_LIKE);
      db.transaction(() => { for (const r of rows) db.prepare('UPDATE photos SET dts_bad=1 WHERE id=?').run(r.id); })();
      let queued = 0, already = 0, failed = 0; const errs = {};
      for (const r of rows) {
        const x = await callLocal('POST', '/api/vconv/priority', { md5: r.md5 });
        if (x && x.ok) { x.alreadyQueued ? already++ : queued++; } else { failed++; const k = (x && x.error) || '未知'; errs[k] = (errs[k] || 0) + 1; }
      }
      res.json({ ok: true, total: rows.length, queued, alreadyQueued: already, failed, errors: errs, bigKept: undone, notPersonSkipped: notPerson });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.get('/api/video-playcheck/transcode-status', async (req, res) => {
    try {
      const like = String(req.query.reasonLike || LIKE_DEFAULT);
      const db = getDb();
      const c = db.prepare("SELECT COUNT(*) total, SUM(web_ready>=2) converted, SUM(web_ready<2 AND size<=?) waiting, COALESCE(SUM(CASE WHEN web_ready<2 AND size<=? THEN size END),0) waitingBytes, SUM(web_ready<2 AND size>?) bigKept, COALESCE(SUM(CASE WHEN web_ready<2 AND size>? THEN size END),0) bigKeptBytes FROM photos WHERE media_type='video' AND play_reason LIKE ? AND pending_delete=0 AND path LIKE ?").get(MAX_TRANSCODE_BYTES, MAX_TRANSCODE_BYTES, MAX_TRANSCODE_BYTES, MAX_TRANSCODE_BYTES, like, PERSON_LIKE);
      const md5s = new Set(db.prepare("SELECT md5 FROM photos WHERE media_type='video' AND play_reason LIKE ? AND path LIKE ?").all(like, PERSON_LIKE).map((r) => r.md5));
      const q = await callLocal('GET', '/api/vconv/queue');
      const st = { queued: 0, processing: 0, done: 0, failed: 0 };
      let current = null;
      for (const it of (q.items || [])) { if (md5s.has(it.md5)) { st[it.status] = (st[it.status] || 0) + 1; if (it.status === 'processing') current = it.path; } }
      const vs = await callLocal('GET', '/api/vconv/status');
      res.json({ counts: c, queue: st, current, agentAlive: !!(q.agentAlive), vconv: { running: vs.running, transTotal: vs.transTotal, transDone: vs.transDone },
        startCmd: 'powershell -NoProfile -ExecutionPolicy Bypass -File X:\\docker\\pc-scripts\\VconvAgent.ps1' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // 转码完成后, 把这批重新检查一遍(检查会改用转码副本)
  app.post('/api/video-playcheck/recheck-converted', async (req, res) => {
    try {
      const like = String((req.body && req.body.reasonLike) || LIKE_DEFAULT);
      const n = getDb().prepare("UPDATE photos SET play_check=0 WHERE media_type='video' AND play_reason LIKE ? AND web_ready>=2").run(like).changes;
      if (n && task.status !== 'running') runLoop({ scope: 'unchecked', deep: false }).catch((e) => { task.status = 'error'; task.error = e.message; });
      res.json({ ok: true, reset: n });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 服务重启时, 上次没跑完的自动接着跑(已检查的不重复)
  setTimeout(() => {
    const st = getState('playcheck');
    if (st && st.running && task.status === 'idle') {
      console.log('[playcheck] 检测到上次没跑完, 自动继续');
      runLoop({ scope: 'unchecked', deep: !!st.deep }).catch((e) => { task.status = 'error'; task.error = e.message; });
    }
  }, 8000).unref();

  console.log('[playcheck] 初始化完成');
};
