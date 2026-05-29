// ── js/market.js  市場時間 & 自動更新 ─────────────────

let refreshTimer = null;

// 监控中的品种里是否有任一市场开盘（日本时间）
function isAnyMarketOpen() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false; // 週末

  const hm = now.getHours() * 60 + now.getMinutes();
  const symbols = config.stocks.map(s => s.symbol);

  // 日本株 9:00-11:30 / 12:30-15:30
  const hasJP = symbols.some(s => /\d+\.T$/.test(s));
  if (hasJP && ((hm >= 540 && hm <= 690) || (hm >= 750 && hm <= 930))) return true;

  // 米国株 22:00-翌6:00
  const hasUS = symbols.some(s => !s.includes('.') && !s.startsWith('^'));
  if (hasUS && (hm >= 1320 || hm <= 360)) return true;

  // 香港株 10:00-16:00
  const hasHK = symbols.some(s => s.endsWith('.HK'));
  if (hasHK && hm >= 600 && hm <= 960) return true;

  // 指数・ETFは日米に準じる
  const hasIdx = symbols.some(s => s.startsWith('^'));
  if (hasIdx && ((hm >= 540 && hm <= 930) || hm >= 1320 || hm <= 360)) return true;

  return false;
}

function startAutoRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);

  const tick = async () => {
    const open = isAnyMarketOpen();
    const interval = open
      ? (config.settings.refreshInterval || 60) * 1000
      : 30 * 60 * 1000; // 休場中は30分に1回

    // インジケーター更新
    const dot = document.querySelector('.dot');
    if (dot) dot.style.background = open ? 'var(--up)' : 'var(--neutral)';

    const statusEl = document.getElementById('last-update');
    if (statusEl && !open) {
      statusEl.textContent = '休場中 (30分毎)';
    }

    await refreshPrices();
    refreshTimer = setTimeout(tick, interval);
  };

  refreshTimer = setTimeout(tick, (config.settings.refreshInterval || 60) * 1000);
}
