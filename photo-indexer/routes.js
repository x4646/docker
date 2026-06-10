/**
 * photo-indexer 扩展路由（纯JS）
 */
const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const crypto = require('crypto');

// 读取配置
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync('/data/config.json', 'utf8'));
  } catch(e) {
    return { nas_ip: '192.168.0.3', pipe_port: 3030 };
  }
}

const PHOTO_EXTS = new Set(['.jpg','.jpeg','.png','.heic','.webp','.gif','.bmp','.tiff','.raw']);
const DATA_PATH  = '/data';

// HTTP请求工具
function httpGet(url) {
  return new Promise((resolve) => {
    http.get(url, (r) => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

function httpPost(host, port, path_, body) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body));
    const req  = http.request({ hostname: host, port, path: path_, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){resolve({})} }); });
    req.on('error', () => resolve({}));
    req.write(data); req.end();
  });
}

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

  // ── 系统配置读写 ──────────────────────────────────
  const sysConfigPath = path.join(DATA_PATH, 'config.json');

  app.get('/api/config/system', (req, res) => {
    try {
      res.json(fs.existsSync(sysConfigPath) ? JSON.parse(fs.readFileSync(sysConfigPath, 'utf8')) : {});
    } catch(e) { res.json({}); }
  });

  app.post('/api/config/system', (req, res) => {
    try {
      fs.writeFileSync(sysConfigPath, JSON.stringify(req.body, null, 2));
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
    setImmediate(() => { walk(dirPath); res.json({ count }); });
  });

  // ── PC目录浏览 ────────────────────────────────────
  app.get('/api/pc/browse', async (req, res) => {
    const cfg    = loadConfig();
    const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
    if (!status || !status.online || !status.ip) return res.json({ error: '电脑不在线' });
    const pcPath = req.query.path || '';
    const result = await httpGet(`http://${status.ip}:8080/browse?path=${encodeURIComponent(pcPath)}`);
    res.json(result || { error: 'PC HTTP服务未启动' });
  });

  // ── PC文件代理 ────────────────────────────────────
  app.get('/api/pc/file/*', async (req, res) => {
    const cfg    = loadConfig();
    const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
    if (!status || !status.online || !status.ip) return res.status(503).json({ error: '电脑不在线' });
    const filePath = req.params[0];
    http.get(`http://${status.ip}:8080/file/${encodeURIComponent(filePath)}`, (r) => {
      res.setHeader('Content-Type', r.headers['content-type'] || 'application/octet-stream');
      if (r.headers['content-length']) res.setHeader('Content-Length', r.headers['content-length']);
      r.pipe(res);
    }).on('error', e => res.status(500).json({ error: e.message }));
  });

  // ── PC目录状态查询 ────────────────────────────────
  app.post('/api/pc/dir-stats', async (req, res) => {
    const { pcPath } = req.body;
    if (!pcPath) return res.status(400).json({ error: '缺少pcPath' });
    const cfg    = loadConfig();
    const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
    if (!status || !status.online || !status.ip) return res.json({ error: '电脑不在线' });

    const IMG_EXTS = new Set(['.jpg','.jpeg','.png','.heic','.webp','.gif','.bmp','.tiff','.raw']);
    const allFiles = [];
    const walkPc = async (p) => {
      const items = await httpGet(`http://${status.ip}:8080/browse?path=${encodeURIComponent(p)}`);
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (item.type === 'dir') await walkPc(item.path);
        else if (IMG_EXTS.has((item.ext||'').toLowerCase())) allFiles.push(item);
      }
    };
    await walkPc(pcPath);

    const db = getDb();
    let cached = 0, pending = 0;
    for (const f of allFiles) {
      const fileKey  = crypto.createHash('md5')
        .update(`${path.basename(f.path)}_${f.size}_${f.mtime}`).digest('hex');
      const existing = db.prepare('SELECT status FROM photos WHERE file_key = ?').get(fileKey);
      if (existing && existing.status === 'done') cached++;
      else pending++;
    }
    res.json({ total: allFiles.length, cached, pending, pcPath });
  });

  // ── PC目录派发处理 ────────────────────────────────
  app.post('/api/pc/dispatch', async (req, res) => {
    const { pcPath } = req.body;
    if (!pcPath) return res.status(400).json({ error: '缺少pcPath' });
    const cfg = loadConfig();
    await httpPost(cfg.nas_ip, cfg.pipe_port, '/api/task', {
      type:        'scan_and_process',
      task_id:     String(Date.now()),
      pcPath,
      nasDataPath: '/data/photos',
    });
    res.json({ ok: true });
  });

};
