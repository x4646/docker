module.exports = function (app, getDb) {
  var express = require('express');
  var fs = require('fs');
  var path = require('path');

  var MUSIC_ROOT = '/share/Media/音乐';
  var AUDIO_EXTS = ['.mp3', '.flac', '.m4a', '.wav', '.aac', '.ogg', '.wma'];

  function isAudio(name) {
    return AUDIO_EXTS.indexOf(path.extname(name).toLowerCase()) >= 0;
  }

  function scanDir(dir, recursive, out) {
    out = out || [];
    var ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
    ents.forEach(function (e) {
      if (e.name.startsWith('.') || e.name.startsWith('@')) return;
      var full = dir + '/' + e.name;
      if (e.isDirectory()) { if (recursive) scanDir(full, true, out); }
      else if (isAudio(e.name)) out.push({ path: full, name: e.name.replace(/\.[^.]+$/, '') });
    });
    return out;
  }

  // ── 全库搜索(递归扫描 + 60秒内存缓存) ──────────────
  var _scanCache = { t: 0, songs: [] };
  function invalidateScanCache() { _scanCache = { t: 0, songs: [] }; }

  app.get('/api/music/search', function (req, res) {
    var q = String(req.query.q || '').trim().toLowerCase();
    if (!q) return res.json({ songs: [], total: 0 });
    var limit = Math.min(300, Math.max(1, parseInt(req.query.limit || '80', 10) || 80));
    try {
      var fresh = false;
      if (!_scanCache.songs.length || Date.now() - _scanCache.t > 60000) {
        _scanCache = { t: Date.now(), songs: scanDir(MUSIC_ROOT, true) };
        fresh = true;
      }
      var out = [];
      for (var i = 0; i < _scanCache.songs.length && out.length < limit; i++) {
        var s = _scanCache.songs[i];
        if (s.name.toLowerCase().indexOf(q) >= 0 || s.path.toLowerCase().indexOf(q) >= 0) out.push(s);
      }
      res.json({ songs: out, total: _scanCache.songs.length, hit: out.length, rescanned: fresh });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 浏览音乐目录(前端挑歌用)
  app.get('/api/music/browse', function (req, res) {
    var dir = req.query.path || MUSIC_ROOT;
    if (dir.indexOf(MUSIC_ROOT) !== 0 && dir.indexOf('/share/') !== 0) {
      return res.status(400).json({ error: '非法路径' });
    }
    try {
      var ents = fs.readdirSync(dir, { withFileTypes: true });
      var dirs = [], files = [];
      ents.forEach(function (e) {
        if (e.name.startsWith('.') || e.name.startsWith('@')) return;
        if (e.isDirectory()) dirs.push({ name: e.name, path: dir + '/' + e.name });
        else if (isAudio(e.name)) files.push({ name: e.name.replace(/\.[^.]+$/, ''), path: dir + '/' + e.name });
      });
      res.json({ dir: dir, root: MUSIC_ROOT, dirs: dirs, files: files });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 扫描目录返回音频列表(导入预览用)
  app.get('/api/music/scan', function (req, res) {
    var dir = req.query.path || MUSIC_ROOT;
    var recursive = req.query.recursive !== '0';
    try {
      res.json({ dir: dir, songs: scanDir(dir, recursive) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  function addSongsToPlaylist(id, add) {
    var db = getDb();
    var row = db.prepare('SELECT * FROM playlists WHERE id=?').get(id);
    if (!row) return { error: '歌单不存在' };
    var songs = [];
    try { songs = JSON.parse(row.songs || '[]'); } catch (e) {}
    var seen = {};
    songs.forEach(function (s) { seen[s.path] = 1; });
    var added = 0;
    add.forEach(function (s) {
      if (!s || !s.path || seen[s.path]) return;
      songs.push({ path: s.path, name: s.name || s.path.split('/').pop().replace(/\.[^.]+$/, '') });
      seen[s.path] = 1;
      added++;
    });
    db.prepare('UPDATE playlists SET songs=? WHERE id=?').run(JSON.stringify(songs), id);
    return { ok: true, added: added, total: songs.length };
  }

  // 歌单: 追加歌曲(去重)
  app.post('/api/playlists/:id/add-songs', express.json({ limit: '2mb' }), function (req, res) {
    var add = (req.body && req.body.songs) || [];
    if (!Array.isArray(add) || !add.length) return res.status(400).json({ error: 'songs为空' });
    try {
      var r = addSongsToPlaylist(req.params.id, add);
      if (r.error) return res.status(404).json(r);
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 歌单: 导入整个目录
  app.post('/api/playlists/:id/import-dir', express.json(), function (req, res) {
    var dir = (req.body && req.body.path) || MUSIC_ROOT;
    var recursive = !(req.body && req.body.recursive === false);
    try {
      var songs = scanDir(dir, recursive);
      if (!songs.length) return res.json({ ok: true, added: 0, total: 0, note: '该目录没有音频文件' });
      var r = addSongsToPlaylist(req.params.id, songs);
      if (r.error) return res.status(404).json(r);
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 歌单: 移除某首
  app.post('/api/playlists/:id/remove-song', express.json(), function (req, res) {
    var p = req.body && req.body.path;
    if (!p) return res.status(400).json({ error: '缺少path' });
    try {
      var db = getDb();
      var row = db.prepare('SELECT * FROM playlists WHERE id=?').get(req.params.id);
      if (!row) return res.status(404).json({ error: '歌单不存在' });
      var songs = [];
      try { songs = JSON.parse(row.songs || '[]'); } catch (e) {}
      var before = songs.length;
      songs = songs.filter(function (s) { return s.path !== p; });
      db.prepare('UPDATE playlists SET songs=? WHERE id=?').run(JSON.stringify(songs), req.params.id);
      res.json({ ok: true, removed: before - songs.length, total: songs.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 上传音乐文件(原始二进制, 文件名走header避免编码问题)
  app.post('/api/music/upload', express.raw({ type: '*/*', limit: '200mb' }), function (req, res) {
    try {
      var name = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename']) : '';
      if (!name) return res.status(400).json({ error: '缺少x-filename头' });
      if (!isAudio(name)) return res.status(400).json({ error: '不是支持的音频格式' });
      name = name.replace(/[\\/]/g, '_');
      var subdir = req.headers['x-subdir'] ? decodeURIComponent(req.headers['x-subdir']) : '';
      var targetDir = subdir ? (MUSIC_ROOT + '/' + subdir.replace(/^\/+|\/+$/g, '')) : MUSIC_ROOT;
      try { fs.mkdirSync(targetDir, { recursive: true }); } catch (e) {}
      var full = targetDir + '/' + name;
      if (fs.existsSync(full)) {
        var base = name.replace(/\.[^.]+$/, ''), ext = path.extname(name);
        full = targetDir + '/' + base + '_' + Date.now() + ext;
      }
      fs.writeFileSync(full, req.body);
      invalidateScanCache();
      res.json({ ok: true, path: full, name: path.basename(full).replace(/\.[^.]+$/, '') });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 从目录一键创建歌单(歌单名默认取目录名)
  app.post('/api/playlists/create-from-dir', express.json(), function (req, res) {
    var dir = (req.body && req.body.path) || MUSIC_ROOT;
    var recursive = !(req.body && req.body.recursive === false);
    var name = (req.body && req.body.name) || dir.split('/').filter(Boolean).pop() || '新歌单';
    try {
      var songs = scanDir(dir, recursive);
      if (!songs.length) return res.status(400).json({ error: '该目录没有音频文件' });
      var db = getDb();
      var r = db.prepare('INSERT INTO playlists (name, songs) VALUES (?, ?)').run(name, JSON.stringify(songs));
      res.json({ ok: true, id: r.lastInsertRowid, name: name, count: songs.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('[music-ext] 初始化完成 (v2: +全库搜索), 音乐根目录:', MUSIC_ROOT);
};
