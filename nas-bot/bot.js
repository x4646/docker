const https = require('https');
const http  = require('http');
const { execSync } = require('child_process');

const TOKEN  = '8838005992:AAEETKYczov8IwloZdNOESpOWVgwnSpmb9U';
const ADMIN  = '6423823321';

const TOOLS = {
  'stock-monitor': { name: '股票监控', port: 3000 },
};

const KEYBOARD = {
  keyboard: [
    ['📈 股票状态', '▶️ 股票开启', '⏹️ 股票关闭'],
    ['💾 系统状态', '🐳 容器列表', '🌐 股票链接'],
    ['❓ 帮助']
  ],
  resize_keyboard: true,
  persistent: true
};

const BTN_MAP = {
  '📈 股票状态': '股票 状态',
  '▶️ 股票开启': '股票 开启',
  '⏹️ 股票关闭': '股票 关闭',
  '🌐 股票链接': '股票 链接',
  '💾 系统状态': '系统 状态',
  '🐳 容器列表': '系统 容器',
  '❓ 帮助':    '帮助',
};

function apiRequest(method, params) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(params));
    const req = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + TOKEN + '/' + method,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

function send(chatId, text) {
  if (text.length > 4000) text = text.substring(0, 4000) + '\n...(截断)';
  return apiRequest('sendMessage', { chat_id: chatId, text, reply_markup: KEYBOARD });
}

function askOllama(prompt) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify({
      model: 'qwen2.5:1.5b',
      prompt,
      stream: false
    }));
    const req = http.request({
      hostname: '192.168.0.3',
      port: 11434,
      path: '/api/generate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).response || '无回复'); }
        catch(e) { resolve('解析失败'); }
      });
    });
    req.on('error', () => resolve('Ollama连接失败'));
    req.setTimeout(120000, () => { req.destroy(); resolve('AI超时'); });
    req.write(body);
    req.end();
  });
}

function fetchPrices() {
  return new Promise((resolve) => {
    http.get('http://192.168.0.3:3000/api/prices', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve([]); } });
    }).on('error', () => resolve([]));
  });
}

// ── 先发数据，AI简评后发 ───────────────────────────────
async function dailySummary() {
  const prices = await fetchPrices();
  if (!prices.length) return;

  const valid = prices.filter(p => !p.error);
  const up    = valid.filter(p => p.changePct > 0).length;
  const down  = valid.filter(p => p.changePct < 0).length;
  const best  = [...valid].sort((a,b) => b.changePct - a.changePct)[0];
  const worst = [...valid].sort((a,b) => a.changePct - b.changePct)[0];

  // 立刻发数据
  await send(ADMIN,
    `📊 今日收盘简报\n` +
    `━━━━━━━━━━━━\n` +
    valid.map(p =>
      `${p.changePct >= 0 ? '▲' : '▼'} ${p.symbol}  ${p.changePct >= 0 ? '+' : ''}${p.changePct}%  ${p.price}`
    ).join('\n') +
    `\n━━━━━━━━━━━━\n` +
    `上涨 ${up} 支 | 下跌 ${down} 支\n` +
    `最强：${best?.symbol} ${best?.changePct}%\n` +
    `最弱：${worst?.symbol} ${worst?.changePct}%\n\n` +
    `🤖 AI简评生成中...`
  );

  // AI后台生成，完成后再发
  const lines = valid.map(p =>
    `${p.symbol} ${p.changePct >= 0 ? '+' : ''}${p.changePct}%`
  ).join('，');

  const comment = await askOllama(
    `用中文50字以内简评今日股市：${lines}，上涨${up}支下跌${down}支。语气简洁专业。`
  );

  send(ADMIN, `🤖 AI简评：\n${comment}`);
}

// ── 异常报警 ──────────────────────────────────────────
const alertedToday = new Set();

async function checkAlerts() {
  const prices = await fetchPrices();
  for (const p of prices) {
    if (p.error) continue;
    if (Math.abs(p.changePct) < 3) continue;
    const key = p.symbol + '_' + new Date().toDateString();
    if (alertedToday.has(key)) continue;
    alertedToday.add(key);

    // 先发报警
    await send(ADMIN,
      `${p.changePct >= 0 ? '🚀' : '📉'} ${p.symbol} 大幅变动\n` +
      `变动：${p.changePct >= 0 ? '+' : ''}${p.changePct}%\n` +
      `现价：${p.price}\n\n🤖 AI分析中...`
    );

    // AI后台生成
    const comment = await askOllama(
      `${p.symbol}今日${p.changePct >= 0 ? '上涨' : '下跌'}${Math.abs(p.changePct)}%，用中文30字以内给出简短提示：`
    );
    send(ADMIN, `🤖 ${p.symbol} AI分析：\n${comment}`);
  }
}

// ── 定时任务 ──────────────────────────────────────────
function startScheduler() {
  setInterval(() => {
    const now = new Date();
    const h   = now.getHours();
    const m   = now.getMinutes();
    const hm  = h * 60 + m;

    if (h === 15 && m === 35) dailySummary();
    if ((hm >= 540 && hm <= 690) || (hm >= 750 && hm <= 930)) {
      if (m % 5 === 0) checkAlerts();
    }
  }, 60000);
}

// ── 系统命令 ──────────────────────────────────────────
function exec(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { timeout: 10000 }).toString().trim() };
  } catch(e) {
    return { ok: false, out: e.message };
  }
}

function dockerStatus(container) {
  const r = exec("docker inspect -f '{{.State.Running}}' " + container);
  if (!r.ok) return '未找到';
  return r.out === 'true' ? '运行中' : '已停止';
}

function dockerAction(action, container) {
  return exec('docker ' + action + ' ' + container).ok;
}

// ── 消息处理 ──────────────────────────────────────────
async function handleMessage(msg) {
  const chatId = String(msg.chat.id);
  const raw    = (msg.text || '').trim();
  const text   = BTN_MAP[raw] || raw;

  if (chatId !== ADMIN) { send(chatId, '无权限'); return; }

  if (text === '/start' || text === '帮助') {
    send(chatId, 'NAS控制中心\n\n点下方按钮操作\n或输入 exec 命令\n\n每日15:35自动收盘简报\n涨跌超3%自动报警+AI分析');
    return;
  }

  if (text.startsWith('股票')) {
    const action = text.replace('股票', '').trim();
    const tool   = TOOLS['stock-monitor'];

    if (action === '开启' || action === '启动') {
      await send(chatId, '正在启动...');
      send(chatId, dockerAction('start', 'stock-monitor')
        ? tool.name + ' 已启动\nhttp://192.168.0.3:' + tool.port : '启动失败');

    } else if (action === '关闭' || action === '停止') {
      await send(chatId, '正在停止...');
      send(chatId, dockerAction('stop', 'stock-monitor')
        ? tool.name + ' 已停止' : '停止失败');

    } else if (action === '状态') {
      send(chatId, tool.name + '\n状态：' + dockerStatus('stock-monitor'));

    } else if (action === '链接' || action === '地址') {
      send(chatId, tool.name + '\n状态：' + dockerStatus('stock-monitor') +
        '\nhttp://192.168.0.3:' + tool.port);

    } else if (action === '简报') {
      await send(chatId, '获取中...');
      dailySummary();
    }
    return;
  }

  if (text.startsWith('系统')) {
    const action = text.replace('系统', '').trim();
    if (action === '状态') {
      const disk = exec("df -h / | tail -1 | awk '{print $3\"/\"$2\" 已用\"$5}'").out;
      const mem  = exec("free -h | grep Mem | awk '{print $3\"/\"$2}'").out;
      send(chatId, 'NAS状态\n内存：' + mem + '\n磁盘：' + disk);
    } else if (action === '容器') {
      const r = exec("docker ps --format '{{.Names}}  {{.Status}}'");
      send(chatId, r.ok ? r.out : '获取失败');
    }
    return;
  }

  if (text.startsWith('exec ')) {
    const cmd = text.replace('exec ', '').trim();
    const dangerous = ['rm -rf', 'mkfs', 'dd if', 'format'];
    if (dangerous.some(d => cmd.includes(d))) { send(chatId, '危险命令已拦截'); return; }
    const r = exec(cmd);
    send(chatId, r.ok ? r.out : '错误：' + r.out);
    return;
  }

  send(chatId, '没听懂，发「帮助」查看指令');
}

// ── 长轮询 ────────────────────────────────────────────
let offset = 0;
async function poll() {
  try {
    const data = await apiRequest('getUpdates', {
      offset, timeout: 30, allowed_updates: ['message']
    });
    if (data && data.ok && data.result.length) {
      for (const update of data.result) {
        offset = update.update_id + 1;
        if (update.message) await handleMessage(update.message);
      }
    }
  } catch(e) { console.error('poll error:', e.message); }
  setTimeout(poll, 1000);
}

console.log('NAS Bot 启动中...');
startScheduler();
poll();
