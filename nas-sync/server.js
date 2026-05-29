const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app    = express();
const PORT   = 3040;
const CONFIG = '/data/sync-config.json';
const LOG    = '/data/sync-log.json';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 配置读写 ──────────────────────────────────────────
const DEFAULT_CONFIG = {
  dirs: [
    { id:'1', nas:'/share/Photos',    pc:'D:\\cloud\\Photos',    enabled:true },
    { id:'2', nas:'/share/Documents', pc:'D:\\cloud\\Documents', enabled:true },
  ],
  filters: {
    excludeExt:  ['.tmp', '.log', '.DS_Store', '.bak', '.lock'],
    excludeDir:  ['node_modules', '.git', 'temp', '@Recycle'],
    excludeGlob: ['~$*', '*.tmp', 'Thumbs.db'],
    minSize:     0,
    maxSize:     524288000,
  }
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG)) return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch(e) {}
  return DEFAULT_CONFIG;
}

function saveConfig(cfg) {
  const dir = path.dirname(CONFIG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
}

// ── 变更日志读写 ──────────────────────────────────────
function loadLog() {
  try {
    if (fs.existsSync(LOG)) return JSON.parse(fs.readFileSync(LOG, 'utf8'));
  } catch(e) {}
  return [];
}

function saveLog(logs) {
  fs.writeFileSync(LOG, JSON.stringify(logs.slice(-1000), null, 2)); // 最多保留1000条
}

function addLog(entry) {
  const logs = loadLog();
  logs.push({ ...entry, time: new Date().toISOString() });
  saveLog(logs);
}

// ── API ───────────────────────────────────────────────
// 获取配置
app.get('/api/config', (req, res) => res.json(loadConfig()));

// 保存配置
app.post('/api/config', (req, res) => {
  saveConfig(req.body);
  res.json({ ok: true });
});

// 获取变更日志
app.get('/api/log', (req, res) => {
  const logs  = loadLog();
  const type  = req.query.type;
  const q     = req.query.q;
  let filtered = type ? logs.filter(l => l.event === type) : logs;
  if (q) filtered = filtered.filter(l => l.path && l.path.includes(q));
  res.json(filtered.reverse().slice(0, 200));
});

// 清空日志
app.delete('/api/log', (req, res) => {
  saveLog([]);
  res.json({ ok: true });
});

// 添加变更记录（由inotify脚本调用）
app.post('/api/log', (req, res) => {
  addLog(req.body);
  res.json({ ok: true });
});

// 电脑状态
let pcOnline   = false;
let lastSync   = null;
let pendingCount = 0;

app.get('/api/status', (req, res) => {
  res.json({ pcOnline, lastSync, pendingCount });
});

app.post('/api/status', (req, res) => {
  if (req.body.pcOnline !== undefined) pcOnline   = req.body.pcOnline;
  if (req.body.lastSync !== undefined) lastSync   = req.body.lastSync;
  if (req.body.pendingCount !== undefined) pendingCount = req.body.pendingCount;
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => console.log(`NAS Sync running on port ${PORT}`));
