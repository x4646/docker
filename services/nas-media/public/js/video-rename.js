/*
 * video-rename.js — 视频文件名清洗(去掉特殊字符/推广域名/emoji/括号), 页面 nasmgr ⑫ 操作。
 *
 * 规则(白名单): 保留 各国文字/数字/组合符号 和 空格 . - _ ; 其它一律变空格(括号、emoji、全角标点、@#&'!~ 等);
 *   先 NFKC 归一(全角->半角); 去掉 www.xxx.la@ 这类推广域名; 连续空格合并、首尾去掉(空格 . _ -);
 *   扩展名转小写; 主名不截断(超过120字才截断); 同目录撞名(不区分大小写)加 _2 _3。
 * 只处理 photos 里 media_type='video' 且没进回收站、不在 转换/ 目录里的记录(=只改视频, 不动目录名、不动照片)。
 *
 * 安全: 每个文件先在库里改路径(事务) -> 再改磁盘文件名 -> 失败则回退库; 成功后再改 转换/ 里的转码/换壳副本。
 *   每个成功的改名先落盘日志(旧路径\t新路径\t副本数), 可整批回滚。视频key是内容指纹, 改名不影响缩略图/标签/收藏。
 * 2026-09-30: 同一套规则也用于照片(type=photo): 改名时同步重算 photos.file_key(它是 md5(文件名_大小_mtime), 只在原值本来就匹配旧名公式时才改),
 *   否则下次扫描会把改名的照片当成"变了"重新处理。照片没有 转换/ 副本。可选 excludeBak 跳过 /share/BAK。
 * 接口: POST /api/video-rename/preview | start | stop | rollback (body 可带 type:'video'|'photo') ; GET /api/video-rename/status | plan.tsv | logs
 */
const fs = require('fs');
const path = require('path');

module.exports = function (app, getDb) {
  const express = require('express');
  const DIR = '/share/ssd001/video-rename';
  const MAX_BASE = 120;

  const _c = {};
  function toRealPath(p) {
    if (p.indexOf('/share/CACHEDEV') === 0) return p;
    const m = p.match(/^\/share\/([^\/]+)(\/.*)?$/);
    if (!m) return p;
    if (!(m[1] in _c)) { _c[m[1]] = null; for (let i = 1; i <= 8; i++) { try { if (fs.existsSync('/share/CACHEDEV' + i + '_DATA/' + m[1])) { _c[m[1]] = 'CACHEDEV' + i + '_DATA'; break; } } catch (e) {} } }
    return _c[m[1]] ? '/share/' + _c[m[1]] + '/' + m[1] + (m[2] || '') : p;
  }
  function ensureDir() { try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) {} }

  // ── 清洗规则 ──
  const PROMO = /(?:^|(?<=[\s_\-\[\(【（]))(?:www\.)?[a-z0-9][a-z0-9-]*\.(?:com|net|org|la|cc|me|xyz|top|vip|tv|info|club|site|life|live|fun|pw|co|io|app|one|pro|cn|jp|kr)(?:@|(?=[\s_\-\]\)】）]|$))/gi;
  function cleanBase(base) {
    let s = base.normalize('NFKC');
    s = s.replace(/[​-‏⁠﻿­]/g, '');
    s = s.replace(PROMO, ' ');
    s = s.replace(/[^\p{L}\p{N}\p{M} ._\-]/gu, ' ');
    s = s.replace(/\s+/g, ' ').replace(/^[ ._\-]+|[ ._\-]+$/g, '');
    if ([...s].length > MAX_BASE) s = [...s].slice(0, MAX_BASE).join('').replace(/[ ._\-]+$/, '');
    return s;
  }
  function splitName(name) {
    const m = name.match(/^(.*?)(\.[A-Za-z0-9]{1,5})?$/);
    return { base: m[1], ext: (m[2] || '') };
  }
  function cleanName(name, fallbackTag) {
    const { base, ext } = splitName(name);
    let b = cleanBase(base);
    if (!b) b = 'video_' + (fallbackTag || 'x');
    return b + ext.toLowerCase();
  }
  function convCopies(dbPath, newName) {
    const m = dbPath.match(/^(\/share\/[^\/]+)\/(.*?)([^\/]+)\.[^.\/]+$/);
    if (!m) return [];
    const nb = splitName(newName).base;
    return ['_转码.mp4', '_换壳.mp4'].map((s) => ({ from: m[1] + '/转换/' + m[2] + m[3] + s, to: m[1] + '/转换/' + m[2] + nb + s }));
  }

  // ── 预演 ──
  const plans = {};     // type -> {id, createdAt, type, items:[{id, oldPath, newPath}], collisions}
  let plan = null;      // 当前正在用的预演(最近一次生成的)
  function buildPlan(type, excludeBak) {
    const db = getDb();
    const rows = db.prepare("SELECT id, path, md5 FROM photos WHERE media_type=? AND (pending_delete IS NULL OR pending_delete=0) AND path LIKE '/share/%' AND path NOT LIKE '%/转换/%'").all(type).filter((r) => !(excludeBak && /^\/share\/bak\//i.test(r.path)));
    const byDir = {};
    for (const r of rows) {
      const i = r.path.lastIndexOf('/');
      (byDir[r.path.slice(0, i)] = byDir[r.path.slice(0, i)] || []).push({ id: r.id, dir: r.path.slice(0, i), name: r.path.slice(i + 1), key: (r.md5 || '').slice(0, 8) });
    }
    const items = []; let collisions = 0, skippedHidden = 0;
    for (const dir of Object.keys(byDir)) {
      if (/\/[.@][^\/]*/.test(dir)) { skippedHidden += byDir[dir].length; continue; }
      const list = byDir[dir];
      const taken = new Set(list.map((x) => x.name.toLowerCase()));
      // 目录里已有的其它文件名也要避开
      try { for (const f of fs.readdirSync(toRealPath(dir))) taken.add(f.toLowerCase()); } catch (e) {}
      list.sort((a, b) => (a.name < b.name ? -1 : 1));
      const wanted = {};
      for (const x of list) {
        let want = cleanName(x.name, x.key);
        if (want === x.name) continue;
        const lc = want.toLowerCase();
        // 只改大小写时(如 .MP4->.mp4): 目标就是自己, 不算撞名
        if (lc !== x.name.toLowerCase() && (taken.has(lc) || wanted[lc])) {
          const { base, ext } = splitName(want); let n = 2, cand;
          do { cand = base + '_' + n + ext; n++; } while (taken.has(cand.toLowerCase()) || wanted[cand.toLowerCase()]);
          want = cand; collisions++;
        }
        wanted[want.toLowerCase()] = 1;
        items.push({ id: x.id, oldPath: dir + '/' + x.name, newPath: dir + '/' + want });
      }
    }
    return { items, collisions, skippedHidden, scanned: rows.length };
  }

  app.post('/api/video-rename/preview', express.json(), (req, res) => {
    try {
      if (task && task.state === 'running') return res.status(409).json({ error: '正在执行改名, 先等它结束或停止' });
      const type = (req.body && req.body.type) === 'photo' ? 'photo' : 'video';
      const p = buildPlan(type, !!(req.body && req.body.excludeBak));
      ensureDir();
      const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      plan = plans[type] = { id, createdAt: Date.now(), type, items: p.items, collisions: p.collisions };
      try { fs.writeFileSync(DIR + '/plan_' + type + '_' + id + '.tsv', p.items.map((x) => x.oldPath + '\t' + x.newPath).join('\n') + '\n'); } catch (e) {}
      const bak = p.items.filter((x) => /^\/share\/bak\//i.test(x.oldPath)).length;
      const step = Math.max(1, Math.floor(p.items.length / 40));
      const samples = p.items.filter((x, i) => i % step === 0).slice(0, 40).map((x) => ({ old: x.oldPath.split('/').pop(), neu: x.newPath.split('/').pop(), dir: x.oldPath.split('/').slice(2, -1).join('/') }));
      res.json({ ok: true, type, planId: id, scanned: p.scanned, willChange: p.items.length, collisions: p.collisions, inBak: bak, skippedHidden: p.skippedHidden, samples });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/video-rename/plan.tsv', (req, res) => {
    const plan = plans[req.query.type === 'photo' ? 'photo' : 'video'];
    if (!plan) return res.status(404).send('还没有预演');
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="video-rename-plan.tsv"');
    res.send('﻿旧路径\t新路径\r\n' + plan.items.map((x) => x.oldPath + '\t' + x.newPath).join('\r\n') + '\r\n');
  });

  // ── 执行 ──
  let task = null;
  const fkey = (name, row) => require('crypto').createHash('md5').update(name + '_' + row.size + '_' + row.mtime).digest('hex');
  function renameOne(it, logFd) {
    const db = getDb();
    const oldReal = toRealPath(it.oldPath), newReal = toRealPath(it.newPath);
    if (!fs.existsSync(oldReal)) return { skip: '源文件不在了' };
    // 只改大小写: 不查"目标存在"(同一个文件)
    const caseOnly = it.oldPath.toLowerCase() === it.newPath.toLowerCase();
    if (!caseOnly && fs.existsSync(newReal)) return { skip: '目标名已存在' };
    const row = db.prepare('SELECT id, size, mtime, file_key FROM photos WHERE path=?').get(it.oldPath);
    if (!row) return { skip: '库里没有这条路径' };
    if (!caseOnly && db.prepare('SELECT 1 FROM photos WHERE path=?').get(it.newPath)) return { skip: '库里目标路径已有记录' };
    const oldKey = fkey(it.oldPath.split('/').pop(), row);
    const newFk = (row.file_key && row.file_key === oldKey) ? fkey(it.newPath.split('/').pop(), row) : row.file_key;
    db.prepare('UPDATE photos SET path=?, file_key=? WHERE id=?').run(it.newPath, newFk, row.id);
    try { fs.renameSync(oldReal, newReal); }
    catch (e) { db.prepare('UPDATE photos SET path=?, file_key=? WHERE id=?').run(it.oldPath, row.file_key, row.id); return { err: e.message }; }
    let copies = 0;
    for (const c of convCopies(it.oldPath, it.newPath.split('/').pop())) {
      try { const a = toRealPath(c.from), b = toRealPath(c.to); if (c.from !== c.to && fs.existsSync(a) && !fs.existsSync(b)) { fs.renameSync(a, b); copies++; } } catch (e) {}
    }
    fs.writeSync(logFd, it.oldPath + '\t' + it.newPath + '\t' + copies + '\n');
    return { ok: true, copies };
  }

  app.post('/api/video-rename/start', express.json(), (req, res) => {
    const type = (req.body && req.body.type) === 'photo' ? 'photo' : 'video';
    const plan = plans[type];
    if (!plan) return res.status(400).json({ error: '请先生成预演' });
    if (task && task.state === 'running') return res.status(409).json({ error: '已经在执行' });
    ensureDir();
    const limit = Math.max(0, parseInt((req.body && req.body.limit) || '0', 10) || 0);
    const items = (limit ? plan.items.slice(0, limit) : plan.items).slice();
    const logPath = DIR + '/log_' + (type === 'photo' ? 'photo_' : '') + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '.tsv';
    let fd; try { fd = fs.openSync(logPath, 'a'); } catch (e) { return res.status(500).json({ error: '无法创建日志: ' + e.message }); }
    task = { type, state: 'running', total: items.length, done: 0, skipped: 0, failed: 0, copies: 0, logPath, startedAt: Date.now(), errors: [], skipReasons: {}, stop: false };
    const _doing = new Set(items); plan.items = plan.items.filter((x) => !_doing.has(x));   // 已处理的从预演里去掉, 小批试跑后可直接接着跑剩余
    let i = 0;
    const step = () => {
      const t = task;
      const end = Math.min(items.length, i + 25);
      for (; i < end; i++) {
        if (t.stop) break;
        try {
          const r = renameOne(items[i], fd);
          if (r.ok) { t.done++; t.copies += r.copies; }
          else if (r.skip) { t.skipped++; t.skipReasons[r.skip] = (t.skipReasons[r.skip] || 0) + 1; }
          else { t.failed++; if (t.errors.length < 20) t.errors.push({ path: items[i].oldPath, error: r.err }); }
        } catch (e) { t.failed++; if (t.errors.length < 20) t.errors.push({ path: items[i].oldPath, error: e.message }); }
      }
      if (t.stop || i >= items.length) { try { fs.closeSync(fd); } catch (e) {} t.state = t.stop ? 'stopped' : 'done'; t.finishedAt = Date.now(); console.log('[video-rename] 结束:', t.state, t.done, '成功', t.skipped, '跳过', t.failed, '失败'); return; }
      setImmediate(step);
    };
    setImmediate(step);
    res.json({ ok: true, total: items.length, logPath });
  });

  app.post('/api/video-rename/stop', (req, res) => { if (task && task.state === 'running') task.stop = true; res.json({ ok: true }); });

  app.get('/api/video-rename/status', (req, res) => {
    let logs = [];
    try { logs = fs.readdirSync(DIR).filter((f) => /^log_/.test(f) && ((req.query.type === 'photo') === /^log_photo_/.test(f))).sort().reverse().slice(0, 10).map((f) => ({ file: f, lines: fs.readFileSync(DIR + '/' + f, 'utf8').split('\n').filter(Boolean).length })); } catch (e) {}
    const t = req.query.type === 'photo' ? 'photo' : 'video';
    res.json({ task, planReady: !!plans[t], planRemaining: plans[t] ? plans[t].items.length : 0, logs });
  });

  // 按日志回滚: {file: 'log_xxx.tsv'}
  app.post('/api/video-rename/rollback', express.json(), (req, res) => {
    try {
      if (task && task.state === 'running') return res.status(409).json({ error: '正在执行, 先停止' });
      const f = path.basename(String((req.body && req.body.file) || ''));
      if (!/^log_(photo_)?\d+\.tsv$/.test(f) || !fs.existsSync(DIR + '/' + f)) return res.status(400).json({ error: '日志文件无效' });
      const db = getDb();
      const rows = fs.readFileSync(DIR + '/' + f, 'utf8').split('\n').filter(Boolean).reverse();
      let ok = 0, skip = 0, err = 0;
      for (const line of rows) {
        const [oldP, newP] = line.split('\t');
        const a = toRealPath(newP), b = toRealPath(oldP);
        const caseOnly = oldP.toLowerCase() === newP.toLowerCase();
        if (!fs.existsSync(a) || (!caseOnly && fs.existsSync(b))) { skip++; continue; }
        try {
          fs.renameSync(a, b);
          const rw = db.prepare('SELECT id, size, mtime, file_key FROM photos WHERE path=?').get(newP);
          const back = (rw && rw.file_key && rw.file_key === fkey(newP.split('/').pop(), rw)) ? fkey(oldP.split('/').pop(), rw) : (rw && rw.file_key);
          db.prepare('UPDATE photos SET path=?, file_key=? WHERE path=?').run(oldP, back || null, newP);
          for (const c of convCopies(oldP, newP.split('/').pop())) { try { const x = toRealPath(c.to), y = toRealPath(c.from); if (c.from !== c.to && fs.existsSync(x) && !fs.existsSync(y)) fs.renameSync(x, y); } catch (e) {} }
          ok++;
        } catch (e) { err++; }
      }
      res.json({ ok: true, restored: ok, skipped: skip, failed: err });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('[video-rename] 初始化完成');
};
