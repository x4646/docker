// ── js/prices.js  価格取得 & 為替 ────────────────────

async function refreshPrices(force = false) {
  if (!config.stocks.length) return;
  const icon = document.getElementById('refresh-icon');
  if (icon) icon.classList.add('spinning');
  try {
    const url = force ? `${API}/api/prices?force=true` : `${API}/api/prices`;
    const r = await fetch(url);
    const prices = await r.json();
    prices.forEach(p => { if (!p.error) priceData[p.symbol] = p; });
    renderDashboard();
    const statusEl = document.getElementById('last-update');
    if (statusEl) statusEl.textContent = new Date().toLocaleTimeString('ja-JP');
    await fetchFxRates();
  } catch(e) {
    showToast('価格更新失敗', 'error');
  } finally {
    if (icon) icon.classList.remove('spinning');
  }
}

// 手動は必ずキャッシュスキップ
async function manualRefresh() {
  await refreshPrices(true);
}

// ── 為替レート ─────────────────────────────────────────
async function fetchFxRates() {
  const pairs = [['USD','JPY'], ['HKD','JPY'], ['EUR','JPY'], ['GBP','JPY']];
  await Promise.all(pairs.map(async ([from, to]) => {
    try {
      const r = await fetch(`${API}/api/fx?from=${from}&to=${to}`);
      const d = await r.json();
      if (d.rate) fxRates[`${from}_${to}`] = d.rate;
    } catch(e) {}
  }));
  updateFxBar();
}

function updateFxBar() {
  const el = document.getElementById('fx-usdjpy');
  if (el && fxRates['USD_JPY']) el.textContent = fxRates['USD_JPY'].toFixed(2);
}

function toJpy(price, currency) {
  if (currency === 'JPY') return price;
  const rate = fxRates[`${currency}_JPY`];
  return rate ? price * rate : null;
}
