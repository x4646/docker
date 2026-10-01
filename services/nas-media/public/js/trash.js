/*
 * trash.js — 统一回收站(照片+视频)。2026-10-01
 * 所有"删除"入口都只是 /api/photos/soft-delete 打 pending_delete=1 标记(不动文件); 这里提供回收站页面要的:
 *   GET  /api/trash/list?type=all|photo|video&q=&sort=time|size|path&page=&limit=   分页列表 + 各类型汇总
 *   POST /api/trash/delete {ids, confirmBak}     彻底删除: 原文件 + 视频的转码/换壳副本 + 库记录 + (无人共用时的)缩略图/标签/收藏
 *   GET  /api/trash/export?type=                 导出清单(含 Windows 路径)
 *   GET  /api/trash/missing-count?type= / POST /api/trash/purge-missing {type}   文件已不在盘的记录
 * 恢复沿用 /api/photos/restore。BAK 里的文件删除要 confirmBak=true(页面上做二次确认)。
 * 缩略图/标签/收藏按 md5 共用: 只有"没有别的记录共用同一个 md5"时才清理, 避免误伤重复文件。
 */
const fs = require('fs');
const path = require('path');

module.exports = function (app, getDb) {
  const express = require('express');
  const THUMB_ROOT = '/share/ssd001/nas-thumbs/';
  const VTHUMB_DIR = '/share/ssd001/nas-thumbs/vthumbs';

  const _c = {};
  function toRealPath(p) {
    if (p.indexOf('/share/CACHEDEV') === 0) return p;
    const m = p.match(/^\/share\/([^\/]+)(\/.*)?$/);
    if (!m) return p;
    if (!(m[1] in _c)) { _c[m[1]] = null; for (let i = 1; i <= 8; i++) { try { if (fs.existsSync('/share/CACHEDEV' + i + '_DATA/' + m[1])) { _c[m[1]] = 'CACHEDEV' + i + '_DATA'; break; } } catch (e) {} } }
    return _c[m[1]] ? '/share/' + _c[m[1]] + '/' + m[1] + (m[2] || '') : p;
  }
  function shareMap() {
    try { return JSON.parse(fs.readFileSync('/data/nas-config.json', 'utf8')).share_map || []; } catch (e) { return [['/share/Person', 'P:'], ['/share/Bak', 'B:'], ['/share/Media', 'M:'], ['/share/Container', 'X:']]; }
  }
  function winPath(p) {
    for (const m of shareMap()) if (p.toLowerCase().indexOf(String(m[0]).toLowerCase()) === 0) return m[1] + p.slice(m[0].length).replace(/\//g, '\\');
    return p.replace(/\//g, '\\');
  }
  const isNasPath = (p) => String(p || '').indexOf('/share/') === 0;
  const isBak = (p) => /^\/share\/bak\//i.test(p || '');
  function convCopies(p) {   // /share/X/rel/name.ext -> /share/X/转换/rel/name_转码.mp4 、 _换壳.mp4
    const m = String(p).match(/^(\/share\/[^\/]+)\/(.*?)([^\/]+)\.[^.\/]+$/);
    return m ? ['_转码.mp4', '_换壳.mp4'].map((s) => m[1] + '/转换/' + m[2] + m[3] + s) : [];
  }
  const typeWhere = (t) => (t === 'photo' ? " AND media_type='photo'" : (t === 'video' ? " AND media_type='video'" : ''));
  const typeOf = (q) => (q === 'photo' || q === 'video' ? q : 'all');

  app.get('/api/trash/list', (req, res) => {
    try {
      const db = getDb();
      const type = typeOf(req.query.type);
      const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '60', 10) || 60));
      const q = String(req.query.q || '').trim();
      const order = req.query.sort === 'size' ? 'size DESC' : (req.query.sort === 'path' ? 'path ASC' : 'pending_delete_at DESC');
      const where = 'pending_delete=1' + typeWhere(type) + (q ? ' AND path LIKE ?' : '');
      const args = q ? ['%' + q + '%'] : [];
      const total = db.prepare('SELECT COUNT(*) c FROM photos WHERE ' + where).get(...args).c;
      const items = db.prepare('SELECT id, path, md5, size, media_type, duration, width, height, vcodec, shots, thumb_path, pending_delete_at FROM photos WHERE ' + where + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?').all(...args, limit, (page - 1) * limit);
      for (const r of items) r.exists = isNasPath(r.path) ? fs.existsSync(toRealPath(r.path)) : null;   // null = 电脑盘符路径, NAS 上无法判断
      const sum = { photo: { count: 0, bytes: 0 }, video: { count: 0, bytes: 0 } };
      for (const r of db.prepare("SELECT media_type t, COUNT(*) c, COALESCE(SUM(size),0) b FROM photos WHERE pending_delete=1 GROUP BY media_type").all()) { const k = r.t === 'video' ? 'video' : 'photo'; sum[k].count += r.c; sum[k].bytes += r.b; }
      res.json({ items, total, page, limit, summary: { photo: sum.photo, video: sum.video, all: { count: sum.photo.count + sum.video.count, bytes: sum.photo.bytes + sum.video.bytes } } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 彻底删除 ──
  function purgeRow(db, r, confirmBak, st) {
    const nas = isNasPath(r.path);
    if (nas && isBak(r.path) && !confirmBak) return { error: 'BAK 里的文件需要二次确认' };
    if (nas) {
      const real = toRealPath(r.path);
      try {
        if (fs.existsSync(real)) { if (!fs.statSync(real).isFile()) return { error: '不是普通文件' }; fs.unlinkSync(real); }
      } catch (e) { return { error: e.message }; }
      if (r.media_type === 'video') for (const c of convCopies(r.path)) { try { const rc = toRealPath(c); if (fs.existsSync(rc)) { fs.unlinkSync(rc); st.copies++; } } catch (e) {} }
    } else st.pcOnly++;                       // 电脑盘符路径: NAS 上没有这个文件, 只清库记录
    const others = r.md5 ? db.prepare('SELECT 1 FROM photos WHERE md5=? AND id!=? LIMIT 1').get(r.md5, r.id) : null;
    db.transaction(() => {
      db.prepare('DELETE FROM photos WHERE id=?').run(r.id);
      if (r.md5 && !others) {
        db.prepare('DELETE FROM photo_tags WHERE md5=?').run(r.md5);
        db.prepare('DELETE FROM photo_marks WHERE md5=?').run(r.md5);
        db.prepare('DELETE FROM photo_features WHERE md5=?').run(r.md5);
      }
    })();
    if (r.md5 && !others) {
      if (r.media_type === 'video') {
        const d = path.join(VTHUMB_DIR, r.md5.slice(0, 2));
        try { for (const f of fs.readdirSync(d)) if (f.indexOf(r.md5 + '_') === 0) { fs.unlinkSync(path.join(d, f)); st.thumbs++; } } catch (e) {}
      } else {
        for (const p of [r.thumb_path, r.preview_path]) { if (p) { try { fs.unlinkSync(THUMB_ROOT + p); st.thumbs++; } catch (e) {} } }
      }
    }
    return { ok: true };
  }

  app.post('/api/trash/delete', express.json({ limit: '2mb' }), (req, res) => {
    try {
      const db = getDb();
      const ids = ((req.body && req.body.ids) || []).map((x) => parseInt(x, 10)).filter((x) => x > 0);
      if (!ids.length) return res.status(400).json({ error: 'ids 为空' });
      const get = db.prepare("SELECT id, path, md5, size, media_type, thumb_path, preview_path FROM photos WHERE id=? AND pending_delete=1");
      const st = { copies: 0, thumbs: 0, pcOnly: 0 }; let deleted = 0, bytes = 0; const errors = [];
      for (const id of ids) {
        const r = get.get(id);
        if (!r) { errors.push({ id, error: '不在回收站' }); continue; }
        const x = purgeRow(db, r, !!(req.body && req.body.confirmBak), st);
        if (x.ok) { deleted++; bytes += r.size || 0; console.log('[trash] 彻底删除:', r.path); } else errors.push({ id, path: r.path, error: x.error });
      }
      res.json({ ok: true, deleted, bytes, copiesRemoved: st.copies, thumbsRemoved: st.thumbs, pcRecordsOnly: st.pcOnly, errors });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 文件已不在盘上的记录 ──
  app.get('/api/trash/missing-count', (req, res) => {
    try {
      const rows = getDb().prepare('SELECT path, size FROM photos WHERE pending_delete=1' + typeWhere(typeOf(req.query.type))).all();
      let missing = 0, mb = 0, still = 0, sb = 0;
      for (const r of rows) { if (!isNasPath(r.path)) continue; if (fs.existsSync(toRealPath(r.path))) { still++; sb += r.size || 0; } else { missing++; mb += r.size || 0; } }
      res.json({ total: rows.length, missing, missingBytes: mb, stillOnDisk: still, stillOnDiskBytes: sb });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/trash/purge-missing', express.json(), (req, res) => {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT id, path, md5, size, media_type, thumb_path, preview_path FROM photos WHERE pending_delete=1" + typeWhere(typeOf(req.body && req.body.type))).all();
      const gone = rows.filter((r) => isNasPath(r.path) && !fs.existsSync(toRealPath(r.path)));
      const st = { copies: 0, thumbs: 0, pcOnly: 0 }; let n = 0, bytes = 0;
      for (const r of gone) { if (purgeRow(db, r, true, st).ok) { n++; bytes += r.size || 0; } }
      res.json({ ok: true, purged: n, bytes, thumbsRemoved: st.thumbs });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── 导出清单 ──
  app.get('/api/trash/export', (req, res) => {
    try {
      const only = req.query.onlyExisting !== '0';
      const rows = getDb().prepare('SELECT path, size, media_type FROM photos WHERE pending_delete=1' + typeWhere(typeOf(req.query.type)) + ' ORDER BY path').all();
      const lines = ['# 回收站清单  导出时间 ' + new Date().toISOString(), '# 列: 类型\t大小(字节)\tWindows路径\tNAS路径'];
      let cnt = 0, bytes = 0;
      for (const r of rows) {
        if (!isNasPath(r.path)) continue;
        if (only && !fs.existsSync(toRealPath(r.path))) continue;
        lines.push((r.media_type === 'video' ? '视频' : '图片') + '\t' + (r.size || 0) + '\t' + winPath(r.path) + '\t' + r.path); cnt++; bytes += r.size || 0;
      }
      lines.splice(1, 0, '# 共 ' + cnt + ' 个, 合计 ' + (bytes / 1e9).toFixed(2) + ' GB');
      res.set('Content-Type', 'text/plain; charset=utf-8'); res.set('Content-Disposition', 'attachment; filename="trash-list.txt"');
      res.send('﻿' + lines.join('\r\n') + '\r\n');
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('[trash] 统一回收站接口就绪');
};
