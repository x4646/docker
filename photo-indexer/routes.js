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

function httpPost(host, port, path_, body, timeoutMs) {
  timeoutMs = timeoutMs || 120000;
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body));
    const req  = http.request({ hostname: host, port, path: path_, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
      timeout: timeoutMs,
    }, (r) => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){resolve({})} }); });
    req.on('error', () => resolve({}));
    req.on('timeout', () => { req.destroy(); resolve({}); });
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

  app.put('/api/pc-roots/:idx', (req, res) => {
    const idx  = parseInt(req.params.idx);
    const { name, path: p } = req.body || {};
    if (!p) return res.status(400).json({ error: '缺少path' });
    try {
      const rows = fs.existsSync(pcRootsPath) ? JSON.parse(fs.readFileSync(pcRootsPath, 'utf8')) : [];
      if (idx < 0 || idx >= rows.length) return res.status(404).json({ error: '不存在' });
      rows[idx] = { name: name || p, path: p };
      fs.writeFileSync(pcRootsPath, JSON.stringify(rows, null, 2));
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

  // 初始化system_config表
  (() => {
    const db = getDb();
    try {
      db.prepare("CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT)").run();
      const defaults = {
        nas_ip: '192.168.0.3', pipe_port: '3030', indexer_port: '3050',
        viewer_port: '3051', sync_port: '3040', nas_smb_host: 'whfnas',
        thumb_dir: '/share/Container/docker/data/photos/thumbs',
        preview_dir: '/share/Container/docker/data/photos/preview'
      };
      const ins = db.prepare("INSERT OR IGNORE INTO system_config (key,value) VALUES (?,?)");
      // 从旧config.json迁移
      let old = {};
      try { old = JSON.parse(fs.readFileSync(sysConfigPath,'utf8')); } catch(e) {}
      Object.entries({...defaults,...old}).forEach(([k,v]) => ins.run(k, String(v)));
    } catch(e) {}
  })();

  app.get('/api/config/system', (req, res) => {
    try {
      const db   = getDb();
      const rows = db.prepare("SELECT key,value FROM system_config").all();
      const cfg  = {};
      rows.forEach(r => {
        cfg[r.key] = isNaN(r.value) ? r.value : Number(r.value);
      });
      res.json(cfg);
    } catch(e) { res.json({}); }
  });

  app.post('/api/config/system', (req, res) => {
    try {
      const db  = getDb();
      const upd = db.prepare("INSERT OR REPLACE INTO system_config (key,value) VALUES (?,?)");
      db.transaction(() => {
        Object.entries(req.body).forEach(([k,v]) => upd.run(k, String(v)));
      })();
      res.json({ ok: true });
    } catch(e) { res.json({ error: e.message }); }
  });

  // ── 文件数量异步统计 ──────────────────────────────
  app.get('/api/photos2/filecount', (req, res) => {
    const dirPath = req.query.path;
    if (!dirPath) return res.status(400).json({ error: '缺少path' });
    
    const dirCounts = {};
    
    const walk = (dir) => {
      let count = 0;
      try {
        fs.readdirSync(dir).forEach(n => {
          if (n.startsWith('.') || n.startsWith('@')) return;
          const f = path.join(dir, n);
          try {
            const s = fs.statSync(f);
            if (s.isDirectory()) {
              const subCount = walk(f);
              dirCounts[f] = subCount;
              count += subCount;
            } else if (PHOTO_EXTS.has(path.extname(n).toLowerCase())) {
              count++;
            }
          } catch(e) {}
        });
      } catch(e) {}
      return count;
    };
    
    setImmediate(() => {
      const total = walk(dirPath);
      dirCounts[dirPath] = total;
      res.json({ count: total, breakdown: dirCounts });
    });
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

  // 扫描任务进度存储
  const scanTasks = new Map();

  app.post('/api/photos/scan2', (req, res) => {
    const dirPath = req.body.path;
    if (!dirPath) return res.status(400).json({ error: '缺少path' });
    const taskId = String(Date.now());
    const task   = {
      status: 'running', actual: 0, orphanDeleted: 0, done: false,
      dirStats: {},
      currentDir: dirPath,
    };
    scanTasks.set(taskId, task);
    res.json({ ok: true, taskId });

    const db    = getDb();
    const sleep = () => new Promise(r => setImmediate(r));

    const doneIndex = new Map();
    try {
      const rows = db.prepare("SELECT size, ctime FROM photos WHERE status='done' AND path LIKE ?").all(dirPath + '/%');
      for (const r of rows) doneIndex.set(`${r.size}_${r.ctime}`, true);
    } catch(e) {}

    const walk = async (dir) => {
      let total = 0, done = 0;
      let items;
      try { items = fs.readdirSync(dir); } catch(e) { return { total: 0, done: 0 }; }
      let i = 0;
      for (const n of items) {
        if (n.startsWith('.') || n.startsWith('@')) { i++; continue; }
        const full = path.join(dir, n);
        try {
          const s = fs.statSync(full);
          if (s.isDirectory()) {
            const sub = await walk(full);
            total += sub.total;
            done  += sub.done;
            if (sub.total > 0) {
              task.dirStats[full] = sub;
              task.currentDir = full;
            }
          } else if (PHOTO_EXTS.has(path.extname(n).toLowerCase())) {
            total++;
            task.actual++;
            const ctime = Math.floor(s.ctimeMs / 1000);
            if (doneIndex.has(`${s.size}_${ctime}`)) done++;
          }
        } catch(e) {}
        if (++i % 200 === 0) await sleep();
      }
      return { total, done };
    };

    const cleanOrphans = async (dir) => {
      const rows = db.prepare('SELECT path FROM photos WHERE path LIKE ?').all(dir + '/%');
      let i = 0;
      for (const row of rows) {
        if (!fs.existsSync(row.path)) {
          db.prepare('DELETE FROM photos WHERE path = ?').run(row.path);
          task.orphanDeleted++;
        }
        if (++i % 200 === 0) await sleep();
      }
    };

    (async () => {
      await cleanOrphans(dirPath);
      const result = await walk(dirPath);
      task.dirStats[dirPath] = result;

      const now    = Math.floor(Date.now() / 1000);
      const insert = db.prepare(
        "INSERT OR REPLACE INTO dir_stats (path, total_files, done_files, updated_at) VALUES (?, ?, ?, ?)"
      );
      const tx = db.transaction((entries) => {
        for (const [p, st] of entries) insert.run(p, st.total, st.done, now);
      });
      tx(Object.entries(task.dirStats));

      task.done   = true;
      task.status = 'done';
    })();
  });

  app.get('/api/photos/scan2/progress/:taskId', (req, res) => {
    const task = scanTasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'task not found' });
    res.json(task);
    if (task.done) setTimeout(() => scanTasks.delete(req.params.taskId), 30000);
  });

  // 获取目录下所有子目录
  app.get("/api/photos/dirs", (req, res) => {
    const dirPath = req.query.path;
    if (!dirPath) return res.status(400).json({ error: "缺少path" });
    const result = [];
    const walk = (dir, depth) => {
      try {
        fs.readdirSync(dir).forEach(n => {
          if (n.startsWith(".") || n.startsWith("@")) return;
          const full = path.join(dir, n);
          try {
            if (fs.statSync(full).isDirectory()) {
              let count = 0;
              try { fs.readdirSync(full).forEach(f => { if (PHOTO_EXTS.has(path.extname(f).toLowerCase())) count++; }); } catch(e) {}
              result.push({ path: full, name: n, depth, fileCount: count });
              walk(full, depth + 1);
            }
          } catch(e) {}
        });
      } catch(e) {}
    };
    walk(dirPath, 1);
    res.json(result);
  });

  // 补全ctime字段（一次性任务）
  app.post("/api/photos/fix-ctime", (req, res) => {
    const taskId = String(Date.now());
    const task   = { status: "running", total: 0, fixed: 0, done: false };
    scanTasks.set(taskId, task);
    res.json({ ok: true, taskId });
    const db = getDb();
    const sleep = () => new Promise(r => setImmediate(r));
    (async () => {
      const rows = db.prepare("SELECT path FROM photos WHERE ctime IS NULL OR ctime = 0").all();
      task.total = rows.length;
      const upd = db.prepare("UPDATE photos SET ctime = ? WHERE path = ?");
      let i = 0;
      for (const row of rows) {
        try {
          const s = fs.statSync(row.path);
          upd.run(Math.floor(s.ctimeMs/1000), row.path);
          task.fixed++;
        } catch(e) {}
        if (++i % 200 === 0) await sleep();
      }
      task.done = true;
      task.status = "done";
    })();
  });

  // 查询dir_stats（一个目录下所有子目录的统计）
  app.get("/api/dir-stats", (req, res) => {
    const dirPath = req.query.path;
    if (!dirPath) return res.status(400).json({ error: "缺少path" });
    const db = getDb();
    const rows = db.prepare("SELECT path, total_files, done_files, pending_files FROM dir_stats WHERE path = ? OR path LIKE ? ORDER BY path").all(dirPath, dirPath + "/%");
    res.json(rows);
  });

  // groups/dir 从dir_stats读（覆盖TS版本）
  app.get("/api/photos/groups/dir2", (req, res) => {
    const db      = getDb();
    const reqPath = req.query.path;

    if (!reqPath) {
      // 返回根目录（browser_roots）
      const roots = db.prepare("SELECT * FROM browser_roots WHERE source = 'nas' AND enabled = 1 ORDER BY name").all();
      const result = roots.map(r => {
        const st = db.prepare("SELECT total_files FROM dir_stats WHERE path = ?").get(r.path);
        const hasChildren = db.prepare("SELECT 1 FROM dir_stats WHERE path LIKE ? LIMIT 1").get(r.path + "/%");
        return { path: r.path, name: r.name, count: st ? st.total_files : 0, depth: 0, hasChildren: !!hasChildren };
      });
      return res.json(result);
    }

    // 返回指定路径的直接子目录（从dir_stats）
    const rows = db.prepare("SELECT path, total_files FROM dir_stats WHERE path LIKE ? AND path NOT LIKE ? ORDER BY path").all(reqPath + "/%", reqPath + "/%/%");
    const result = rows.map(r => {
      const name = r.path.split("/").pop();
      const hasChildren = db.prepare("SELECT 1 FROM dir_stats WHERE path LIKE ? LIMIT 1").get(r.path + "/%");
      return { path: r.path, name, count: r.total_files, depth: 1, hasChildren: !!hasChildren };
    });
    res.json(result);
  });

  // 重新计算dir_stats的done_files（不动total_files）
  app.post("/api/dir-stats/recalc", (req, res) => {
    const dirPath = req.body.path;
    if (!dirPath) return res.status(400).json({ error: "缺少path" });
    const db = getDb();
    try {
      const rows = db.prepare("SELECT path FROM dir_stats WHERE path = ? OR path LIKE ?").all(dirPath, dirPath + "/%");
      const upd = db.prepare("UPDATE dir_stats SET done_files = ?, pending_files = ?, updated_at = ? WHERE path = ?");
      const now = Math.floor(Date.now() / 1000);
      let updated = 0;
      for (const r of rows) {
        const done = db.prepare("SELECT COUNT(*) as c FROM photos WHERE status='done' AND path LIKE ?").get(r.path + "/%").c;
        const pending = db.prepare("SELECT COUNT(*) as c FROM photos WHERE status IN ('pending','processing') AND path LIKE ?").get(r.path + "/%").c;
        upd.run(done, pending, now, r.path);
        updated++;
      }
      res.json({ ok: true, updated });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });


  // ── PC扫描接口 ────────────────────────────────────
  app.post("/api/pc/scan", async (req, res) => {
    const pcPath = req.body.path;
    if (!pcPath) return res.status(400).json({ error: "缺少path" });
    const taskId = String(Date.now());
    const task   = { status: "running", actual: 0, dirs: 0, sent: 0, done: false, dirStats: {}, currentDir: '' };
    scanTasks.set(taskId, task);
    res.json({ ok: true, taskId });
    setTimeout(() => { if (!task.done) { task.done = true; task.status = "timeout"; } }, 1800000);
    // 异步通知PC开始扫描
    (async () => {
      try {
        const cfg    = loadConfig();
        const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
        if (!status || !status.online || !status.ip) { task.done=true; task.status='error'; task.error='PC不在线'; return; }
        await httpPost(status.ip, 8080, '/scan', { pcPath, task_id: taskId }, 1800000);
      } catch(e) { task.done=true; task.status='error'; task.error=e.message; }
    })();
  });

  app.post('/api/pc/scan-progress', require('express').json({limit:'10mb'}), (req, res) => {
    const { taskId, dirPath, files, stats, done } = req.body || {};
    const task = scanTasks.get(taskId);
    if (!task) return res.status(404).json({ error: 'task not found' });
    if (files && files.length) {
      const db   = getDb();
      db.pragma('busy_timeout=3000');
      const next = db.prepare("SELECT COALESCE(MAX(priority),0)+1 AS p FROM photos").get().p;
      const selKey  = db.prepare("SELECT id,path,status FROM photos WHERE file_key=?");
      const selMd5  = db.prepare("SELECT id,path FROM photos WHERE md5=? AND status='done'");
      const selPath = db.prepare("SELECT id,mtime,file_key FROM photos WHERE path=?");
      const ins     = db.prepare("INSERT OR IGNORE INTO photos (path,dir,size,mtime,file_key,status,priority) VALUES (@path,@dir,@size,@mtime,@file_key,'pending',@priority)");
      const updPath = db.prepare("UPDATE photos SET path=?,dir=?,updated_at=strftime('%s','now') WHERE id=?");
      const updMt   = db.prepare("UPDATE photos SET status='pending',mtime=?,file_key=?,updated_at=strftime('%s','now') WHERE id=?");
      const updPathKey = db.prepare("UPDATE photos SET path=?,dir=?,file_key=?,updated_at=strftime('%s','now') WHERE id=?");
      let sent = 0;
      db.transaction(() => {
        for (const f of files) {
          const dir = f.path.replace(/\\/g,'/').split('/').slice(0,-1).join('/');

          // 1. 先查file_key
          const byKey = selKey.get(f.key);
          if (byKey) {
            if (byKey.path !== f.path) {
              updPath.run(f.path, dir, byKey.id);
              sent++;
            }
            continue;
          }

          // 2. 查EXIF md5（JPEG有md5）
          if (f.exif_md5) {
            const byMd5 = selMd5.get(f.exif_md5);
            if (byMd5) {
              // 找到，更新path+file_key
              try { db.prepare('DELETE FROM photos WHERE path=? AND id!=?').run(f.path, byMd5.id); } catch(e) {}
              updPathKey.run(f.path, dir, f.key, byMd5.id);
              sent++;
              continue;
            }
          }
          const byPath = selPath.get(f.path);
          if (byPath) {
            // 路径存在但key不同，说明文件内容变了（改名后mtime变了）
            if (byPath.mtime !== f.mtime || byPath.file_key !== f.key) {
              updMt.run(f.mtime, f.key, byPath.id);
              sent++;
            }
          } else {
            // 新文件
            const dir = f.path.replace(/\\/g,'/').split('/').slice(0,-1).join('/');
            ins.run({ path:f.path, dir, size:f.size, mtime:f.mtime, file_key:f.key, priority:next });
            sent++;
          }
        }
      })();
      task.sent   += sent;
      task.actual += files.length;
    }
    if (stats) {
      const db  = getDb();
      const now = Math.floor(Date.now()/1000);
      const ins = db.prepare("INSERT OR REPLACE INTO pc_dir_stats (path,total_files,done_files,updated_at) VALUES (?,?,?,?)");
      db.transaction(() => { for (const [p,st] of Object.entries(stats)) ins.run(p,st.total,st.done||0,now); })();
      Object.assign(task.dirStats, stats);
    }
    if (dirPath) { task.currentDir = dirPath; task.dirs++; }
    if (done) {
      task.done = true; task.status = 'done';
    }
    res.json({ ok: true });
  });

  // 查询PC目录统计
  app.get("/api/pc-dir-stats", (req, res) => {
    const dirPath = req.query.path;
    if (!dirPath) return res.status(400).json({ error: "缺少path" });
    const db = getDb();
    const rows = db.prepare("SELECT path, total_files, done_files FROM pc_dir_stats WHERE path = ? OR path LIKE ? ORDER BY path").all(dirPath, dirPath + "%");
    res.json(rows);
  });

  // PC目录树（从pc_dir_stats读）
  app.get("/api/pc/groups/dir2", (req, res) => {
    const db = getDb();
    const reqPath = req.query.path;

    if (!reqPath) {
      let roots = [];
      try { roots = JSON.parse(fs.readFileSync(pcRootsPath, "utf8")); } catch(e) {}
      const result = roots.map(r => {
        const st = db.prepare("SELECT total_files FROM pc_dir_stats WHERE path = ?").get(r.path);
        const hasChildren = db.prepare("SELECT 1 FROM pc_dir_stats WHERE path LIKE ? LIMIT 1").get(r.path + "%");
        return { path: r.path, name: r.name, count: st ? st.total_files : 0, depth: 0, hasChildren: !!hasChildren };
      });
      return res.json(result);
    }

    // 推断分隔符（PC可能是\，NAS是/）
    const sep = reqPath.includes("\\") ? "\\" : "/";
    const prefix = reqPath.endsWith(sep) ? reqPath : reqPath + sep;
    const rows = db.prepare("SELECT path, total_files FROM pc_dir_stats WHERE path LIKE ? ORDER BY path").all(prefix + "%");
    // 只取直接子目录
    const direct = rows.filter(r => {
      const rest = r.path.substring(prefix.length);
      return rest && !rest.includes(sep);
    });
    const result = direct.map(r => {
      const name = r.path.split(sep).pop();
      const hasChildren = db.prepare("SELECT 1 FROM pc_dir_stats WHERE path LIKE ? LIMIT 1").get(r.path + sep + "%");
      return { path: r.path, name, count: r.total_files, depth: 1, hasChildren: !!hasChildren };
    });
    res.json(result);
  });


  // ── 派发目录到队列（覆盖TS版本）──────────────────
  app.post("/api/photos/dispatch/dir2", (req, res) => {
    const { dirPath, reprocess } = req.body;
    if (!dirPath) return res.status(400).json({ error: "缺少dirPath" });

    const taskId = String(Date.now());
    const task = { status: "running", scanned: 0, added: 0, skipped: 0, done: false };
    scanTasks.set(taskId, task);
    res.json({ ok: true, taskId });

    const db = getDb();
    const sleep = () => new Promise(r => setImmediate(r));

    (async () => {
      try {
        // 获取当前最大priority
        const maxRow = db.prepare("SELECT MAX(priority) as m FROM photos").get();
        const basePriority = (maxRow.m || 0) + 1;

        // 预查询已done的size+ctime索引
        const doneIndex = new Map();
        if (!reprocess) {
          const rows = db.prepare("SELECT size, ctime FROM photos WHERE status='done' AND path LIKE ?").all(dirPath + "/%");
          for (const r of rows) doneIndex.set(`${r.size}_${r.ctime}`, true);
        }

        const ins = db.prepare("INSERT OR IGNORE INTO photos (path,size,mtime,ctime,status,priority,created_at,updated_at) VALUES (?,?,?,?,'pending',?,strftime('%s','now'),strftime('%s','now'))");
        const upd = db.prepare("UPDATE photos SET status='pending', priority=?, updated_at=strftime('%s','now') WHERE path=? AND status NOT IN ('processing')");

        const walk = async (dir) => {
          let items;
          try { items = fs.readdirSync(dir); } catch(e) { return; }
          let i = 0;
          for (const n of items) {
            if (n.startsWith('.') || n.startsWith('@')) { i++; continue; }
            const full = path.join(dir, n);
            try {
              const s = fs.statSync(full);
              if (s.isDirectory()) {
                await walk(full);
              } else if (PHOTO_EXTS.has(path.extname(n).toLowerCase())) {
                task.scanned++;
                const ctime = Math.floor(s.ctimeMs / 1000);

                // 重新处理：所有都加；否则跳过已done的
                if (!reprocess && doneIndex.has(`${s.size}_${ctime}`)) {
                  task.skipped++;
                } else {
                  const mtime = Math.floor(s.mtimeMs / 1000);
                  const result = ins.run(full, s.size, mtime, ctime, basePriority);
                  if (result.changes > 0) {
                    task.added++;
                  } else {
                    // 已存在，更新为pending
                    upd.run(basePriority, full);
                    task.added++;
                  }
                }
              }
            } catch(e) {}
            if (++i % 200 === 0) await sleep();
          }
        };

        await walk(dirPath);
        task.done = true;
        task.status = "done";
      } catch(e) {
        task.done = true;
        task.status = "error";
        task.error = e.message;
      }
    })();
  });

// >>> PI_PATCH_BEGIN (派发优先级 + claim + 失败标记)
if (!app._piPatched) {
  app._piPatched = true;
  const _db0 = getDb();
  for (const ddl of [
    "ALTER TABLE photos ADD COLUMN priority INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE photos ADD COLUMN file_key TEXT",
    "ALTER TABLE photos ADD COLUMN dir TEXT",
  ]) { try { _db0.prepare(ddl).run(); } catch(e) {} }
  try { _db0.prepare("CREATE INDEX IF NOT EXISTS idx_photos_priority ON photos(priority)").run(); } catch(e) {}
  try { _db0.prepare("CREATE INDEX IF NOT EXISTS idx_photos_filekey  ON photos(file_key)").run(); } catch(e) {}

  const _fileKey = (name, size, mtime) =>
    crypto.createHash('md5').update(`${name}_${size}_${mtime}`).digest('hex');

  app.post('/api/photos/dispatch/dir2', (req, res) => {
    const { dirPath, reprocess } = req.body || {};
    if (!dirPath) return res.status(400).json({ error: '缺少dirPath' });
    const db = getDb();
    db.pragma('busy_timeout=3000');
    const EXTS  = new Set(['.jpg','.jpeg','.png','.heic','.webp','.gif','.bmp','.tiff','.raw']);
    const files = [];
    const walk  = (dir) => {
      let names; try { names = fs.readdirSync(dir); } catch(e) { return; }
      for (const name of names) {
        if (name.startsWith('.') || name.startsWith('@')) continue;
        const full = path.join(dir, name);
        let st; try { st = fs.statSync(full); } catch(e) { continue; }
        if (st.isDirectory()) walk(full);
        else if (EXTS.has(path.extname(name).toLowerCase()))
          files.push({ full, name, dir, size: st.size, mtime: Math.floor(st.mtimeMs / 1000) });
      }
    };
    walk(dirPath);
    const next     = db.prepare("SELECT COALESCE(MAX(priority),0)+1 AS p FROM photos").get().p;
    const selByKey = db.prepare("SELECT id,path,status FROM photos WHERE file_key=?");
    const delPath  = db.prepare("DELETE FROM photos WHERE path=? AND id<>?");
    const updMove  = db.prepare("UPDATE photos SET path=?, dir=?, updated_at=strftime('%s','now') WHERE id=?");
    const reqPend  = db.prepare("UPDATE photos SET status='pending', priority=?, updated_at=strftime('%s','now') WHERE id=?");
    const reqRepro = db.prepare("UPDATE photos SET status='pending', priority=?, thumb_path=NULL, preview_path=NULL, updated_at=strftime('%s','now') WHERE id=?");
    const ins      = db.prepare("INSERT INTO photos (path, dir, size, mtime, file_key, status, priority) VALUES (@path,@dir,@size,@mtime,@file_key,'pending',@priority)");
    let sent = 0;
    db.transaction(() => {
      for (const f of files) {
        const key = _fileKey(f.name, f.size, f.mtime);
        const row = selByKey.get(key);
        if (row) {
          if (row.path !== f.full) { try { delPath.run(f.full, row.id); } catch(e) {} updMove.run(f.full, f.dir, row.id); }
          if (reprocess) { reqRepro.run(next, row.id); sent++; }
          else if (row.status === 'pending' || row.status === 'error') { reqPend.run(next, row.id); sent++; }
        } else {
          ins.run({ path: f.full, dir: f.dir, size: f.size, mtime: f.mtime, file_key: key, priority: next });
          sent++;
        }
      }
    })();
    res.json({ ok: true, sent, scanned: files.length, priority: next });
  });

  app.post('/api/photos/claim', (req, res) => {
    const db = getDb();
    db.pragma('busy_timeout=3000');
    const n = Math.max(1, Math.min(50, parseInt(req.body && req.body.n) || 1));
    const dirFilter = req.body && req.body.dirFilter ? req.body.dirFilter.replace(/\\/g,'/') : null;
    const tasks = db.transaction(() => {
      const rows = dirFilter
        ? db.prepare("SELECT * FROM photos WHERE status='pending' AND path LIKE ? ORDER BY priority DESC, id ASC LIMIT ?").all(dirFilter + '%', n)
        : db.prepare("SELECT * FROM photos WHERE status='pending' ORDER BY priority DESC, id ASC LIMIT ?").all(n);
      const mark = db.prepare("UPDATE photos SET status='processing', updated_at=strftime('%s','now') WHERE id=?");
      rows.forEach(r => mark.run(r.id));
      return rows;
    })();
    res.json({ tasks });
  });

  app.post('/api/photos/fail', (req, res) => {
    const { path: p } = req.body || {};
    if (!p) return res.status(400).json({ error: '缺少path' });
    const db = getDb();
    db.pragma('busy_timeout=3000');
    db.prepare("UPDATE photos SET status='error', updated_at=strftime('%s','now') WHERE path=?").run(p);
    res.json({ ok: true });
  });
}
// <<< PI_PATCH_END
// >>> DELETE_FULL_BEGIN
  app.post('/api/photos/delete-full', async (req, res) => {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: '缺少id' });
    const db = getDb();
    db.pragma('busy_timeout=3000');
    const photo = db.prepare('SELECT * FROM photos WHERE id=?').get(id);
    if (!photo) return res.status(404).json({ error: 'not found' });
    const errors = [];
    try { if (photo.path && fs.existsSync(photo.path)) fs.unlinkSync(photo.path); }
    catch(e) { errors.push('原文件:' + e.message); }
    try { if (photo.thumb_path && fs.existsSync(photo.thumb_path)) fs.unlinkSync(photo.thumb_path); }
    catch(e) { errors.push('缩略图:' + e.message); }
    try { if (photo.preview_path && fs.existsSync(photo.preview_path)) fs.unlinkSync(photo.preview_path); }
    catch(e) { errors.push('预览图:' + e.message); }
    db.prepare('DELETE FROM photos WHERE id=?').run(id);
    res.json({ ok: true, errors });
  });
// <<< DELETE_FULL_END
// >>> DELETE_DIR_BEGIN
  app.get('/api/pc/browse', async (req, res) => {
    const pcPath = req.query.path || '';
    try {
      const cfg = loadConfig();
      const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
      if (!status || !status.online || !status.ip) return res.status(503).json({ error: 'PC端离线' });
      const url = `http://${status.ip}:8080/browse` + (pcPath ? ('?path=' + encodeURIComponent(pcPath)) : '');
      const r = await httpGet(url);
      res.json(r || []);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/pc/migrate-check', async (req, res) => {
    const { srcPath, dstRoot } = req.body || {};
    if (!srcPath || !dstRoot) return res.status(400).json({ error: '缺少srcPath或dstRoot' });
    try {
      const cfg = loadConfig();
      const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
      if (!status || !status.online || !status.ip) return res.status(503).json({ error: 'PC端离线' });
      const r = await httpPost(status.ip, 8080, '/migrate-check', { srcPath, dstRoot }, 120000);
      res.json(r || { ok: false });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/pc/migrate', async (req, res) => {
    const { srcPath, dstRoot } = req.body || {};
    if (!srcPath || !dstRoot) return res.status(400).json({ error: '缺少srcPath或dstRoot' });
    try {
      const cfg = loadConfig();
      const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
      if (!status || !status.online || !status.ip) return res.status(503).json({ error: 'PC端离线' });
      const r = await httpPost(status.ip, 8080, '/migrate', { srcPath, dstRoot }, 10000);
      res.json(r || { ok: false });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/pc/migrate-status', async (req, res) => {
    try {
      const cfg = loadConfig();
      const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
      if (!status || !status.online || !status.ip) return res.status(503).json({ error: 'PC端离线' });
      const r = await httpPost(status.ip, 8080, '/migrate-status', {}, 10000);
      res.json(r || {});
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // NAS本地实时目录列表（含空目录），用于迁移目标选择
  app.get('/api/nas/ls', (req, res) => {
    let dir = req.query.path || '/share';
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const HIDE = /^(CACHEDEV\d+_DATA|CE_CACHEDEV\d+_DATA|HD[A-Z]+_DATA|external|NFSv=4|\.|@|homes|Public|Web|Multimedia|Download|Recordings|Network Recycle Bin)/;
      const dirs = entries
        .filter(e => (e.isDirectory() || e.isSymbolicLink()) && !HIDE.test(e.name))
        .map(e => ({ name: e.name, path: (dir.replace(/\/$/,'')) + '/' + e.name }))
        .sort((a,b) => a.name.localeCompare(b.name));
      res.json({ path: dir, dirs });
    } catch(e) { res.json({ path: dir, dirs: [], error: e.message }); }
  });

  // ── 通用目录树接口：DB优先、磁盘兜底，只返回子目录列表(不算统计，快) ──
  app.get('/api/dir-tree', async (req, res) => {
    const source = req.query.source || 'nas';
    let parentPath = req.query.path || '';
    const db = getDb();

    // 无path：返回根
    if (!parentPath) {
      if (source === 'pc') {
        const roots = JSON.parse(fs.readFileSync(pcRootsPath, 'utf8').toString() || '[]');
        return res.json(roots.map(r => ({ name: r.name, path: r.path.replace(/\\/g,'/'), hasChildren: true })));
      } else {
        // NAS根：/share下SMB共享层(过滤物理层)
        try {
          const HIDE = /^(CACHEDEV\d+_DATA|CE_CACHEDEV\d+_DATA|HD[A-Z]+_DATA|external|NFSv=4|\.|@|homes|Public|Web|Multimedia|Download|Recordings|Network Recycle Bin)/;
          const entries = fs.readdirSync('/share', { withFileTypes: true });
          const dirs = entries.filter(e => (e.isDirectory()||e.isSymbolicLink()) && !HIDE.test(e.name))
            .map(e => ({ name: e.name, path: '/share/' + e.name, hasChildren: true }))
            .sort((a,b)=>a.name.localeCompare(b.name));
          return res.json(dirs);
        } catch(e) { return res.json([]); }
      }
    }

    const normParent = parentPath.replace(/\\/g,'/').replace(/\/$/,'');
    const hasPhotosOnly = req.query.hasPhotos === '1';

    // hasPhotos模式：只返回DB里有图片记录的子目录(viewer用)
    if (hasPhotosOnly) {
      const all = db.prepare("SELECT DISTINCT REPLACE(path,'\\','/') AS p FROM photos WHERE REPLACE(path,'\\','/') LIKE ?").all(normParent + '/%');
      const childSet = new Set();
      for (const row of all) {
        const rest = row.p.slice(normParent.length + 1);
        const slash = rest.indexOf('/');
        if (slash < 0) continue;
        childSet.add(rest.slice(0, slash));
      }
      const dirs = [...childSet].map(name => ({ name, path: normParent + '/' + name, hasChildren: true })).sort((a,b)=>a.name.localeCompare(b.name));
      return res.json(dirs);
    }

    // 1. 先查DB：这个目录下有没有记录
    const dbChild = db.prepare("SELECT DISTINCT REPLACE(path,'\\','/') AS p FROM photos WHERE REPLACE(path,'\\','/') LIKE ? LIMIT 1").get(normParent + '/%');

    // DB子目录 ∪ 磁盘真实子目录（并集：DB为主，磁盘补空目录/新目录）
    const childSet = new Set();
    if (dbChild) {
      const all = db.prepare("SELECT DISTINCT REPLACE(path,'\\','/') AS p FROM photos WHERE REPLACE(path,'\\','/') LIKE ?").all(normParent + '/%');
      for (const row of all) {
        const rest = row.p.slice(normParent.length + 1);
        const slash = rest.indexOf('/');
        if (slash < 0) continue;
        childSet.add(rest.slice(0, slash));
      }
    }
    // 合并磁盘真实子目录（NAS本地可直接读；PC转发）
    if (source === 'nas') {
      try {
        const HIDE = /^(@|\.)/;
        fs.readdirSync(normParent, { withFileTypes: true })
          .filter(e => e.isDirectory() && !HIDE.test(e.name))
          .forEach(e => childSet.add(e.name));
      } catch(e) {}
    } else {
      try {
        const status = await httpGet(`http://${loadConfig().nas_ip}:${loadConfig().pipe_port}/api/status`);
        if (status && status.online && status.ip) {
          const items = await httpGet(`http://${status.ip}:8080/browse?path=${encodeURIComponent(normParent)}`);
          (Array.isArray(items)?items:[]).filter(it => it.type === 'dir').forEach(it => childSet.add(it.name));
        }
      } catch(e) {}
    }
    if (childSet.size) {
      const dirs = [...childSet].map(name => ({ name, path: normParent + '/' + name, hasChildren: true })).sort((a,b)=>a.name.localeCompare(b.name));
      return res.json(dirs);
    }

    // 2. DB无记录 → 扫磁盘兜底
    if (source === 'nas') {
      try {
        const HIDE = /^(@|\.)/;
        const entries = fs.readdirSync(normParent, { withFileTypes: true });
        const dirs = entries.filter(e => e.isDirectory() && !HIDE.test(e.name))
          .map(e => ({ name: e.name, path: normParent + '/' + e.name, hasChildren: true }))
          .sort((a,b)=>a.name.localeCompare(b.name));
        return res.json(dirs);
      } catch(e) { return res.json([]); }
    } else {
      // PC：转发PC端browse
      try {
        const status = await httpGet(`http://${loadConfig().nas_ip}:${loadConfig().pipe_port}/api/status`);
        if (!status || !status.online || !status.ip) return res.json([]);
        const items = await httpGet(`http://${status.ip}:8080/browse?path=${encodeURIComponent(normParent)}`);
        const dirs = (Array.isArray(items)?items:[]).filter(it => it.type === 'dir')
          .map(it => ({ name: it.name, path: it.path.replace(/\\/g,'/'), hasChildren: true }));
        return res.json(dirs);
      } catch(e) { return res.json([]); }
    }
  });

  // ── 单目录统计：实时从photos算(含子目录) + 真实文件数(磁盘) ──
  app.get('/api/dir-stat', async (req, res) => {
    const source = req.query.source || 'nas';
    let p = req.query.path;
    if (!p) return res.status(400).json({ error: '缺少path' });
    const norm = p.replace(/\\/g,'/').replace(/\/$/,'');
    const db = getDb();
    const like = norm + '/%';
    const r = db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) done, SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) err, SUM(CASE WHEN status='pending' OR status='processing' THEN 1 ELSE 0 END) pend FROM photos WHERE REPLACE(path,'\\','/') LIKE ?").get(like);
    const dbTotal = r.total || 0;
    // DB有记录 → 返回DB统计；DB无记录 → 扫磁盘数真实图片
    if (dbTotal > 0) {
      return res.json({ path: norm, inDb: true, dbTotal, done: r.done||0, error: r.err||0, pending: r.pend||0 });
    }
    // DB无记录，数真实图片文件（递归）
    const IMG = /\.(jpe?g|png|gif|webp|bmp|tiff?|heic)$/i;
    let real = 0;
    function countDir(dir) {
      let ents;
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch(e) { return; }
      for (const e of ents) {
        if (e.isDirectory()) { if (!e.name.startsWith('@') && !e.name.startsWith('.')) countDir(dir + '/' + e.name); }
        else if (IMG.test(e.name)) real++;
        if (real > 100000) return; // 安全上限
      }
    }
    if (source === 'nas') {
      countDir(norm);
      return res.json({ path: norm, inDb: false, realCount: real, dbTotal: 0, done: 0, error: 0, pending: 0 });
    } else {
      // PC：转发PC端数图片
      try {
        const status = await httpGet(`http://${loadConfig().nas_ip}:${loadConfig().pipe_port}/api/status`);
        if (status && status.online && status.ip) {
          const cr = await httpGet(`http://${status.ip}:8080/count-images?path=${encodeURIComponent(norm)}`);
          return res.json({ path: norm, inDb: false, realCount: (cr && cr.realCount) || 0, dbTotal: 0, done: 0, error: 0, pending: 0 });
        }
      } catch(e) {}
      return res.json({ path: norm, inDb: false, realCount: null, dbTotal: 0, done: 0, error: 0, pending: 0 });
    }
  });

  // ── 迁移失败记录表 ──
  (() => {
    const db = getDb();
    try {
      db.prepare(`CREATE TABLE IF NOT EXISTS migrate_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        src_path TEXT NOT NULL,
        dst_path TEXT NOT NULL,
        error TEXT,
        migrate_batch TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      )`).run();
      db.prepare("CREATE INDEX IF NOT EXISTS idx_mf_batch ON migrate_failures(migrate_batch)").run();
      db.prepare("CREATE INDEX IF NOT EXISTS idx_mf_status ON migrate_failures(status)").run();
    } catch(e) { console.error('建表失败:', e.message); }
  })();

  // ── 迁移提交：成功的批量改DB path ──
  // ── 单条重试：查DB拿src/dst，转PC复制，成功则状态retried ──
  app.post('/api/pc/migrate-retry', async (req, res) => {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: '缺少id' });
    const db = getDb();
    const row = db.prepare("SELECT * FROM migrate_failures WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    try {
      const cfg = loadConfig();
      const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
      if (!status || !status.online || !status.ip) return res.status(503).json({ error: 'PC端离线' });
      const r = await httpPost(status.ip, 8080, '/migrate-retry-one', { srcNas: row.src_path, dstNas: row.dst_path }, 60000);
      if (r && r.success) {
        db.prepare("UPDATE migrate_failures SET status = 'retried' WHERE id = ?").run(id);
        return res.json({ success: true });
      }
      // 失败：更新error保存最新原因
      if (r && r.error) {
        db.prepare("UPDATE migrate_failures SET error = ? WHERE id = ?").run(r.error, id);
      }
      return res.json({ success: false, newError: (r && r.error) || '未知' });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── 确认完结：更新DB path + 状态resolved ──
  app.post('/api/pc/migrate-confirm', (req, res) => {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: '缺少id' });
    const db = getDb();
    const row = db.prepare("SELECT * FROM migrate_failures WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    if (row.status !== 'retried') return res.status(400).json({ error: '该记录未重试成功，不能确认' });
    try {
      const tx = db.transaction(() => {
        const dstDir = row.dst_path.substring(0, row.dst_path.lastIndexOf('/'));
        const r = db.prepare("UPDATE photos SET path = ?, dir = ? WHERE path = ?").run(row.dst_path, dstDir, row.src_path);
        db.prepare("UPDATE migrate_failures SET status = 'resolved' WHERE id = ?").run(id);
        return r.changes;
      });
      const changed = tx();
      res.json({ ok: true, photosUpdated: changed });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── NAS内部目录迁移：校验冲突 ──
  // ── NAS目录操作：新建文件夹(为后续删除/重命名等操作预留同样的接口风格) ──
  app.post('/api/nas-dir/mkdir', (req, res) => {
    const { parentPath, name } = req.body || {};
    if (!parentPath || !name) return res.status(400).json({ error: '缺少parentPath或name' });
    if (/[\\/:*?"<>|]/.test(name)) return res.status(400).json({ error: '文件夹名包含非法字符' });
    const parent = parentPath.replace(/\\/g,'/').replace(/\/$/,'');
    const newPath = parent + '/' + name;
    if (fs.existsSync(newPath)) return res.status(400).json({ error: '该文件夹已存在' });
    try {
      fs.mkdirSync(newPath, { recursive: false });
      res.json({ ok: true, path: newPath });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── NAS目录操作：删除(非空目录需二次确认,confirm=true才真正执行) ──
  app.post('/api/nas-dir/delete', (req, res) => {
    const { path: targetPath, confirm } = req.body || {};
    if (!targetPath) return res.status(400).json({ error: '缺少path' });
    const p = targetPath.replace(/\\/g,'/').replace(/\/$/,'');
    if (!fs.existsSync(p)) return res.status(400).json({ error: '目录不存在' });
    if (!fs.statSync(p).isDirectory()) return res.status(400).json({ error: '不是目录' });

    // 统计内容数量
    let fileCount = 0, dirCount = 0;
    function walk(d) {
      let ents; try { ents = fs.readdirSync(d, {withFileTypes:true}); } catch(e) { return; }
      for (const e of ents) {
        if (e.isDirectory()) { dirCount++; walk(d + '/' + e.name); }
        else fileCount++;
      }
    }
    walk(p);

    if ((fileCount > 0 || dirCount > 0) && !confirm) {
      return res.json({ ok: true, needConfirm: true, fileCount, dirCount });
    }

    try {
      // 1. 删磁盘文件
      fs.rmSync(p, { recursive: true, force: true });

      // 2. 删DB记录 + 缩略图/预览图
      const db = getDb();
      const rows = db.prepare("SELECT thumb_path, preview_path FROM photos WHERE REPLACE(path,'\\','/') LIKE ?").all(p + '/%');
      // 删缩略图文件
      const DATA_PATH = '/data/photos';
      for (const r of rows) {
        try {
          if (r.thumb_path) {
            const tf = DATA_PATH + '/thumbs/' + r.thumb_path.split('/').pop();
            if (fs.existsSync(tf)) fs.unlinkSync(tf);
          }
          if (r.preview_path) {
            const pf = DATA_PATH + '/preview/' + r.preview_path.split('/').pop();
            if (fs.existsSync(pf)) fs.unlinkSync(pf);
          }
        } catch(e2) {}
      }
      // 删DB记录
      const del = db.prepare("DELETE FROM photos WHERE REPLACE(path,'\\','/') LIKE ?");
      const result = del.run(p + '/%');

      res.json({ ok: true, deleted: true, fileCount, dirCount, dbDeleted: result.changes });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── NAS目录操作：重命名 ──
  app.post('/api/nas-dir/rename', (req, res) => {
    const { targetPath, newName } = req.body || {};
    if (!targetPath || !newName) return res.status(400).json({ error: '缺少targetPath或newName' });
    if (/[\\/:\*?"<>|]/.test(newName)) return res.status(400).json({ error: '名称包含非法字符' });
    const p = targetPath.replace(/\\/g,'/').replace(/\/$/,'');
    const parent = p.substring(0, p.lastIndexOf('/'));
    const newPath = parent + '/' + newName.trim();
    if (!fs.existsSync(p)) return res.status(400).json({ error: '目录不存在' });
    if (fs.existsSync(newPath)) return res.status(400).json({ error: '同名目录已存在' });
    try {
      fs.renameSync(p, newPath);
      // 同步更新DB里所有相关path
      const db = getDb();
      const rows = db.prepare("SELECT id, path FROM photos WHERE REPLACE(path,'\\','/') LIKE ?").all(p + '/%');
      if (rows.length > 0) {
        const upd = db.prepare("UPDATE photos SET path = ?, dir = ? WHERE id = ?");
        const tx = db.transaction(() => {
          for (const r of rows) {
            const fwd = r.path.replace(/\\/g,'/');
            const np = newPath + fwd.slice(p.length);
            upd.run(np, np.substring(0, np.lastIndexOf('/')), r.id);
          }
        });
        tx();
      }
      res.json({ ok: true, oldPath: p, newPath, dbUpdated: rows.length });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── NAS清理孤立记录(检查/share/下文件是否存在,不存在则删DB记录+缩略图) ──
  app.post('/api/nas/clean-orphan', (req, res) => {
    const { path: dirPath } = req.body || {};
    if (!dirPath) return res.status(400).json({ error: '缺少path' });
    const dir = dirPath.replace(/\\/g,'/').replace(/\/$/,'');
    const db = getDb();
    const rows = db.prepare("SELECT id, path, thumb_path, preview_path FROM photos WHERE REPLACE(path,'\\','/') LIKE ?").all(dir + '/%');
    let total = rows.length, orphan = 0, deleted = 0;
    const DATA_PATH = '/data/photos';
    const delStmt = db.prepare('DELETE FROM photos WHERE id = ?');
    const tx = db.transaction(() => {
      for (const r of rows) {
        const fwd = r.path.replace(/\\/g,'/');
        if (!fs.existsSync(fwd)) {
          orphan++;
          // 删缩略图
          try {
            if (r.thumb_path) {
              const tf = DATA_PATH + '/thumbs/' + r.thumb_path.split('/').pop();
              if (fs.existsSync(tf)) fs.unlinkSync(tf);
            }
            if (r.preview_path) {
              const pf = DATA_PATH + '/preview/' + r.preview_path.split('/').pop();
              if (fs.existsSync(pf)) fs.unlinkSync(pf);
            }
          } catch(e2) {}
          delStmt.run(r.id);
          deleted++;
        }
      }
    });
    tx();
    res.json({ ok: true, total, orphan, deleted });
  });

  app.post('/api/nas-migrate-check', (req, res) => {
    const { srcPath, dstRoot } = req.body || {};
    if (!srcPath || !dstRoot) return res.status(400).json({ error: '缺少srcPath或dstRoot' });
    const src = srcPath.replace(/\\/g,'/').replace(/\/$/,'');
    const dstR = dstRoot.replace(/\\/g,'/').replace(/\/$/,'');
    const folderName = src.split('/').filter(Boolean).pop();
    const dst = dstR + '/' + folderName;
    if (!fs.existsSync(src)) return res.json({ ok: false, error: '源目录不存在' });
    if (fs.existsSync(dst)) return res.json({ ok: true, hasConflict: true, dst, conflictReason: '目标位置已存在同名目录: ' + dst });
    // 统计源目录文件数(用于显示)
    let total = 0;
    function count(d) {
      let ents; try { ents = fs.readdirSync(d, {withFileTypes:true}); } catch(e) { return; }
      for (const e of ents) {
        if (e.isDirectory()) count(d + '/' + e.name);
        else total++;
      }
    }
    count(src);
    res.json({ ok: true, hasConflict: false, dst, total });
  });

  // ── NAS内部目录迁移：执行mv + 改DB ──
  app.post('/api/nas-migrate', (req, res) => {
    const { srcPath, dstRoot } = req.body || {};
    if (!srcPath || !dstRoot) return res.status(400).json({ error: '缺少srcPath或dstRoot' });
    const src = srcPath.replace(/\\/g,'/').replace(/\/$/,'');
    const dstR = dstRoot.replace(/\\/g,'/').replace(/\/$/,'');
    const folderName = src.split('/').filter(Boolean).pop();
    const dst = dstR + '/' + folderName;
    if (!fs.existsSync(src)) return res.status(400).json({ error: '源目录不存在' });
    if (fs.existsSync(dst)) return res.status(400).json({ error: '目标已存在,请先处理冲突' });

    const db = getDb();
    const batchId = 'nasmv_' + Date.now();
    try {
      // 1. mv(原子操作)
      fs.mkdirSync(dstR, { recursive: true });
      fs.renameSync(src, dst);
    } catch(e) {
      // mv失败：整体记一条失败
      try {
        db.prepare("INSERT INTO migrate_failures (src_path, dst_path, error, migrate_batch) VALUES (?, ?, ?, ?)")
          .run(src, dst, 'mv失败: ' + e.message, batchId);
      } catch(e2) {}
      return res.status(500).json({ error: 'mv失败: ' + e.message, batch: batchId });
    }

    // 2. mv成功：批量改DB(前缀替换)
    try {
      const rows = db.prepare("SELECT id, path FROM photos WHERE REPLACE(path,'\\','/') LIKE ?").all(src + '/%');
      const upd = db.prepare("UPDATE photos SET path = ?, dir = ? WHERE id = ?");
      let updated = 0;
      const tx = db.transaction(() => {
        for (const r of rows) {
          const fwd = r.path.replace(/\\/g,'/');
          const newPath = dst + fwd.slice(src.length);
          const newDir = newPath.substring(0, newPath.lastIndexOf('/'));
          upd.run(newPath, newDir, r.id);
          updated++;
        }
      });
      tx();
      res.json({ ok: true, moved: true, dst, dbUpdated: updated, total: rows.length });
    } catch(e) {
      // DB更新失败,但文件已经移动成功了,记一条失败让用户知道要手动处理DB
      try {
        db.prepare("INSERT INTO migrate_failures (src_path, dst_path, error, migrate_batch) VALUES (?, ?, ?, ?)")
          .run(src, dst, '文件已移动但DB更新失败: ' + e.message, batchId);
      } catch(e2) {}
      res.status(500).json({ error: 'DB更新失败(文件已移动): ' + e.message, batch: batchId });
    }
  });

  app.post('/api/migrate-commit', (req, res) => {
    const { updates } = req.body || {};
    if (!Array.isArray(updates) || !updates.length) return res.json({ ok: true, updated: 0 });
    const db = getDb();
    const upd = db.prepare("UPDATE photos SET path = ?, dir = ? WHERE path = ?");
    let updated = 0;
    try {
      const tx = db.transaction((items) => {
        for (const it of items) {
          const dstDir = it.dst.substring(0, it.dst.lastIndexOf('/'));
          const r = upd.run(it.dst, dstDir, it.src);
          updated += r.changes;
        }
      });
      tx(updates);
      res.json({ ok: true, updated });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 记录迁移失败 ──
  app.post('/api/migrate-failures', (req, res) => {
    const { batch, failures } = req.body || {};
    if (!batch || !Array.isArray(failures) || !failures.length) return res.json({ ok: true, inserted: 0 });
    const db = getDb();
    const ins = db.prepare("INSERT INTO migrate_failures (src_path, dst_path, error, migrate_batch) VALUES (?, ?, ?, ?)");
    let n = 0;
    try {
      const tx = db.transaction((items) => {
        for (const f of items) { ins.run(f.src, f.dst, f.error || '', batch); n++; }
      });
      tx(failures);
      res.json({ ok: true, inserted: n });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // ── 查询失败记录(状态pending的) ──
  app.get('/api/migrate-failures', (req, res) => {
    const db = getDb();
    const status = req.query.status || 'pending';
    const rows = db.prepare("SELECT * FROM migrate_failures WHERE status = ? ORDER BY created_at DESC LIMIT 500").all(status);
    res.json(rows);
  });

  // ── 失败记录数量(用于按钮上的N) ──
  app.get('/api/migrate-failures/count', (req, res) => {
    const db = getDb();
    const r = db.prepare("SELECT COUNT(*) AS n FROM migrate_failures WHERE status = 'pending'").get();
    res.json({ count: r.n || 0 });
  });

  // ── 标记记录已完结/放弃/重置 ──
  app.post('/api/migrate-failures/update', (req, res) => {
    const { id, status } = req.body || {};
    if (!id || !status) return res.status(400).json({ error: '缺少id或status' });
    const db = getDb();
    const r = db.prepare("UPDATE migrate_failures SET status = ? WHERE id = ?").run(status, id);
    res.json({ ok: true, changed: r.changes });
  });

  // ── 删除记录(放弃时直接清掉) ──
  app.post('/api/migrate-failures/delete', (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.json({ ok: true, deleted: 0 });
    const db = getDb();
    const ph = ids.map(()=>'?').join(',');
    const r = db.prepare(`DELETE FROM migrate_failures WHERE id IN (${ph})`).run(...ids);
    res.json({ ok: true, deleted: r.changes });
  });

  app.get('/api/pc/all-dirs', (req, res) => {
    const db = getDb();
    // 拉所有PC记录，按"文件所在目录"聚合统计
    const rows = db.prepare(`
      SELECT REPLACE(path,'\\','/') AS p, status
      FROM photos
      WHERE path LIKE 'D:%' OR path LIKE 'E:%' OR path LIKE 'F:%'
    `).all();
    const map = new Map(); // dir -> {total,done,error,pending}
    for (const r of rows) {
      const idx = r.p.lastIndexOf('/');
      if (idx < 0) continue;
      const dir = r.p.slice(0, idx);
      if (!map.has(dir)) map.set(dir, { total:0, done:0, error:0, pending:0 });
      const s = map.get(dir);
      s.total++;
      if (r.status === 'done') s.done++;
      else if (r.status === 'error') s.error++;
      else s.pending++;
    }
    const list = [...map.entries()].map(([dir, s]) => ({
      path: dir,
      name: dir.split('/').filter(Boolean).pop(),
      total: s.total, done: s.done, error: s.error, pending: s.pending
    }));
    res.json(list);
  });

  app.get('/api/pc/all-dirs', (req, res) => {
    const db = getDb();
    // 拉所有PC记录，按"文件所在目录"聚合统计
    const rows = db.prepare(`
      SELECT REPLACE(path,'\\','/') AS p, status
      FROM photos
      WHERE path LIKE 'D:%' OR path LIKE 'E:%' OR path LIKE 'F:%'
    `).all();
    const map = new Map(); // dir -> {total,done,error,pending}
    for (const r of rows) {
      const idx = r.p.lastIndexOf('/');
      if (idx < 0) continue;
      const dir = r.p.slice(0, idx);
      if (!map.has(dir)) map.set(dir, { total:0, done:0, error:0, pending:0 });
      const s = map.get(dir);
      s.total++;
      if (r.status === 'done') s.done++;
      else if (r.status === 'error') s.error++;
      else s.pending++;
    }
    const list = [...map.entries()].map(([dir, s]) => ({
      path: dir,
      name: dir.split('/').filter(Boolean).pop(),
      total: s.total, done: s.done, error: s.error, pending: s.pending
    }));
    res.json(list);
  });

  app.post('/api/pc/process-dir', async (req, res) => {
    const { path: pcPath } = req.body || {};
    if (!pcPath) return res.status(400).json({ error: '缺少path' });
    try {
      const cfg = loadConfig();
      const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
      if (!status || !status.online || !status.ip) return res.status(503).json({ error: 'PC端离线' });
      const r = await httpPost(status.ip, 8080, '/process-dir', { pcPath }, 10000);
      res.json(r || { ok: false });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/pc/kill-workers', async (req, res) => {
    try {
      const cfg = loadConfig();
      const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
      if (!status || !status.online || !status.ip) return res.status(503).json({ error: 'PC端离线' });
      const r = await httpPost(status.ip, 8080, '/kill-workers', {}, 10000);
      res.json(r || { ok: false });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/pc/worker-status', async (req, res) => {
    try {
      const cfg = loadConfig();
      const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
      if (!status || !status.online || !status.ip) return res.status(503).json({ error: 'PC端离线' });
      const r = await httpPost(status.ip, 8080, '/worker-status', {}, 10000);
      res.json(r || { running: [], queued: [], max: 5 });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/pc/clean-orphan', async (req, res) => {
    const { path: pcPath } = req.body || {};
    if (!pcPath) return res.status(400).json({ error: '缺少path' });
    try {
      const cfg = loadConfig();
      const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
      if (!status || !status.online || !status.ip) {
        return res.status(503).json({ error: 'PC端离线' });
      }
      // 同步等PC处理完，透传结果(超时5分钟，大目录检查慢)
      const result = await httpPost(status.ip, 8080, '/clean-orphan', { pcPath }, 300000);
      if (result && result.ok) {
        res.json(result);
      } else {
        res.status(500).json({ error: (result && result.error) || 'PC端处理失败或超时' });
      }
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/photos/delete-by-ids', (req, res) => {
    const { ids } = req.body || {};
    if (!ids || !ids.length) return res.json({ ok: true, deleted: 0 });
    const db = getDb();
    db.pragma('busy_timeout=3000');
    const sel = db.prepare("SELECT id, thumb_path, preview_path FROM photos WHERE id=?");
    const del = db.prepare("DELETE FROM photos WHERE id=?");
    let deleted = 0;
    db.transaction(() => {
      for (const id of ids) {
        const row = sel.get(id);
        if (!row) continue;
        try { if (row.thumb_path   && fs.existsSync(row.thumb_path))   fs.unlinkSync(row.thumb_path); }   catch(e) {}
        try { if (row.preview_path && fs.existsSync(row.preview_path)) fs.unlinkSync(row.preview_path); } catch(e) {}
        del.run(id);
        deleted++;
      }
    })();
    res.json({ ok: true, deleted });
  });

  app.post('/api/photos/delete-dir', async (req, res) => {
    const { dirPath } = req.body || {};
    if (!dirPath) return res.status(400).json({ error: '缺少dirPath' });
    const isPc = /^[A-Za-z]:/.test(dirPath);
    const db = getDb();
    db.pragma('busy_timeout=3000');
    const errors = [];

    if (isPc) {
      // PC目录：NAS只删DB记录+NAS缩略图/预览图，原图交给PC端删
      const fwd = dirPath.replace(/\\/g, '/');
      const photos = db.prepare("SELECT * FROM photos WHERE REPLACE(path,'\\','/') LIKE ?").all(fwd + '/%');
      for (const photo of photos) {
        try { if (photo.thumb_path   && fs.existsSync(photo.thumb_path))   fs.unlinkSync(photo.thumb_path); }   catch(e) {}
        try { if (photo.preview_path && fs.existsSync(photo.preview_path)) fs.unlinkSync(photo.preview_path); } catch(e) {}
      }
      db.prepare("DELETE FROM photos WHERE REPLACE(path,'\\','/') LIKE ?").run(fwd + '/%');
      // 通知PC端删本地原图
      let pcDeleted = false;
      try {
        const cfg = loadConfig();
        const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
        if (status && status.online && status.ip) {
          await httpPost(status.ip, 8080, '/delete-dir', { pcPath: dirPath }, 60000);
          pcDeleted = true;
        }
      } catch(e) { errors.push('通知PC删除失败:' + e.message); }
      return res.json({ ok: true, deleted: photos.length, pcDeleted, errors });
    }

    // NAS目录：直接删原文件+缩略图+DB+目录
    if (!dirPath.startsWith('/share/')) return res.status(403).json({ error: 'NAS路径只允许/share/下' });
    const photos = db.prepare("SELECT * FROM photos WHERE path LIKE ?").all(dirPath + '/%');
    for (const photo of photos) {
      try { if (photo.path         && fs.existsSync(photo.path))         fs.unlinkSync(photo.path); }         catch(e) { errors.push(photo.path + ':' + e.message); }
      try { if (photo.thumb_path   && fs.existsSync(photo.thumb_path))   fs.unlinkSync(photo.thumb_path); }   catch(e) {}
      try { if (photo.preview_path && fs.existsSync(photo.preview_path)) fs.unlinkSync(photo.preview_path); } catch(e) {}
    }
    db.prepare("DELETE FROM photos WHERE path LIKE ?").run(dirPath + '/%');
    try { fs.rmSync(dirPath, { recursive: true, force: true }); }
    catch(e) { errors.push('删目录:' + e.message); }
    res.json({ ok: true, deleted: photos.length, errors });
  });
// <<< DELETE_DIR_END
// >>> SUBMIT_SCAN_BEGIN
  app.post('/api/pc/submit-scan', (req, res) => {
    const { pcPath, files } = req.body || {};
    if (!pcPath || !files) return res.status(400).json({ error: '缺少参数' });
    const db = getDb();
    db.pragma('busy_timeout=3000');
    const next     = db.prepare("SELECT COALESCE(MAX(priority),0)+1 AS p FROM photos").get().p;
    const selByKey = db.prepare("SELECT id,path,status FROM photos WHERE file_key=?");
    const ins      = db.prepare("INSERT OR IGNORE INTO photos (path,dir,size,mtime,file_key,status,priority) VALUES (@path,@dir,@size,@mtime,@file_key,'pending',@priority)");
    const updPend  = db.prepare("UPDATE photos SET status='pending',priority=?,updated_at=strftime('%s','now') WHERE id=?");
    let sent = 0;
    db.transaction(() => {
      for (const f of files) {
        const key = crypto.createHash('md5').update(`${f.name}_${f.size}_${f.mtime}`).digest('hex');
        const row = selByKey.get(key);
        if (row) {
          if (row.status !== 'done') { updPend.run(next, row.id); sent++; }
        } else {
          const dir = f.path.substring(0, f.path.lastIndexOf('/'));
          ins.run({ path: f.path, dir, size: f.size, mtime: f.mtime, file_key: key, priority: next });
          sent++;
        }
      }
    })();
    res.json({ ok: true, sent, total: files.length });
  });
// <<< SUBMIT_SCAN_END
// >>> PC_STATS_BEGIN
  app.get('/api/photos/done-keys', (req, res) => {
    const db = getDb();
    const rows = db.prepare("SELECT file_key FROM photos WHERE status='done' AND file_key IS NOT NULL").all();
    res.json({ keys: rows.map(r => r.file_key) });
  });

  app.post('/api/pc/update-dir-stats', (req, res) => {
    const { dirStats } = req.body || {};
    if (!dirStats) return res.status(400).json({ error: '缺少dirStats' });
    const db  = getDb();
    db.pragma('busy_timeout=3000');
    const now = Math.floor(Date.now() / 1000);
    const ins = db.prepare("INSERT OR REPLACE INTO pc_dir_stats (path, total_files, done_files, updated_at) VALUES (?, ?, ?, ?)");
    db.transaction(() => {
      for (const [p, st] of Object.entries(dirStats)) {
        ins.run(p, st.total, st.done||0, now);
      }
    })();
    res.json({ ok: true, count: Object.keys(dirStats).length });
  });
// <<< PC_STATS_END
// >>> PC_DIR_CHILDREN_BEGIN
  app.get('/api/pc/dir-children', (req, res) => {
    let parentPath = req.query.path;
    if (!parentPath) return res.status(400).json({ error: '缺少path' });
    parentPath = parentPath.replace(/\//g, '\\');
    const db = getDb();
    // self=1 返回自身统计：实时从photos表算(含子目录)
    if (req.query.self === '1') {
      const fwd = parentPath.replace(/\\/g, '/');
      const like = fwd.replace(/\/$/, '') + '/%';
      const r = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done FROM photos WHERE REPLACE(path,'\\','/') LIKE ?").get(like);
      return res.json({ path: parentPath, total: r.total || 0, done: r.done || 0 });
    }
    // 实时从photos表算直接子目录统计(绕过缓存表脱节问题)
    const normParent = parentPath.replace(/\\/g, '/').replace(/\/$/, '');
    const all = db.prepare("SELECT REPLACE(path,'\\','/') AS p, status FROM photos WHERE REPLACE(path,'\\','/') LIKE ?").all(normParent + '/%');
    const childMap = new Map();  // 子目录名 -> {total, done}
    for (const row of all) {
      const rest = row.p.slice(normParent.length + 1);
      const slash = rest.indexOf('/');
      if (slash < 0) continue;  // 文件直接在父目录下，不是子目录
      const childName = rest.slice(0, slash);
      const childPath = normParent + '/' + childName;
      if (!childMap.has(childPath)) childMap.set(childPath, { total: 0, done: 0 });
      const st = childMap.get(childPath);
      st.total++;
      if (row.status === 'done') st.done++;
    }
    const rows = [...childMap.entries()].map(([p, st]) => ({ path: p, total: st.total, done: st.done }));
    res.json(rows.map(r => ({
      path:        r.path,
      name:        r.path.split('/').pop(),
      hasChildren: true,
      total:       r.total,
      done:        r.done,
    })));
  });
// <<< PC_DIR_CHILDREN_END
// >>> BOOST_PRIORITY_BEGIN
  app.post('/api/photos/boost-priority', (req, res) => {
    const { dirPath } = req.body || {};
    if (!dirPath) return res.status(400).json({ error: '缺少dirPath' });
    const db   = getDb();
    db.pragma('busy_timeout=3000');
    const next = db.prepare("SELECT COALESCE(MAX(priority),0)+1 AS p FROM photos").get().p;
    const r    = db.prepare(
      "UPDATE photos SET priority=?, updated_at=strftime('%s','now') WHERE path LIKE ? AND status='pending'"
    ).run(next, dirPath + '%');
    res.json({ ok: true, boosted: r.changes });
  });
// <<< BOOST_PRIORITY_END
// >>> PROCESS_LOG_BEGIN
  (() => {
    const db = getDb();
    try { db.prepare("CREATE TABLE IF NOT EXISTS process_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')))").run(); } catch(e) {}
    try { db.prepare("CREATE INDEX IF NOT EXISTS idx_logs_status ON process_logs(status)").run(); } catch(e) {}
    try { db.prepare("CREATE INDEX IF NOT EXISTS idx_logs_created ON process_logs(created_at)").run(); } catch(e) {}
  })();

  app.post('/api/process-logs/add', (req, res) => {
    const { path: p, status, error } = req.body || {};
    if (!p || !status) return res.status(400).json({ error: '缺少参数' });
    const db = getDb();
    db.prepare("INSERT INTO process_logs (path, status, error) VALUES (?, ?, ?)").run(p, status, error||null);
    res.json({ ok: true });
  });

  app.get('/api/process-logs', (req, res) => {
    const { path: p, status, dateFrom, dateTo, page=1, limit=50 } = req.query;
    const db = getDb();
    const offset = (parseInt(page)-1) * parseInt(limit);
    const sortCol = ['created_at','path','status'].includes(req.query.sort) ? req.query.sort : 'created_at';
    const sortOrd = req.query.order === 'asc' ? 'ASC' : 'DESC';
    if (status === 'processing' || status === 'pending') {
      const pconds = [`status='${status}'`]; const pparams = [];
      if (p) { pconds.push("path LIKE ?"); pparams.push('%'+p+'%'); }
      const pwhere = 'WHERE ' + pconds.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) as cnt FROM photos ${pwhere}`).get(...pparams).cnt;
      const rows  = db.prepare(`SELECT id, path, status, NULL as error, updated_at as created_at FROM photos ${pwhere} ORDER BY priority DESC, updated_at DESC LIMIT ? OFFSET ?`).all(...pparams, parseInt(limit), offset);
      return res.json({ rows, total, page: parseInt(page), limit: parseInt(limit) });
    }
    const conds = []; const params = [];
    if (p)        { conds.push("path LIKE ?");    params.push('%'+p+'%'); }
    if (status)   { conds.push("status = ?");      params.push(status); }
    if (dateFrom) { conds.push("created_at >= ?"); params.push(parseInt(dateFrom)); }
    if (dateTo)   { conds.push("created_at <= ?"); params.push(parseInt(dateTo)); }
    const where  = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total  = db.prepare(`SELECT COUNT(*) as cnt FROM process_logs ${where}`).get(...params).cnt;
    const rows   = db.prepare(`SELECT * FROM process_logs ${where} ORDER BY ${sortCol} ${sortOrd} LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
    res.json({ rows, total, page: parseInt(page), limit: parseInt(limit) });
  });
// >>> TIMEOUT_RESET_BEGIN
  setInterval(() => {
    const db      = getDb();
    const timeout = Math.floor(Date.now() / 1000) - 600;
    const r       = db.prepare("UPDATE photos SET status='pending' WHERE status='processing' AND updated_at < ?").run(timeout);
    if (r.changes > 0) console.log(`[超时重置] ${r.changes} 张图片重置为pending`);
  }, 60000);
// <<< TIMEOUT_RESET_END
// >>> LOG_DELETE_BEGIN
  app.delete('/api/process-logs', (req, res) => {
    const { ids, status } = req.body || {};
    const db = getDb();
    if (ids && ids.length) {
      db.transaction(() => { ids.forEach(id => db.prepare("DELETE FROM process_logs WHERE id=?").run(id)); })();
      return res.json({ ok: true, deleted: ids.length });
    }
    if (status) {
      const r = db.prepare("DELETE FROM process_logs WHERE status=?").run(status);
      return res.json({ ok: true, deleted: r.changes });
    }
    const r = db.prepare("DELETE FROM process_logs").run();
    res.json({ ok: true, deleted: r.changes });
  });
// <<< LOG_DELETE_END
// >>> REPROCESS_LOG_BEGIN
  app.post('/api/process-logs/reprocess', (req, res) => {
    const { ids } = req.body || {};
    if (!ids || !ids.length) return res.status(400).json({ error: '缺少ids' });
    const db = getDb();
    db.pragma('busy_timeout=3000');
    const next = db.prepare("SELECT COALESCE(MAX(priority),0)+1 AS p FROM photos").get().p;
    const getLog = db.prepare("SELECT path FROM process_logs WHERE id=?");
    let sent = 0;
    db.transaction(() => {
      for (const id of ids) {
        const log = getLog.get(id);
        if (!log) continue;
        db.prepare("UPDATE photos SET status='pending', priority=?, thumb_path=NULL, preview_path=NULL, updated_at=strftime('%s','now') WHERE path=?").run(next, log.path);
        sent++;
      }
    })();
    res.json({ ok: true, sent });
  });
// <<< REPROCESS_LOG_END
  app.post('/api/db/batch', (req, res) => {
    const { sqls } = req.body || {};
    if (!sqls || !sqls.length) return res.status(400).json({ error: '缺少sqls' });
    const db = getDb();
    db.pragma('busy_timeout=5000');
    let done = 0, fail = 0, errors = [];
    db.transaction(() => {
      for (const sql of sqls) {
        try { db.prepare(sql).run(); done++; }
        catch(e) { fail++; errors.push(e.message); }
      }
    })();
    res.json({ ok: true, done, fail, errors: errors.slice(0,5) });
  });

  app.post('/api/pc/write-md5', (req, res) => {
    const { path: pcPath } = req.body || {};
    if (!pcPath) return res.status(400).json({ error: '缺少path' });
    const taskId = String(Date.now());
    res.json({ ok: true, taskId });
    (async () => {
      try {
        const cfg    = loadConfig();
        const status = await httpGet(`http://${cfg.nas_ip}:${cfg.pipe_port}/api/status`);
        if (!status || !status.online || !status.ip) return;
        await httpPost(status.ip, 8080, '/write-md5', { pcPath, taskId }, 1800000);
      } catch(e) { console.log('[write-md5]', e.message); }
    })();
  });

  app.post('/api/pc/cleanup-orphans', require('express').json({limit:'10mb'}), (req, res) => {
    const { rootPath, paths, final } = req.body || {};
    if (!rootPath || !paths) return res.status(400).json({ error: '缺少参数' });
    const db   = getDb();
    const root = rootPath.replace(/\\/g, '/');
    if (!global.orphanCache) global.orphanCache = {};
    if (!global.orphanCache[root]) global.orphanCache[root] = new Set();
    paths.forEach(p => global.orphanCache[root].add(p.replace(/\\/g, '/')));
    if (final) {
      const scanned  = global.orphanCache[root];
      const dbRows   = db.prepare("SELECT id,path FROM photos WHERE path LIKE ?").all(root + '%');
      const toDelete = dbRows.filter(r => !scanned.has(r.path.replace(/\\/g, '/')));
      if (toDelete.length > 0) {
        const del = db.prepare("DELETE FROM photos WHERE id=?");
        db.transaction(() => toDelete.forEach(r => del.run(r.id)))();
        console.log('[清理孤立]', root, '删除', toDelete.length, '条');
      }
      delete global.orphanCache[root];
      return res.json({ ok: true, deleted: toDelete.length });
    }
    res.json({ ok: true, cached: global.orphanCache[root].size });
  });
};
