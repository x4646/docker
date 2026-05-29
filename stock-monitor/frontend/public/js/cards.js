// ── js/cards.js  株カード描画 ────────────────────────

function csym(c) {
  return { CNY:'¥', HKD:'HK$', JPY:'¥', USD:'$', EUR:'€', GBP:'£' }[c] || (c ? c+' ' : '$');
}

function fmtVol(v) {
  if (v >= 1e8) return (v/1e8).toFixed(1) + '億';
  if (v >= 1e4) return (v/1e4).toFixed(1) + '万';
  if (v >= 1e6) return (v/1e6).toFixed(1) + 'M';
  return v.toLocaleString();
}

function skeletonCard(sym) {
  return `<div class="stock-card">
    <div style="margin-bottom:12px">
      <div class="skeleton" style="height:19px;width:75px;margin-bottom:6px"></div>
      <div class="skeleton" style="height:12px;width:120px"></div>
    </div>
    <div class="skeleton" style="height:30px;width:100px;margin-bottom:6px"></div>
    <div class="skeleton" style="height:13px;width:85px"></div>
  </div>`;
}

function stockCard(p, stockCfg) {
  stockCfg = stockCfg || config.stocks.find(s => s.symbol === p.symbol) || {};

  const isUp = p.change >= 0, isNeutral = p.change === 0;
  const bc = isNeutral ? 'badge-neutral' : isUp ? 'badge-up' : 'badge-down';
  const tc = isNeutral ? 'text-neutral' : isUp ? 'text-up' : 'text-down';
  const ar = isNeutral ? '—' : isUp ? '▲' : '▼';
  const stM = {
    REGULAR: ['state-regular', '取引中'],
    PRE:     ['state-pre',     '前場前'],
    POST:    ['state-post',    '後場後'],
    CLOSED:  ['state-closed',  '終了']
  };
  const [sc, sl] = stM[p.marketState] || ['state-closed', '—'];
  const cs2 = csym(p.currency);
  const fmt = n => n == null ? '—' : n > 999 ? n.toLocaleString('ja-JP') : n.toFixed(2);

  // JPY換算（カード個別設定 or グローバル設定）
  const globalJpy = config.settings.jpyDisplay || 'none';
  const cardJpy   = stockCfg.jpyOn !== undefined ? stockCfg.jpyOn : null;
  const showJpy   = cardJpy !== null
    ? cardJpy
    : (globalJpy === 'all' || (globalJpy === 'usd' && p.currency === 'USD'));
  let jpyLine = '';
  if (p.currency !== 'JPY' && showJpy) {
    const jpyVal = toJpy(p.price, p.currency);
    if (jpyVal) jpyLine = `<div class="stock-price-jpy">≈ ¥${Math.round(jpyVal).toLocaleString('ja-JP')}</div>`;
  }

  // 別名
  const aliasHtml = stockCfg.alias
    ? `<span style="font-size:calc(.65rem * var(--font-scale));color:var(--gold);font-weight:400;letter-spacing:0">${escHtml(stockCfg.alias)}</span>`
    : '';

  return `<div class="stock-card" draggable="true" data-symbol="${p.symbol}" onclick="openChart('${p.symbol}','${escJs(p.name||p.symbol)}')">
    <div class="stock-card-actions">
      <div class="icon-btn drag-handle" title="ドラッグで並び替え" style="cursor:grab;font-size:14px">⠿</div>
      <div class="icon-btn" title="别名/设置" onclick="openCardSettings(event,'${p.symbol}')">✏️</div>
      <div class="icon-btn" title="${showJpy?'隐藏':'显示'}日元" onclick="toggleCardJpy(event,'${p.symbol}')" style="color:${showJpy?'var(--gold)':'var(--text3)'}">¥</div>
      <div class="icon-btn" onclick="removeStock(event,'${p.symbol}')">✕</div>
    </div>
    <div class="stock-header">
      <div>
        <div class="stock-symbol">${p.symbol} ${aliasHtml}</div>
        <div class="stock-name">${escHtml(p.name||'')}</div>
      </div>
      <div style="text-align:right">
        <span class="stock-badge ${bc}">${ar} ${p.changePct>=0?'+':''}${p.changePct.toFixed(2)}%</span><br>
        <span class="market-state ${sc}" style="margin-left:0;margin-top:3px;display:inline-block">${sl}</span>
      </div>
    </div>
    <div class="stock-price ${tc}">${cs2}${fmt(p.price)}</div>
    ${jpyLine}
    <div class="stock-change ${tc}">${ar} ${p.change>=0?'+':''}${fmt(p.change)}
      <span style="color:var(--text3)">前日 ${fmt(p.prevClose)}</span>
    </div>
    <div class="stock-meta">
      <div class="meta-item">
        <div class="meta-label">${p.isMutualFund?'種別':'最高'}</div>
        <div class="meta-value ${p.isMutualFund?'':'text-up'}">${p.isMutualFund?'投信':fmt(p.high)}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">${p.isMutualFund?'基準日':'最低'}</div>
        <div class="meta-value ${p.isMutualFund?'':'text-down'}">${p.isMutualFund?(p.navDate||'—'):fmt(p.low)}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">出来高</div>
        <div class="meta-value">${p.volume?fmtVol(p.volume):'—'}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">通貨</div>
        <div class="meta-value" style="color:var(--gold)">${p.currency||'—'}</div>
      </div>
    </div>
  </div>`;
}
