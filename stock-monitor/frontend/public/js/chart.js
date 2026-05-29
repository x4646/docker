// ── js/chart.js  チャートモーダル（redesigned）────────

let chartSymbol   = null;
let chartInstance = null;
let chartRange    = '1mo';
let chartData     = null; // 現在のデータを保持

function openChart(symbol, name) {
  chartSymbol = symbol;
  chartRange  = '1mo';

  // ヘッダー情報セット
  document.getElementById('chart-symbol-title').textContent = symbol;
  document.getElementById('chart-name-sub').textContent = name;

  // 現在価格をすぐに反映
  const p = priceData[symbol];
  if (p) updateChartHeader(p);

  document.getElementById('chart-modal').classList.add('show');
  document.body.style.overflow = 'hidden';

  // タブリセット
  document.querySelectorAll('.range-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.range-tab')[2].classList.add('active');

  loadChart(document.querySelectorAll('.range-tab')[2], '1mo');
}

function closeChartModal() {
  document.getElementById('chart-modal').classList.remove('show');
  document.body.style.overflow = '';
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  chartData = null;
}

// ── ヘッダー価格表示 ──────────────────────────────────
function updateChartHeader(p) {
  const cs2   = csym(p.currency);
  const fmt   = n => n == null ? '—' : n > 999 ? n.toLocaleString('ja-JP', {minimumFractionDigits:2, maximumFractionDigits:2}) : n.toFixed(2);
  const isUp  = p.change >= 0;
  const color = isUp ? 'var(--up)' : 'var(--down)';
  const arrow = isUp ? '▲' : '▼';

  document.getElementById('chart-price-main').innerHTML =
    `<span style="font-size:2.8rem;font-weight:700;font-family:var(--mono);color:var(--text);letter-spacing:-1px">${cs2}${fmt(p.price)}</span>
     <span style="font-size:1.1rem;color:${color};font-family:var(--mono);margin-left:14px;font-weight:700">${arrow} ${p.change>=0?'+':''}${fmt(p.change)} (${p.changePct>=0?'+':''}${p.changePct.toFixed(2)}%)</span>`;

  // JPY換算
  let jpyStr = '';
  if (p.currency !== 'JPY' && fxRates[p.currency + '_JPY']) {
    const jv = Math.round(p.price * fxRates[p.currency + '_JPY']).toLocaleString('ja-JP');
    jpyStr = `<span style="color:var(--gold)">≈ ¥${jv}</span>`;
  }
  document.getElementById('chart-price-jpy').style.fontSize = '1rem';
  document.getElementById('chart-price-jpy').innerHTML = jpyStr;

  // 指標バー
  document.getElementById('chart-stats-bar').innerHTML = `
    <div class="cstat"><div class="cstat-label">始値</div><div class="cstat-val">${cs2}${fmt(p.prevClose)}</div></div>
    <div class="cstat"><div class="cstat-label">高値</div><div class="cstat-val text-up">${cs2}${fmt(p.high)}</div></div>
    <div class="cstat"><div class="cstat-label">安値</div><div class="cstat-val text-down">${cs2}${fmt(p.low)}</div></div>
    <div class="cstat"><div class="cstat-label">出来高</div><div class="cstat-val">${p.volume ? fmtVol(p.volume) : '—'}</div></div>
    <div class="cstat"><div class="cstat-label">市場</div><div class="cstat-val" style="color:var(--gold)">${p.currency||'—'}</div></div>
    <div class="cstat"><div class="cstat-label">状態</div><div class="cstat-val">${{REGULAR:'取引中',PRE:'前場前',POST:'後場後',CLOSED:'終了'}[p.marketState]||'—'}</div></div>`;
}

// ── チャート描画 ──────────────────────────────────────
async function loadChart(btn, range) {
  chartRange = range;
  document.querySelectorAll('.range-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const canvas  = document.getElementById('chart-canvas');
  const loading = document.getElementById('chart-loading');
  if (loading) loading.style.display = 'flex';

  try {
    const r    = await fetch(`${API}/api/history/${chartSymbol}?range=${range}`);
    const data = await r.json();
    chartData  = data;

    if (loading) loading.style.display = 'none';
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

    if (data.isMutualFund) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.parentElement.innerHTML = `
        <div style="height:300px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text3);gap:10px">
          <div style="font-size:2rem;opacity:.3">📊</div>
          <div style="font-size:.85rem">投資信託は日次NAVのためチャートなし</div>
          <div style="font-size:.75rem;color:var(--text3)">楽天証券アプリでご確認ください</div>
        </div>`;
      return;
    }

    const pts    = data.points || [];
    const labels = pts.map(pt => {
      const d = new Date(pt.t);
      if (range === '1d')  return d.toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'});
      if (range === '5d')  return d.toLocaleDateString('ja-JP', {month:'numeric', day:'numeric'}) + ' ' + d.toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'});
      if (range === '1y' || range === '5y') return d.toLocaleDateString('ja-JP', {year:'2-digit', month:'short'});
      return d.toLocaleDateString('ja-JP', {month:'short', day:'numeric'});
    });
    const values = pts.map(pt => pt.v);
    const first  = values.find(v => v != null) || 0;
    const last   = values.filter(v => v != null).slice(-1)[0] || 0;
    const isUp   = last >= first;
    const upColor   = '#ff4455';
    const downColor = '#3ddc84';
    const lc = isUp ? upColor : downColor;

    const ctx = canvas.getContext('2d');
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: lc,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: lc,
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 2,
          fill: true,
          backgroundColor: ctx2 => {
            const g = ctx2.chart.ctx.createLinearGradient(0, 0, 0, 300);
            g.addColorStop(0, isUp ? 'rgba(255,68,85,.18)' : 'rgba(61,220,132,.18)');
            g.addColorStop(0.6, isUp ? 'rgba(255,68,85,.04)' : 'rgba(61,220,132,.04)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            return g;
          },
          tension: 0.3,
          spanGaps: true,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        animation: { duration: 400, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(14,20,32,0.95)',
            borderColor: 'rgba(64,208,255,.25)',
            borderWidth: 1,
            padding: { top:13, bottom:13, left:18, right:18 },
            titleColor: '#90b8d8',
            bodyColor: '#f0f6ff',
            titleFont: { family:"'Space Mono',monospace", size:13, weight:'normal' },
            bodyFont:  { family:"'Space Mono',monospace", size:17, weight:'bold' },
            displayColors: false,
            callbacks: {
              title: items => items[0]?.label || '',
              label: item => {
                const v = item.parsed.y;
                if (v == null) return '—';
                const p = priceData[chartSymbol];
                const cs2 = p ? csym(p.currency) : '';
                return cs2 + (v > 999 ? v.toLocaleString('ja-JP', {minimumFractionDigits:2}) : v.toFixed(2));
              },
              afterLabel: item => {
                const v  = item.parsed.y;
                const p  = priceData[chartSymbol];
                if (!v || !p) return '';
                const diff = v - p.prevClose;
                const pct  = (diff / p.prevClose * 100).toFixed(2);
                return (diff >= 0 ? '▲ +' : '▼ ') + diff.toFixed(2) + '  (' + (diff>=0?'+':'') + pct + '%)';
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: '#90b8d8',
              font: { family:"'Noto Sans SC',sans-serif", size: 12 },
              maxTicksLimit: range === '1d' ? 8 : range === '5d' ? 6 : 7,
              maxRotation: 0,
            },
            grid: { color: 'rgba(64,208,255,.06)', drawBorder: false },
            border: { color: 'rgba(64,208,255,.1)' }
          },
          y: {
            position: 'right',
            ticks: {
              color: '#90b8d8',
              font: { family:"'Space Mono',monospace", size: 13 },
              padding: 10,
              callback: v => v > 9999 ? (v/1000).toFixed(0)+'k' : v > 999 ? v.toLocaleString('ja-JP') : v.toFixed(2)
            },
            grid: { color: 'rgba(64,208,255,.06)', drawBorder: false },
            border: { color: 'transparent', dash: [4,4] }
          }
        }
      }
    });

  } catch(e) {
    if (loading) loading.style.display = 'none';
    console.error('Chart error:', e);
  }
}
