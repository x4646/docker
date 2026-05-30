const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const { spawnSync, spawn } = require('child_process');

const app    = express();
const PORT   = 3020;
const DATA   = '/data/dashboard/buttons.json';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── 自动扫描modules ───────────────────────────────────
const modulesDir = path.join(__dirname, 'modules');
const modules    = {};

fs.readdirSync(modulesDir)
  .filter(f => f.endsWith('.js'))
  .forEach(f => {
    const key = f.replace('.js', '');
    try {
      modules[key] = require(path.join(modulesDir, f));
      console.log(`✅ 模块加载：${key}`);
    } catch(e) {
      console.error(`❌ 模块加载失败：${key}`, e.message);
    }
  });

// ── 按钮配置 ──────────────────────────────────────────
const DEFAULT_BUTTONS = [];

function loadButtons() {
  try {
    if (fs.existsSync(DATA)) return JSON.parse(fs.readFileSync(DATA, 'utf8'));
  } catch(e) {}
  return DEFAULT_BUTTONS;
}

function saveButtons(buttons) {
  const dir = path.dirname(DATA);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(buttons, null, 2));
}

// ── API ───────────────────────────────────────────────
app.get('/api/modules', (req, res) => {
  const list = Object.entries(modules).map(([key, mod]) => ({
    key,
    name:        mod.name,
    description: mod.description,
    icon:        mod.icon,
  }));
  res.json(list);
});

app.get('/api/buttons',  (req, res) => res.json(loadButtons()));
app.post('/api/buttons', (req, res) => { saveButtons(req.body); res.json({ ok: true }); });

// ── 执行按钮 ──────────────────────────────────────────
app.post('/api/execute/:id', async (req, res) => {
  const buttons = loadButtons();
  const btn     = buttons.find(b => b.id === req.params.id);
  if (!btn) return res.status(404).json({ error: '按钮不存在' });

  try {
    // SSH命令：判断是否需要后台执行
    if (btn.type === 'ssh') {
      const cmd    = btn.command;
      const parts  = cmd.split(' ').filter(Boolean);
	  
	  // 重启Dashboard自身，延迟执行
      if (cmd.includes('restart-nas-dashboard')) {
        setTimeout(() => {
          spawn('nsenter', ['-t', '1', '-m', '-u', '-i', '-n', 'sh', '-c', 'sleep 3 && sh /share/Container/docker/scripts/restart-nas-dashboard.sh &'], { detached: true, stdio: 'ignore' }).unref();
        }, 2000);
        return res.json({ type: 'toast', data: '✅ 控制面板将在2秒后重启' });
      }

      // 包含rebuild或脚本路径时异步执行
      const isLong = cmd.includes('.sh') || cmd.includes('build') || cmd.includes('rebuild') || cmd.includes('logs');

      if (isLong) {
        // 异步后台执行
        const child = spawn(parts[0], parts.slice(1), {
          detached: true,
          stdio:    'ignore',
        });
        child.unref();
        return res.json({ type: 'toast', data: '✅ 已在后台执行，需要几分钟完成' });
      }

      // 普通命令同步执行
      const result = spawnSync(parts[0], parts.slice(1), {
        encoding: 'utf8',
        timeout:  15000,
      });

      if (result.error) return res.json({ type: 'error', data: result.error.message });
      return res.json({ type: 'text', data: result.stdout || result.stderr || '执行完成' });
    }

    // 模块类型
    if (btn.type === 'module') {
      const mod = modules[btn.module];
      if (!mod) return res.json({ type: 'error', data: `模块不存在：${btn.module}` });
      const result = await mod.execute(btn.params || {});
      return res.json(result);
    }

    res.json({ type: 'error', data: '未知类型' });

  } catch(e) {
    res.json({ type: 'error', data: e.message });
  }
});

// ── Bot专用接口 ───────────────────────────────────────
app.get('/api/bot/buttons', (req, res) => {
  const btns = loadButtons().map(b => ({
    id:      b.id,
    name:    b.name,
    icon:    b.icon,
    display: b.display,
    order:   b.order,
  }));
  res.json(btns);
});

app.post('/api/bot/execute/:id', async (req, res) => {
  const buttons = loadButtons();
  const btn     = buttons.find(b => b.id === req.params.id);
  if (!btn) return res.json({ text: '❌ 功能不存在' });

  try {
    let result;

    if (btn.type === 'ssh') {
      const parts = btn.command.split(' ').filter(Boolean);
      const isLong = btn.command.includes('.sh') || btn.command.includes('build');

      if (isLong) {
        const child = spawn(parts[0], parts.slice(1), { detached: true, stdio: 'ignore' });
        child.unref();
        result = { type: 'toast', data: '✅ 已在后台执行' };
      } else {
        const r = spawnSync(parts[0], parts.slice(1), { encoding: 'utf8', timeout: 15000 });
        result  = { type: 'text', data: r.stdout || r.stderr || '执行完成' };
      }
    }

    if (btn.type === 'module') {
      const mod = modules[btn.module];
      if (!mod) return res.json({ text: `❌ 模块不存在：${btn.module}` });
      result = await mod.execute(btn.params || {});
    }

    res.json({ text: formatForTelegram(btn, result) });

  } catch(e) {
    res.json({ text: `❌ 执行失败：${e.message}` });
  }
});

function formatForTelegram(btn, result) {
  if (!result) return '❌ 无返回结果';
  if (result.type === 'error') return `❌ ${result.data}`;
  if (result.type === 'toast') return `✅ ${result.data}`;
  if (result.type === 'text')  return `${btn.icon} ${btn.name}\n\n${String(result.data).substring(0, 3000)}`;
  if (result.type === 'table' && Array.isArray(result.data)) {
    const rows  = result.data.slice(0, 20);
    if (!rows.length) return `${btn.icon} ${btn.name}\n\n无数据`;
    const keys  = Object.keys(rows[0]);
    const lines = rows.map(row => keys.map(k => `${k}：${row[k]??'-'}`).join('  '));
    return `${btn.icon} ${btn.name}\n\n${lines.join('\n')}`;
  }
  if (result.type === 'card' && typeof result.data === 'object') {
    return `${btn.icon} ${btn.name}\n\n${Object.entries(result.data).map(([k,v]) => `${k}：${v}`).join('\n')}`;
  }
  return `${btn.icon} ${btn.name}\n\n执行完成`;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`NAS Dashboard running on port ${PORT}`);
  console.log(`已加载模块：${Object.keys(modules).join(', ')}`);
});
