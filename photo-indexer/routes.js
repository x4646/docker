/**
 * photo-indexer 扩展路由（纯JS，挂载后重启即生效）
 */
const fs   = require('fs');
const path = require('path');

const PHOTO_EXTS = new Set(['.jpg','.jpeg','.png','.heic','.webp','.gif','.bmp','.tiff','.raw']);
const DATA_PATH  = '/data';

module.exports = function(app, getDb) {

  // ── PC根目录配置 ──────────────────────────────────
  const pcRootsPath = path.join(DATA_PATH, 'pc_roots.json');

  app.get('/api/pc-roots', (req, res) => {
    try {
      res.json(fs.existsSync(pcRootsPath) ? JSON.parse(fs.readFileSync(pcRootsPath, 'utf8')) : []);
    } catch(e) { res.json([]); }
  });

  app.post('/api/pc-roots', (req, res) => {
    const { name, path: dirPath } = req.body;
    if (!name || !dirPath) return res.status(400).json({ error: '缺少name或path' });
    try {
      const roots = fs.existsSync(pcRootsPath) ? JSON.parse(fs.readFileSync(pcRootsPath, 'utf8')) : [];
      if (roots.find(r => r.path === dirPath)) return res.json({ error: '已存在' });
      roots.push({ name, path: dirPath });
      fs.writeFileSync(pcRootsPath, JSON.stringify(roots, null, 2));
      res.json({ ok: true });
    } catch(e) { res.json({ error: e.message }); }
  });

  app.delete('/api/pc-roots/:idx', (req, res) => {
    try {
      const roots = fs.existsSync(pcRootsPath) ? JSON.parse(fs.readFileSync(pcRootsPath, 'utf8')) : [];
      roots.splice(parseInt(req.params.idx), 1);
      fs.writeFileSync(pcRootsPath, JSON.stringify(roots, null, 2));
      res.json({ ok: true });
    } catch(e) { res.json({ error: e.message }); }
  });

  // ── 文件数量异步统计 ──────────────────────────────
  app.get('/api/photos/filecount', (req, res) => {
    const dirPath = req.query.path;
    if (!dirPath) return res.status(400).json({ error: '缺少path' });
    let count = 0;
    const walk = (dir) => {
      try {
        fs.readdirSync(dir).forEach(n => {
          if (n.startsWith('.') || n.startsWith('@')) return;
          const f = path.join(dir, n);
          try {
            const s = fs.statSync(f);
            if (s.isDirectory()) walk(f);
            else if (PHOTO_EXTS.has(path.extname(n).toLowerCase())) count++;
          } catch(e) {}
        });
      } catch(e) {}
    };
    setImmediate(() => {
      walk(dirPath);
      res.json({ count });
    });
  });

  // ── PC目录浏览（通过nas-pipe代理）──────────────────
  const http = require('http');

  app.get('/api/pc/browse', (req, res) => {
    const db     = getDb();
    const status = db.prepare("SELECT online FROM (SELECT 1 as online) LIMIT 1").get();
    // 从nas-pipe获取PC IP
    http.get('http://192.168.0.3:3030/api/status', (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const s = JSON.parse(data);
          if (!s.online || !s.ip) return res.json({ error: '电脑不在线' });
          const pcPath = req.query.path || '';
          const url    = `http://${s.ip}:8080/browse?path=${encodeURIComponent(pcPath)}`;
          http.get(url, (r2) => {
            let d = '';
            r2.on('data', c => d += c);
            r2.on('end', () => {
              try { res.json(JSON.parse(d)); } catch(e) { res.json([]); }
            });
          }).on('error', () => res.json({ error: 'PC HTTP服务未启动' }));
        } catch(e) { res.json({ error: '解析失败' }); }
      });
    }).on('error', () => res.json({ error: 'nas-pipe连接失败' }));
  });

  // ── PC文件代理 ────────────────────────────────────
  app.get('/api/pc/file/*', (req, res) => {
    http.get('http://192.168.0.3:3030/api/status', (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const s = JSON.parse(data);
          if (!s.online || !s.ip) return res.status(503).json({ error: '电脑不在线' });
          const filePath = req.params[0];
          const url      = `http://${s.ip}:8080/file/${encodeURIComponent(filePath)}`;
          http.get(url, (r2) => {
            res.setHeader('Content-Type', r2.headers['content-type'] || 'application/octet-stream');
            if (r2.headers['content-length']) res.setHeader('Content-Length', r2.headers['content-length']);
            r2.pipe(res);
          }).on('error', e => res.status(500).json({ error: e.message }));
        } catch(e) { res.status(500).json({ error: '解析失败' }); }
      });
    }).on('error', () => res.status(503).json({ error: 'nas-pipe连接失败' }));
  });

};
