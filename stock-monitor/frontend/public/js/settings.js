// ── js/settings.js  設定ページ & テーマ ──────────────

// ── テーマ ────────────────────────────────────────────
function applyTheme(t) {
  document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
  if (t !== 'dark') document.body.classList.add('theme-' + t);
  document.querySelectorAll('.theme-swatch[id^="sw-"]').forEach(el => el.classList.remove('active'));
  const sw = document.getElementById('sw-' + t);
  if (sw) sw.classList.add('active');
}
function setTheme(t) { config.settings.theme = t; applyTheme(t); }

function applyFontScale(s) {
  document.documentElement.style.setProperty('--font-scale', s);
  const pct = Math.round(s * 100) + '%';
  const sl = document.getElementById('font-scale-slider'); if(sl) sl.value = s;
  const sl2 = document.getElementById('qa-font-slider'); if(sl2) sl2.value = s;
  const lb = document.getElementById('font-scale-val'); if(lb) lb.textContent = pct;
  const lb2 = document.getElementById('qa-font-val'); if(lb2) lb2.textContent = pct;
}
function applyCardSize(s) {
  // s は '300' のような数値文字列 or 'medium' などの旧形式
  const legacyMap = { small:'240', medium:'300', large:'400' };
  const px = isNaN(s) ? (legacyMap[s] || '300') : String(s);
  document.documentElement.style.setProperty('--card-min', px + 'px');
  // スライダー同期
  const sl = document.getElementById('card-size-slider'); if(sl) sl.value = px;
  const sl2 = document.getElementById('qa-card-slider'); if(sl2) sl2.value = px;
  const vl = document.getElementById('card-size-val'); if(vl) vl.textContent = px + 'px';
  const vl2 = document.getElementById('qa-card-val'); if(vl2) vl2.textContent = px + 'px';
}
function setCardSize(s) { config.settings.cardSize = String(s); applyCardSize(s); }

// ── フォームと設定の同期 ──────────────────────────────
function syncSettingsForm() {
  const s = config.settings;
  const v = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  v('cfg-interval',       s.refreshInterval || 60);
  v('cfg-ntfy-topic',     s.ntfyTopic || '');
  v('cfg-ntfy-server',    s.ntfyServer || 'https://ntfy.sh');
  v('cfg-change-pct',     s.changePctAlert || 5);
  v('cfg-summary-time',   s.dailySummaryTime || '16:00');
  v('cfg-jpy-display',    s.jpyDisplay || 'usd');
  const cb = document.getElementById('cfg-summary-enabled');
  if (cb) cb.checked = !!s.dailySummaryEnabled;
  applyTheme(s.theme || 'dark');
  applyFontScale(s.fontScale || 1);
  applyCardSize(s.cardSize || 'medium');
}

async function saveSettings() {
  const g = id => { const el = document.getElementById(id); return el ? el.value : null; };
  config.settings.refreshInterval     = parseInt(g('cfg-interval')) || 60;
  config.settings.ntfyTopic           = g('cfg-ntfy-topic') || '';
  config.settings.ntfyServer          = g('cfg-ntfy-server') || 'https://ntfy.sh';
  config.settings.changePctAlert      = parseFloat(g('cfg-change-pct')) || 5;
  config.settings.dailySummaryTime    = g('cfg-summary-time') || '16:00';
  config.settings.jpyDisplay          = g('cfg-jpy-display') || 'usd';
  const cb = document.getElementById('cfg-summary-enabled');
  config.settings.dailySummaryEnabled = cb ? cb.checked : false;
  await saveConfig();
  startAutoRefresh();
  renderCustomQuickGrid();
  renderDashboard();
  showToast('設定を保存しました', 'success');
}

// ── ntfy テスト ───────────────────────────────────────
async function testNtfy() {
  const topic  = (document.getElementById('cfg-ntfy-topic')  || {}).value || config.settings.ntfyTopic;
  const server = (document.getElementById('cfg-ntfy-server') || {}).value || config.settings.ntfyServer;
  if (!topic) { showToast('ntfyチャンネル名を入力してください', 'error'); return; }
  try {
    await fetch(`${API}/api/ntfy/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, server })
    });
    showToast('テスト送信完了 — スマホを確認', 'success');
  } catch(e) { showToast('送信失敗', 'error'); }
}

// ── カスタムウォッチリスト編集 ────────────────────────
function renderCustomWatchlistEditor() {
  const el = document.getElementById('custom-watchlist-editor');
  const items = config.settings.customWatchlist || [];
  if (!items.length) { el.innerHTML = ''; return; }
  el.innerHTML = items.map((item, i) => `
    <div class="watchlist-item">
      <input class="form-input" value="${escHtml(item.sym||'')}" placeholder="コード AAPL" oninput="updateWatchlistItem(${i},'sym',this.value)">
      <input class="form-input" value="${escHtml(item.name||'')}" placeholder="名前（任意）" oninput="updateWatchlistItem(${i},'name',this.value)">
      <button class="icon-btn" onclick="removeWatchlistItem(${i})">✕</button>
    </div>`).join('');
}

function addCustomWatchlistItem() {
  if (!config.settings.customWatchlist) config.settings.customWatchlist = [];
  config.settings.customWatchlist.push({ sym:'', name:'' });
  renderCustomWatchlistEditor();
}

function updateWatchlistItem(i, key, val) {
  if (config.settings.customWatchlist[i]) config.settings.customWatchlist[i][key] = val;
}

function removeWatchlistItem(i) {
  config.settings.customWatchlist.splice(i, 1);
  renderCustomWatchlistEditor();
  renderCustomQuickGrid();
}

// ── カード個別設定（別名 / JPY）────────────────────────
async function toggleCardJpy(evt, symbol) {
  evt.stopPropagation();
  const s = config.stocks.find(s => s.symbol === symbol);
  if (!s) return;
  const globalJpy = config.settings.jpyDisplay || 'none';
  const p = priceData[symbol];
  const currency = p ? p.currency : 'USD';
  const globalOn = globalJpy === 'all' || (globalJpy === 'usd' && currency === 'USD');
  const currentOn = s.jpyOn !== undefined ? s.jpyOn : globalOn;
  s.jpyOn = !currentOn;
  await saveConfig();
  renderDashboard();
}

function openCardSettings(evt, symbol) {
  if (evt) evt.stopPropagation();
  const s = config.stocks.find(st => st.symbol === symbol);
  if (!s) return;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:300;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border2);border-radius:14px;padding:24px;width:340px;max-width:92vw;box-shadow:0 16px 60px rgba(0,0,0,.5)">
      <div style="font-family:var(--mono);font-size:1rem;font-weight:700;color:var(--accent);margin-bottom:4px">${symbol}</div>
      <div style="font-size:.75rem;color:var(--text3);margin-bottom:18px">${escHtml(s.name||'')}</div>
      <div class="form-group">
        <label class="form-label">カスタム別名（コードの横に表示）</label>
        <input class="form-input" id="alias-input" value="${escHtml(s.alias||'')}" placeholder="例：私のS&P500" maxlength="20">
      </div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn btn-primary" style="flex:1" onclick="saveCardSettings('${symbol}',this.closest('div[style*=fixed]'))">保存</button>
        <button class="btn" style="flex:1" onclick="this.closest('div[style*=fixed]').remove()">キャンセル</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => { const inp = document.getElementById('alias-input'); if (inp) inp.focus(); }, 50);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function saveCardSettings(symbol, overlay) {
  const s = config.stocks.find(st => st.symbol === symbol);
  if (!s) return;
  const inp = document.getElementById('alias-input');
  s.alias = inp ? inp.value.trim() : '';
  overlay.remove();
  await saveConfig();
  renderAll();
  showToast('別名を保存しました', 'success');
}

// フォントスライダー
document.addEventListener('DOMContentLoaded', () => {
  // 設定ページのフォントスライダー
  const sl = document.getElementById('font-scale-slider');
  if (sl) sl.addEventListener('input', function() {
    applyFontScale(parseFloat(this.value));
    config.settings.fontScale = parseFloat(this.value);
  });
  // 設定ページのカードスライダー
  const cs = document.getElementById('card-size-slider');
  if (cs) cs.addEventListener('input', function() {
    applyCardSize(this.value);
    config.settings.cardSize = this.value;
  });
});

// QAバー: フォント
function qaFontChange(el) {
  const v = parseFloat(el.value);
  applyFontScale(v);
  config.settings.fontScale = v;
}
// QAバー: カード
function qaCardChange(el) {
  applyCardSize(el.value);
  config.settings.cardSize = el.value;
}
