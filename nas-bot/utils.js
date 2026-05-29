const https = require('https');
const http  = require('http');

const TOKEN = '8838005992:AAEETKYczov8IwloZdNOESpOWVgwnSpmb9U';

// ── Telegram发送 ──────────────────────────────────────
const KEYBOARD = {
  keyboard: [
    ['📈 股票状态', '▶️ 股票开启', '⏹️ 股票关闭'],
    ['💾 系统状态', '🐳 容器列表', '🌐 股票链接'],
    ['❓ 帮助']
  ],
  resize_keyboard: true,
  persistent: true
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

// ── HTTP GET ──────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

// ── Ollama ────────────────────────────────────────────
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

module.exports = { send, httpGet, askOllama, apiRequest };
