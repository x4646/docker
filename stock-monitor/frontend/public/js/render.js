// ── js/render.js  画面描画 & アラート ────────────────

// ── データ定数 ─────────────────────────────────────────
const FUND_LIST = [
  { sym:'0331418A', name:'eMAXIS Slim 米国株式(S&P500)' },
  { sym:'0331120A', name:'eMAXIS Slim 全世界株式(オルカン)' },
  { sym:'03311187', name:'eMAXIS Slim 先進国株式' },
  { sym:'0331116B', name:'eMAXIS Slim 国内株式(TOPIX)' },
  { sym:'03312179', name:'eMAXIS Slim 新興国株式' },
  { sym:'9C31116A', name:'楽天・S&P500' },
  { sym:'9C311193', name:'楽天・全米株式(VTI)' },
  { sym:'2931113C', name:'SBI・V・S&P500' },
];

const ETF_LIST = [
  { sym:'1570.T',   name:'日経レバレッジ×2' },
  { sym:'1357.T',   name:'日経ダブルインバース' },
  { sym:'1321.T',   name:'NEXT日経225連動' },
  { sym:'1306.T',   name:'NEXT FUNDS TOPIX' },
  { sym:'^N225',    name:'日経225指数' },
  { sym:'^TOPX',    name:'TOPIX指数' },
  { sym:'SOXL',     name:'半導体ブル3倍' },
  { sym:'QQQ',      name:'ナスダック100' },
  { sym:'TQQQ',     name:'ナスダック3倍' },
  { sym:'VOO',      name:'S&P500 VOO' },
  { sym:'VTI',      name:'全米株式 VTI' },
  { sym:'VT',       name:'全世界株式 VT' },
  { sym:'^HSI',     name:'恒生指数' },
  { sym:'02800.HK', name:'盈富基金HSI' },
  { sym:'GLD',      name:'ゴールドETF' },
];

// ── 全体再描画 ─────────────────────────────────────────
function renderAll() {
  renderDashboard();
  renderSettingsStockList();
  renderAlerts();
  renderAlertSymbolSelect();
  syncSettingsForm();
}

// ── ダッシュボード ─────────────────────────────────────
function renderDashboard() {
  const grid = document.getElementById('stock-grid');
  if (!config.stocks.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="empty-icon">📉</div>
      <div class="empty-title">監視銘柄なし</div>
      <div class="empty-sub">右上の「追加」から銘柄を追加</div>
    </div>`;
    updateSummary([]); return;
  }
  const prices = config.stocks.map(s => priceData[s.symbol]).filter(Boolean);
  updateSummary(prices);

  // カードを描画してからドラッグ初期化
  grid.innerHTML = config.stocks.map(s => {
    const p = priceData[s.symbol];
    return p ? stockCard(p, s) : skeletonCard(s.symbol);
  }).join('');

  initDragSort(grid);
}

// ── ドラッグ＆ドロップ並び替え ────────────────────────
function initDragSort(grid) {
  let dragEl = null;
  let dragSymbol = null;

  grid.querySelectorAll('.stock-card').forEach(card => {
    // ドラッグハンドル（⠿ ボタン）
    const handle = card.querySelector('.drag-handle');
    if (!handle) return;

    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      dragEl = card;
      dragSymbol = card.dataset.symbol;
      card.style.opacity = '0.5';
      card.style.cursor = 'grabbing';
    });
  });

  grid.addEventListener('dragstart', e => {
    const card = e.target.closest('.stock-card');
    if (!card) return;
    dragEl = card;
    dragSymbol = card.dataset.symbol;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.classList.add('dragging'), 0);
  });

  grid.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.target.closest('.stock-card');
    if (!target || target === dragEl) return;

    // カーソル位置で前後を判断
    const rect = target.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const after = e.clientX > midX;
    if (after) {
      target.parentNode.insertBefore(dragEl, target.nextSibling);
    } else {
      target.parentNode.insertBefore(dragEl, target);
    }
  });

  grid.addEventListener('dragend', async e => {
    const card = e.target.closest('.stock-card');
    if (card) {
      card.classList.remove('dragging');
      card.style.opacity = '';
      card.style.cursor = '';
    }

    // DOM順に config.stocks を並び替えて保存
    const newOrder = [...grid.querySelectorAll('.stock-card[data-symbol]')]
      .map(el => el.dataset.symbol);
    config.stocks.sort((a, b) => newOrder.indexOf(a.symbol) - newOrder.indexOf(b.symbol));
    await saveConfig();
    dragEl = null;
    dragSymbol = null;
  });
}

function updateSummary(prices) {
  document.getElementById('sum-count').textContent = config.stocks.length;
  const up   = prices.filter(p => p.changePct > 0).length;
  const down = prices.filter(p => p.changePct < 0).length;
  const avg  = prices.length ? prices.reduce((s,p) => s + p.changePct, 0) / prices.length : 0;
  document.getElementById('sum-up').textContent = up;
  document.getElementById('sum-down').textContent = down;
  const ae = document.getElementById('sum-avg');
  ae.textContent = (avg >= 0 ? '+' : '') + avg.toFixed(2) + '%';
  ae.className = 'summary-value ' + (avg > 0 ? 'text-up' : avg < 0 ? 'text-down' : 'text-neutral');
  updateFxBar();
}

// ── 設定ページ：株リスト ──────────────────────────────
function renderSettingsStockList() {
  const el = document.getElementById('settings-stock-list');
  if (!config.stocks.length) { el.innerHTML = '<p style="font-size:.78rem;color:var(--text3)">銘柄なし</p>'; return; }
  el.innerHTML = config.stocks.map(s => `
    <div class="stock-list-item">
      <div>
        <div class="stock-list-symbol">${s.symbol} ${s.alias ? '<span style="color:var(--gold);font-size:.72rem">'+escHtml(s.alias)+'</span>' : ''}</div>
        <div class="stock-list-name">${escHtml(s.name||'')}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="icon-btn" title="別名編集" onclick="openCardSettings(null,'${s.symbol}')">✏️</button>
        <button class="icon-btn" onclick="removeStockFromSettings('${s.symbol}')">✕</button>
      </div>
    </div>`).join('');
}

// ── アラート ───────────────────────────────────────────
function renderAlerts() {
  const list = document.getElementById('alert-list');
  const alerts = config.settings.priceAlerts || [];
  if (!alerts.length) { list.innerHTML = '<p style="font-size:.78rem;color:var(--text3)">アラートなし</p>'; return; }
  list.innerHTML = alerts.map((a, i) => `
    <div class="alert-item">
      <div class="alert-item-info">
        <span class="alert-symbol">${a.symbol}</span>
        <span class="${a.direction==='above'?'alert-type-above':'alert-type-below'}">${a.direction==='above'?'高於↑':'低於↓'}</span>
        <span>${a.price}</span>
      </div>
      <button class="icon-btn" onclick="removeAlert(${i})">✕</button>
    </div>`).join('');
}

function renderAlertSymbolSelect() {
  const sel = document.getElementById('alert-symbol');
  sel.innerHTML = config.stocks.map(s => `<option value="${s.symbol}">${s.symbol}</option>`).join('');
}

async function addAlert() {
  const symbol    = document.getElementById('alert-symbol').value;
  const direction = document.getElementById('alert-direction').value;
  const price     = parseFloat(document.getElementById('alert-price').value);
  if (!symbol || isNaN(price) || price <= 0) { showToast('入力を確認してください', 'error'); return; }
  if (!config.settings.priceAlerts) config.settings.priceAlerts = [];
  config.settings.priceAlerts.push({ symbol, direction, price });
  await saveConfig(); renderAlerts();
  document.getElementById('alert-price').value = '';
  showToast('アラート追加', 'success');
}

async function removeAlert(i) {
  config.settings.priceAlerts.splice(i, 1);
  await saveConfig(); renderAlerts();
}

// ── クイック追加グリッド ───────────────────────────────
function buildQuickGrids() {
  const fg = document.getElementById('fund-quick-grid');
  if (fg) fg.innerHTML = FUND_LIST.map(e =>
    `<div class="etf-chip" onclick="quickAdd('${e.sym}','${escJs(e.name)}')">
      <div class="chip-sym" style="font-size:.68rem">${e.sym}</div>
      <div class="chip-name">${e.name}</div>
    </div>`).join('');

  const eg = document.getElementById('etf-quick-grid');
  if (eg) eg.innerHTML = ETF_LIST.map(e =>
    `<div class="etf-chip" onclick="quickAdd('${e.sym}','${escJs(e.name)}')">
      <div class="chip-sym">${e.sym}</div>
      <div class="chip-name">${e.name}</div>
    </div>`).join('');

  renderCustomQuickGrid();
}

function renderCustomQuickGrid() {
  const cg = document.getElementById('custom-quick-grid');
  const items = config.settings.customWatchlist || [];
  if (!cg) return;
  if (!items.length) { cg.innerHTML = '<p style="font-size:.7rem;color:var(--text3)">設定でカスタムリストを追加</p>'; return; }
  cg.innerHTML = items.filter(i => i.sym).map(e =>
    `<div class="etf-chip" onclick="quickAdd('${e.sym}','${escJs(e.name||e.sym)}')">
      <div class="chip-sym">${e.sym}</div>
      <div class="chip-name">${e.name||e.sym}</div>
    </div>`).join('');
}
