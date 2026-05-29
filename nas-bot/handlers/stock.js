const { send, httpGet, askOllama } = require('../utils');
const config = require('../config');

// ── 获取价格 ──────────────────────────────────────────
async function getPrices() {
  return await httpGet(config.STOCK + '/api/prices') || [];
}

// ── 股票状态 ──────────────────────────────────────────
async function status(chatId) {
  const { execSync } = require('child_process');
  try {
    const r = execSync("docker inspect -f '{{.State.Running}}' stock-monitor").toString().trim();
    send(chatId, '股票监控\n状态：' + (r === 'true' ? '运行中' : '已停止'));
  } catch(e) {
    send(chatId, '股票监控\n状态：未找到');
  }
}

// ── 启动/停止 ─────────────────────────────────────────
async function start(chatId) {
  const { execSync } = require('child_process');
  await send(chatId, '正在启动...');
  try {
    execSync('docker start stock-monitor');
    send(chatId, '股票监控 已启动\nhttp://192.168.0.3:3000');
  } catch(e) { send(chatId, '启动失败'); }
}

async function stop(chatId) {
  const { execSync } = require('child_process');
  await send(chatId, '正在停止...');
  try {
    execSync('docker stop stock-monitor');
    send(chatId, '股票监控 已停止');
  } catch(e) { send(chatId, '停止失败'); }
}

// ── 链接 ──────────────────────────────────────────────
async function link(chatId) {
  const { execSync } = require('child_process');
  try {
    const r = execSync("docker inspect -f '{{.State.Running}}' stock-monitor").toString().trim();
    send(chatId, '股票监控\n状态：' + (r === 'true' ? '运行中' : '已停止') +
      '\nhttp://192.168.0.3:3000');
  } catch(e) { send(chatId, '获取失败'); }
}

// ── 收盘简报 ──────────────────────────────────────────
async function summary(chatId) {
  const prices = await getPrices();
  if (!prices.length) { send(chatId, '获取价格失败'); return; }

  const valid = prices.filter(p => !p.error);
  const up    = valid.filter(p => p.changePct > 0).length;
  const down  = valid.filter(p => p.changePct < 0).length;
  const best  = [...valid].sort((a,b) => b.changePct - a.changePct)[0];
  const worst = [...valid].sort((a,b) => a.changePct - b.changePct)[0];

  // 先发数据
  await send(chatId,
    `📊 收盘简报\n` +
    `━━━━━━━━━━━━\n` +
    valid.map(p =>
      `${p.changePct >= 0 ? '▲' : '▼'} ${p.symbol}  ${p.changePct >= 0 ? '+' : ''}${p.changePct}%  ${p.price}`
    ).join('\n') +
    `\n━━━━━━━━━━━━\n` +
    `上涨 ${up} | 下跌 ${down}\n` +
    `最强：${best?.symbol} ${best?.changePct}%\n` +
    `最弱：${worst?.symbol} ${worst?.changePct}%\n\n` +
    `🤖 AI简评生成中...`
  );

  // AI后台生成
  const lines = valid.map(p => `${p.symbol} ${p.changePct >= 0 ? '+' : ''}${p.changePct}%`).join('，');
  const comment = await askOllama(
    `用中文50字以内简评今日股市：${lines}，上涨${up}支下跌${down}支。语气简洁专业。`
  );
  send(chatId, `🤖 AI简评：\n${comment}`);
}

// ── 异常检测（定时调用）──────────────────────────────
const alertedToday = new Set();

async function checkAlerts() {
  const prices = await getPrices();
  for (const p of prices) {
    if (p.error || Math.abs(p.changePct) < 3) continue;
    const key = p.symbol + '_' + new Date().toDateString();
    if (alertedToday.has(key)) continue;
    alertedToday.add(key);

    await send(config.ADMIN,
      `${p.changePct >= 0 ? '🚀' : '📉'} ${p.symbol} 大幅变动\n` +
      `变动：${p.changePct >= 0 ? '+' : ''}${p.changePct}%\n` +
      `现价：${p.price}\n\n🤖 AI分析中...`
    );

    const comment = await askOllama(
      `${p.symbol}今日${p.changePct >= 0 ? '上涨' : '下跌'}${Math.abs(p.changePct)}%，30字以内简短提示：`
    );
    send(config.ADMIN, `🤖 ${p.symbol}：\n${comment}`);
  }
}

module.exports = { status, start, stop, link, summary, checkAlerts };
