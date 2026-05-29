const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = '/data/config.json';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend/public')));

const DEFAULT_CONFIG = {
  stocks: [],
  settings: {
    refreshInterval: 60,
    currency: 'JPY',
    theme: 'dark',
    fontScale: 1,
    cardSize: 'medium',
    priceAlerts: [],
    changePctAlert: 5,
    ntfyTopic: '',
    ntfyServer: 'https://ntfy.sh',
    dailySummaryTime: '16:00',
    dailySummaryEnabled: false,
    customWatchlist: []
  }
};

function loadConfig() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch(e) { console.error('Config load error:', e.message); }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function saveConfig(config) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(config, null, 2));
}

// ── ntfy 推送 ─────────────────────────────────────────
function sendNtfy(topic, title, message, priority, server) {
  if (!topic) return;
  const srv = server || 'https://ntfy.sh';
  const url = new URL(`/${topic}`, srv);
  const isHttps = url.protocol === 'https:';
  const mod = isHttps ? https : http;
  const body = Buffer.from(message);
  const opts = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': body.length,
      'Title': encodeURIComponent(title),
      'Priority': priority || 'default',
      'Tags': 'chart_increasing'
    }
  };
  const req = mod.request(opts, () => {});
  req.on('error', e => console.error('ntfy error:', e.message));
  req.setTimeout(8000, () => req.destroy());
  req.write(body);
  req.end();
}

// ── 為替レート取得 ────────────────────────────────────
let fxCache = {};
async function fetchFxRate(from, to) {
  const key = `${from}_${to}`;
  if (fxCache[key] && Date.now() - fxCache[key].ts < 300000) return fxCache[key].rate;
  return new Promise((resolve) => {
    const symbol = `${from}${to}=X`;
    const opts = {
      hostname: 'query1.finance.yahoo.com',
      path: `/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const rate = json.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (rate) {
            fxCache[key] = { rate, ts: Date.now() };
            resolve(rate);
          } else resolve(null);
        } catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

app.get('/api/fx', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.json({ rate: null });
  const rate = await fetchFxRate(from, to);
  res.json({ from, to, rate });
});

// ── 投資信託判定 ──────────────────────────────────────
function isMutualFund(symbol) {
  return /^[0-9A-Za-z]{8}$/.test(symbol) && !/\.(T|SS|SZ|HK|N|P)$/i.test(symbol) && !/\^/.test(symbol);
}

// ── 株式・ETF価格取得 ─────────────────────────────────
function fetchStockPrice(symbol) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'query1.finance.yahoo.com',
      path: `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const result = json.chart?.result?.[0];
          if (!result) return reject(new Error('No data'));
          const meta = result.meta;
          const price = meta.regularMarketPrice;
          const prevClose = meta.previousClose || meta.chartPreviousClose;
          const change = price - prevClose;
          resolve({
            symbol: meta.symbol,
            name: meta.longName || meta.shortName || symbol,
            price: parseFloat(price.toFixed(4)),
            change: parseFloat(change.toFixed(4)),
            changePct: parseFloat(((change / prevClose) * 100).toFixed(2)),
            prevClose: parseFloat(prevClose.toFixed(4)),
            currency: meta.currency,
            marketState: meta.marketState,
            high: meta.regularMarketDayHigh,
            low: meta.regularMarketDayLow,
            volume: meta.regularMarketVolume,
            isMutualFund: false,
            timestamp: Date.now()
          });
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ── 投信価格取得 ──────────────────────────────────────
function fetchMutualFundPrice(symbol) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'finance.yahoo.co.jp',
      path: `/quote/${encodeURIComponent(symbol)}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
        'Accept': 'text/html',
        'Accept-Language': 'ja,en;q=0.9'
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const m1 = data.match(/"registerItem"\s*:\s*\{[^}]*?"price"\s*:\s*"([0-9,]+)"/);
          const m3 = data.match(/(\d{1,3}(?:,\d{3})+)円/);
          const priceStr = (m1 && m1[1]) || (m3 && m3[1]);
          if (!priceStr) return reject(new Error('価格データなし: ' + symbol));
          const price = parseFloat(priceStr.replace(/,/g, ''));
          const nameMatch = data.match(/<title>([^<]+)/);
          let name = nameMatch ? nameMatch[1].split(/[|：:]/)[0].trim() : symbol;
          const prevMatch = data.match(/"prevClose(?:Price)?"\s*:\s*"?([0-9,]+)"?/);
          const prevPrice = prevMatch ? parseFloat(prevMatch[1].replace(/,/g, '')) : price;
          const change = price - prevPrice;
          const dateMatch = data.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
          resolve({
            symbol, name,
            price,
            change: parseFloat(change.toFixed(2)),
            changePct: parseFloat((prevPrice > 0 ? (change / prevPrice) * 100 : 0).toFixed(2)),
            prevClose: prevPrice,
            currency: 'JPY',
            marketState: 'CLOSED',
            high: null, low: null, volume: null,
            isMutualFund: true,
            navDate: dateMatch ? `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}` : null,
            timestamp: Date.now()
          });
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ── 検索 ─────────────────────────────────────────────
function searchStock(query) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'query1.finance.yahoo.com',
      path: `/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve((json.quotes || []).map(q => ({
            symbol: q.symbol,
            name: q.longname || q.shortname || q.symbol,
            exchange: q.exchange,
            type: q.quoteType
          })));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ── Cache ─────────────────────────────────────────────
const priceCache = new Map();
async function getCachedPrice(symbol) {
  const cached = priceCache.get(symbol);
  const ttl = isMutualFund(symbol) ? 3600000 : 30000;
  if (cached && Date.now() - cached.ts < ttl) return cached.data;
  const data = isMutualFund(symbol) ? await fetchMutualFundPrice(symbol) : await fetchStockPrice(symbol);
  priceCache.set(symbol, { data, ts: Date.now() });
  return data;
}

// ── 報警チェック ──────────────────────────────────────
const triggeredAlerts = new Set();

function checkAndNotify(prices, config) {
  const s = config.settings;
  if (!s.ntfyTopic) return;

  prices.forEach(p => {
    if (!p || p.error) return;

    // 1. 目標価格アラート
    (s.priceAlerts || []).forEach(a => {
      if (a.symbol !== p.symbol) return;
      const key = `price_${a.symbol}_${a.direction}_${a.price}`;
      if (triggeredAlerts.has(key)) return;
      const hit = (a.direction === 'above' && p.price >= a.price) ||
                  (a.direction === 'below' && p.price <= a.price);
      if (hit) {
        triggeredAlerts.add(key);
        sendNtfy(s.ntfyTopic,
          `🎯 ${p.symbol} 目標価格到達`,
          `${p.name}\n現在値: ${p.price} ${p.currency}\n目標: ${a.direction === 'above' ? '≥' : '≤'} ${a.price}`,
          'high', s.ntfyServer);
      }
    });

    // 2. 涨跌幅アラート
    const threshold = s.changePctAlert || 5;
    const absPct = Math.abs(p.changePct);
    if (absPct >= threshold) {
      const key = `pct_${p.symbol}_${new Date().toDateString()}`;
      if (!triggeredAlerts.has(key)) {
        triggeredAlerts.add(key);
        const emoji = p.changePct > 0 ? '🚀' : '📉';
        sendNtfy(s.ntfyTopic,
          `${emoji} ${p.symbol} 大幅変動`,
          `${p.name}\n変動率: ${p.changePct > 0 ? '+' : ''}${p.changePct}%\n現在値: ${p.price} ${p.currency}`,
          p.changePct > 0 ? 'high' : 'urgent', s.ntfyServer);
      }
    }
  });
}

// ── 日次サマリー ──────────────────────────────────────
let lastSummaryDate = '';
function checkDailySummary(prices, config) {
  const s = config.settings;
  if (!s.dailySummaryEnabled || !s.ntfyTopic) return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const today = now.toDateString();
  if (hhmm !== (s.dailySummaryTime || '16:00') || lastSummaryDate === today) return;
  lastSummaryDate = today;

  const validPrices = prices.filter(p => p && !p.error);
  const up = validPrices.filter(p => p.changePct > 0);
  const down = validPrices.filter(p => p.changePct < 0);
  const avg = validPrices.length ? (validPrices.reduce((s, p) => s + p.changePct, 0) / validPrices.length) : 0;

  let body = `📊 監視銘柄: ${validPrices.length}件\n`;
  body += `上昇: ${up.length}件 / 下落: ${down.length}件\n`;
  body += `平均変動: ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%\n\n`;
  validPrices.slice(0, 8).forEach(p => {
    body += `${p.changePct >= 0 ? '▲' : '▼'} ${p.symbol}: ${p.changePct >= 0 ? '+' : ''}${p.changePct}%\n`;
  });

  sendNtfy(s.ntfyTopic, '📈 株式 デイリーサマリー', body, 'default', s.ntfyServer);
}

// ── API Routes ────────────────────────────────────────
app.get('/api/config', (req, res) => res.json(loadConfig()));
app.post('/api/config', (req, res) => { saveConfig(req.body); res.json({ ok: true }); });

app.get('/api/prices', async (req, res) => {
  const config = loadConfig();
  const symbols = config.stocks.map(s => s.symbol);
  if (!symbols.length) return res.json([]);
  const results = await Promise.allSettled(symbols.map(getCachedPrice));
  const prices = results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { symbol: symbols[i], error: r.reason?.message || 'Failed', timestamp: Date.now() }
  );
  checkAndNotify(prices, config);
  checkDailySummary(prices, config);
  res.json(prices);
});

app.get('/api/price/:symbol', async (req, res) => {
  try { res.json(await getCachedPrice(req.params.symbol)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/search', async (req, res) => {
  if (!req.query.q) return res.json([]);
  try { res.json(await searchStock(req.query.q)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ntfyテスト送信
app.post('/api/ntfy/test', (req, res) => {
  const { topic, server } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic required' });
  sendNtfy(topic, '✅ 株式監視 接続テスト', 'Stock Monitorからのテストメッセージです！\nntfy通知が正常に動作しています。', 'default', server);
  res.json({ ok: true });
});

app.get('/api/history/:symbol', async (req, res) => {
  const { symbol } = req.params;
  if (isMutualFund(symbol)) return res.json({ symbol, range: 'nav', points: [], isMutualFund: true });
  const range = req.query.range || '1mo';
  const intervalMap = { '1d':'5m', '5d':'15m', '1mo':'1d', '3mo':'1d', '1y':'1wk', '5y':'1mo' };
  const opts = {
    hostname: 'query1.finance.yahoo.com',
    path: `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${intervalMap[range]||'1d'}&range=${range}`,
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
  };
  const req2 = https.request(opts, (r) => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => {
      try {
        const json = JSON.parse(data);
        const result = json.chart?.result?.[0];
        if (!result) return res.status(404).json({ error: 'No data' });
        const timestamps = result.timestamp || [];
        const closes = result.indicators?.quote?.[0]?.close || [];
        res.json({ symbol, range, points: timestamps.map((t, i) => ({ t: t * 1000, v: closes[i] })).filter(p => p.v != null) });
      } catch(e) { res.status(500).json({ error: e.message }); }
    });
  });
  req2.on('error', e => res.status(500).json({ error: e.message }));
  req2.setTimeout(10000, () => { req2.destroy(); res.status(500).json({ error: 'Timeout' }); });
  req2.end();
});

app.listen(PORT, '0.0.0.0', () => console.log(`Stock Monitor running on port ${PORT}`));
