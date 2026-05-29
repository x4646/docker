// ── js/config.js  全局状态 & 配置读写 ─────────────────

const API = '';

// 全局状态（其他模块直接读写）
let config = {
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
    jpyDisplay: 'usd',
    customWatchlist: []
  }
};

let priceData = {};   // { symbol: priceObject }
let fxRates   = {};   // { 'USD_JPY': 149.5, ... }

function ensureDefaults() {
  const d = {
    refreshInterval:60, currency:'JPY', theme:'dark', fontScale:1,
    cardSize:'medium', priceAlerts:[], changePctAlert:5,
    ntfyTopic:'', ntfyServer:'https://ntfy.sh',
    dailySummaryTime:'16:00', dailySummaryEnabled:false,
    jpyDisplay:'usd', customWatchlist:[]
  };
  config.settings = Object.assign({}, d, config.settings);
  if (!config.stocks) config.stocks = [];
}

async function loadConfig() {
  try {
    const r = await fetch(`${API}/api/config`);
    config = await r.json();
    ensureDefaults();
  } catch(e) {
    showToast('无法连接后端', 'error');
  }
}

async function saveConfig() {
  try {
    await fetch(`${API}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
  } catch(e) {
    showToast('保存失败', 'error');
  }
}
