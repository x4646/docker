/*
 * video-trash.js — 视频回收站(逻辑删除)的管理接口。
 * 逻辑删除本身沿用 soft-delete.js: /api/photos/soft-delete(打标记 pending_delete=1, 视频列表立刻不显示,
 * 不动任何文件) 和 /api/photos/restore(恢复)。这里补回收站页面需要的三样:
 *   1) 列表: 带视频信息(时长/分辨率/大小)、文件还在不在盘、缩略图key
 *   2) 导出清单: 用户自己手动去物理删除时照着删——每行 NAS路径 + Windows盘符路径
 *   3) 清理"已手动删除"的记录: 用户物理删掉文件后, 库里还剩指向不存在文件的记录, 一键清掉
 *      (同时清缩略图文件; 标签/标记/特征只在没有别的视频共用同一个key时才清)
 * 2026-09-30起: 增加 POST /api/video-trash/delete, 回收站页面里用户确认后可直接物理删除(原文件+转码副本+库记录+缩略图)。
 */
const fs = require('fs');
const path = require('path');

module.exports = function (app, getDb) {
  const express = require('express');
  const VTHUMB_DIR = '/share/Container/docker/services/nas-media/vthumbs';

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

  app.get('/api/video-trash/list', (req, res) => {
    try {
      const db = getDb();
      const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '60', 10) || 60));
      const q = String(req.query.q || '').trim();
      const order = req.query.sort === 'size' ? 'size DESC' : (req.query.sort === 'path' ? 'path ASC' : 'pending_delete_at DESC');
      const where = "media_type='video' AND pending_delete=1" + (q ? " AND path LIKE ?" : '');
      const args = q ? ['%' + q + '%'] : [];
      const sum = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(size),0) b FROM photos WHERE media_type='video' AND pending_delete=1").get();
      const total = db.prepare('SELECT COUNT(*) c FROM photos WHERE ' + where).get(...args).c;
      const rows = db.prepare('SELECT id, path, md5, size, duration, width, height, vcodec, shots, pending_delete_at FROM photos WHERE ' + where + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?')
        .all(...args, limit, (page - 1) * limit);
      for (const r of rows) r.exists = fs.existsSync(toRealPath(r.path));
      res.json({ items: rows, total, page, limit, summary: { count: sum.c, bytes: sum.b } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 文件已经不在盘上的(用户手动删过了)有多少
  app.get('/api/video-trash/missing-count', (req, res) => {
    try {
      const rows = getDb().prepare("SELECT path, size FROM photos WHERE media_type='video' AND pending_delete=1").all();
      let n = 0, b = 0, still = 0, stillB = 0;
      for (const r of rows) { if (fs.existsSync(toRealPath(r.path))) { still++; stillB += r.size || 0; } else { n++; b += r.size || 0; } }
      res.json({ total: rows.length, missing: n, missingBytes: b, stillOnDisk: still, stillOnDiskBytes: stillB });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 导出清单(文本): 用户手动物理删除时照着删
  app.get('/api/video-trash/export', (req, res) => {
    try {
      const only = req.query.onlyExisting !== '0';
      const rows = getDb().prepare("SELECT path, size, pending_delete_at FROM photos WHERE media_type='video' AND pending_delete=1 ORDER BY path").all();
      const lines = ['# 视频回收站清单(逻辑删除、还没物理删除的)  导出时间 ' + new Date().toISOString(),
        '# 列: 大小(字节)\tWindows路径\tNAS路径'];
      let cnt = 0, bytes = 0;
      for (const r of rows) {
        if (only && !fs.existsSync(toRealPath(r.path))) continue;
        lines.push((r.size || 0) + '\t' + winPath(r.path) + '\t' + r.path);
        cnt++; bytes += r.size || 0;
      }
      lines.splice(1, 0, '# 共 ' + cnt + ' 个, 合计 ' + (bytes / 1e9).toFixed(2) + ' GB');
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="video-trash-list.txt"');
      res.send('﻿' + lines.join('\r\n') + '\r\n');
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 清理"文件已经不在盘上"的回收站记录(用户手动物理删除之后)
  app.post('/api/video-trash/purge-missing', express.json(), (req, res) => {
    try {
      const db = getDb();
      const rows = db.prepare("SELECT id, path, md5, size FROM photos WHERE media_type='video' AND pending_delete=1").all();
      const gone = rows.filter((r) => !fs.existsSync(toRealPath(r.path)));
      const shared = db.prepare('SELECT 1 FROM photos WHERE md5=? AND id!=? LIMIT 1');
      const del = db.prepare('DELETE FROM photos WHERE id=?');
      let n = 0, bytes = 0, thumbs = 0;
      for (const r of gone) {
        const others = r.md5 ? shared.get(r.md5, r.id) : null;
        db.transaction(() => {
          del.run(r.id);
          if (r.md5 && !others) {
            db.prepare('DELETE FROM photo_tags WHERE md5=?').run(r.md5);
            db.prepare('DELETE FROM photo_marks WHERE md5=?').run(r.md5);
            db.prepare('DELETE FROM photo_features WHERE md5=?').run(r.md5);
          }
        })();
        if (r.md5 && !others) {
          const d = path.join(VTHUMB_DIR, r.md5.slice(0, 2));
          try { for (const f of fs.readdirSync(d)) if (f.indexOf(r.md5 + '_') === 0) { fs.unlinkSync(path.join(d, f)); thumbs++; } } catch (e) {}
        }
        n++; bytes += r.size || 0;
      }
      res.json({ ok: true, purged: n, bytes, thumbsRemoved: thumbs, keptStillOnDisk: rows.length - gone.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 转码/换壳副本路径: /share/X/rel/name.ext -> /share/X/转换/rel/name_转码.mp4 (与 video-conv.js 的规则一致)
  function convCopies(p) {
    const m = p.match(/^(\/share\/[^\/]+)\/(.*?)([^\/]+)\.[^.\/]+$/);
    if (!m) return [];
    return ['_转码.mp4', '_换壳.mp4'].map((s) => m[1] + '/转换/' + m[2] + m[3] + s);
  }

  // POST /api/video-trash/delete {ids:[...]}  直接物理删除回收站里的视频(用户在回收站页面确认后调用)
  // 只处理 pending_delete=1 的记录; 删原文件 + 它的转码/换壳副本, 成功后清库记录/缩略图(与 purge-missing 同规则)。
  // 文件删不掉(权限等)的保留记录并在 errors 里返回, 不会误清库。
  app.post('/api/video-trash/delete', express.json({ limit: '2mb' }), (req, res) => {
    try {
      const db = getDb();
      const ids = ((req.body && req.body.ids) || []).map((x) => parseInt(x, 10)).filter((x) => x > 0);
      if (!ids.length) return res.status(400).json({ error: 'ids 为空' });
      const get = db.prepare("SELECT id, path, md5, size FROM photos WHERE id=? AND media_type='video' AND pending_delete=1");
      const shared = db.prepare('SELECT 1 FROM photos WHERE md5=? AND id!=? LIMIT 1');
      let deleted = 0, bytes = 0, copies = 0, thumbs = 0; const errors = [];
      for (const id of ids) {
        const r = get.get(id);
        if (!r) { errors.push({ id, error: '不在回收站' }); continue; }
        if (/^\/share\/Bak\//i.test(r.path) && !(req.body && req.body.confirmBak)) { errors.push({ id, path: r.path, error: 'BAK 里的视频需要二次确认' }); continue; }
        const real = toRealPath(r.path);
        try {
          if (fs.existsSync(real)) { if (!fs.statSync(real).isFile()) throw new Error('不是普通文件'); fs.unlinkSync(real); }
        } catch (e) { errors.push({ id, path: r.path, error: e.message }); continue; }
        for (const c of convCopies(r.path)) { try { const rc = toRealPath(c); if (fs.existsSync(rc)) { fs.unlinkSync(rc); copies++; } } catch (e) {} }
        const others = r.md5 ? shared.get(r.md5, r.id) : null;
        db.transaction(() => {
          db.prepare('DELETE FROM photos WHERE id=?').run(r.id);
          if (r.md5 && !others) {
            db.prepare('DELETE FROM photo_tags WHERE md5=?').run(r.md5);
            db.prepare('DELETE FROM photo_marks WHERE md5=?').run(r.md5);
            db.prepare('DELETE FROM photo_features WHERE md5=?').run(r.md5);
          }
        })();
        if (r.md5 && !others) {
          const d = path.join(VTHUMB_DIR, r.md5.slice(0, 2));
          try { for (const f of fs.readdirSync(d)) if (f.indexOf(r.md5 + '_') === 0) { fs.unlinkSync(path.join(d, f)); thumbs++; } } catch (e) {}
        }
        deleted++; bytes += r.size || 0;
        console.log('[video-trash] 物理删除:', r.path);
      }
      res.json({ ok: true, deleted, bytes, copiesRemoved: copies, thumbsRemoved: thumbs, errors });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('[video-trash] 初始化完成');
};
