// ── js/actions.js  銘柄追加・削除・検索 ──────────────

let selectedStock = null;
let searchTimer   = null;

// ── ページ切り替え ─────────────────────────────────────
function switchPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  el.classList.add('active');
}

// ── 銘柄削除 ──────────────────────────────────────────
async function removeStock(evt, symbol) {
  evt.stopPropagation();
  config.stocks = config.stocks.filter(s => s.symbol !== symbol);
  delete priceData[symbol];
  await saveConfig(); renderAll();
  showToast(`${symbol} を削除`, 'success');
}

async function removeStockFromSettings(symbol) {
  config.stocks = config.stocks.filter(s => s.symbol !== symbol);
  await saveConfig(); renderAll();
  showToast(`${symbol} を削除`, 'success');
}

// ── 追加モーダル ───────────────────────────────────────
function openAddModal() {
  buildQuickGrids();
  document.getElementById('add-modal').classList.add('show');
  setTimeout(() => document.getElementById('stock-search').focus(), 80);
}

function closeAddModal() {
  document.getElementById('add-modal').classList.remove('show');
  document.getElementById('stock-search').value = '';
  document.getElementById('search-results').classList.remove('show');
  document.getElementById('selected-stock').style.display = 'none';
  selectedStock = null;
}

async function confirmAddStock() {
  if (!selectedStock) return;
  if (config.stocks.find(s => s.symbol === selectedStock.symbol)) {
    showToast('既にリストにあります', 'error'); return;
  }
  config.stocks.push({ symbol: selectedStock.symbol, name: selectedStock.name });
  await saveConfig(); closeAddModal(); renderAll(); await refreshPrices();
  showToast(`${selectedStock.symbol} を追加`, 'success');
}

async function quickAdd(sym, name) {
  if (config.stocks.find(s => s.symbol === sym)) {
    showToast(`${sym} は既にリストにあります`, 'error'); return;
  }
  config.stocks.push({ symbol: sym, name });
  await saveConfig(); renderAll(); await refreshPrices();
  showToast(`${sym} を追加`, 'success');
}

// ── 検索 ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('stock-search');
  if (!input) return;

  input.addEventListener('input', function() {
    clearTimeout(searchTimer);
    const q = this.value.trim();
    if (!q) { document.getElementById('search-results').classList.remove('show'); return; }
    searchTimer = setTimeout(() => doSearch(q), 380);
  });

  input.addEventListener('keydown', e => { if (e.key === 'Escape') closeAddModal(); });
});

async function doSearch(q) {
  const results = document.getElementById('search-results');
  results.innerHTML = '<div style="padding:10px 13px;color:var(--text3);font-size:.78rem">検索中…</div>';
  results.classList.add('show');
  try {
    const r = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`);
    const items = await r.json();
    if (!items.length) {
      results.innerHTML = '<div style="padding:10px 13px;color:var(--text3);font-size:.78rem">結果なし</div>';
      return;
    }
    results.innerHTML = items.map(item => `
      <div class="search-item" onclick="selectStock('${item.symbol}','${escJs(item.name)}','${escJs(item.exchange||'')}')">
        <div>
          <div class="search-item-symbol">${item.symbol}</div>
          <div class="search-item-name">${escHtml(item.name||'')}</div>
        </div>
        <div class="search-item-exchange">${item.exchange||''}</div>
      </div>`).join('');
  } catch(e) {
    results.innerHTML = '<div style="padding:10px 13px;color:var(--down);font-size:.78rem">検索失敗</div>';
  }
}

function selectStock(symbol, name, exchange) {
  selectedStock = { symbol, name };
  document.getElementById('sel-symbol').textContent = symbol;
  document.getElementById('sel-name').textContent = name + (exchange ? ` (${exchange})` : '');
  document.getElementById('selected-stock').style.display = 'block';
  document.getElementById('search-results').classList.remove('show');
  document.getElementById('stock-search').value = symbol;
}
