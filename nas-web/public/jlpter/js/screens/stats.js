"use strict";

// ---- 统计/学习曲线：复习历史 + 记住率，从 review_log 里现算的，不是估的 ----
function loadStats() {
  state.statsLoading = true;
  render();
  Promise.all([
    api("GET", "/stats/overview"),
    api("GET", "/stats/history?days=30")
  ]).then(function (results) {
    state.statsOverview = results[0];
    state.statsHistory = results[1];
    state.statsLoading = false;
    render();
  }).catch(function () {
    state.statsLoading = false;
    render();
  });
}

function svgBarChart(data) {
  var w = 300, h = 70, pad = 2;
  var max = Math.max.apply(null, data.map(function (d) { return d.total; }).concat([1]));
  var barW = (w - pad * 2) / data.length;
  var bars = data.map(function (d, i) {
    var barH = (d.total / max) * (h - pad * 2 - 4);
    var x = pad + i * barW;
    var y = h - pad - barH;
    return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(1, barW - 1.2).toFixed(1) +
      '" height="' + Math.max(0, barH).toFixed(1) + '" rx="1" fill="var(--indigo)" opacity="0.85">' +
      "<title>" + d.date + "：复习 " + d.total + " 次</title></rect>";
  }).join("");
  return '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" style="width:100%; height:70px; display:block">' + bars + "</svg>";
}

function svgLineChart(data) {
  var w = 300, h = 70, pad = 6;
  var pts = data.map(function (d, i) {
    var x = pad + (data.length <= 1 ? 0 : (i / (data.length - 1)) * (w - pad * 2));
    var rate = d.total > 0 ? d.remembered / d.total : null;
    var y = rate === null ? null : (h - pad) - rate * (h - pad * 2);
    return { x: x, y: y, rate: rate, date: d.date };
  });
  var valid = pts.filter(function (p) { return p.y !== null; });
  if (valid.length === 0) {
    return '<svg viewBox="0 0 ' + w + " " + h + '" style="width:100%; height:70px; display:block"></svg>';
  }
  var pathD = valid.map(function (p, i) { return (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" ");
  var dots = valid.map(function (p) {
    return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="2.4" fill="var(--moss)">' +
      "<title>" + p.date + "：记住率 " + Math.round(p.rate * 100) + "%</title></circle>";
  }).join("");
  return '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" style="width:100%; height:70px; display:block">' +
    '<path d="' + pathD + '" fill="none" stroke="var(--moss)" stroke-width="1.5" />' + dots + "</svg>";
}

function statsTemplate() {
  if (state.statsLoading || !state.statsOverview) {
    return backRow() + '<div><h1 class="screen-title">学习曲线</h1></div><div class="empty-state">加载中…</div>';
  }
  var ov = state.statsOverview;
  var retentionText = ov.retention === null ? "—" : Math.round(ov.retention * 100) + "%";

  var statTiles = [
    { label: "已学习 / 总词数", value: ov.reviewedWords + " / " + ov.totalWords },
    { label: "累计复习次数", value: String(ov.totalReviews) },
    { label: "记住率", value: retentionText },
    { label: "累计遗忘次数", value: String(ov.lapses) }
  ].map(function (t) {
    return '<div class="stat-tile"><div class="stat-value mono">' + t.value + '</div><div class="stat-label">' + t.label + "</div></div>";
  }).join("");

  var stateRows = [
    { key: "new", label: "新内容", color: "var(--ink-faint)" },
    { key: "learning", label: "学习中", color: "var(--hanko)" },
    { key: "review", label: "复习中", color: "var(--indigo)" },
    { key: "relearning", label: "重新学习", color: "var(--moss)" }
  ].map(function (s) {
    return '<div class="state-row"><span class="state-dot" style="background:' + s.color + '"></span>' +
      '<span class="state-label">' + s.label + '</span><span class="mono state-count">' + ov.byState[s.key] + "</span></div>";
  }).join("");

  return backRow() +
    '<div><h1 class="screen-title">学习曲线</h1><p class="screen-sub">数据来自你每次复习自评，不是估的</p></div>' +
    '<div class="stat-grid">' + statTiles + "</div>" +
    '<div class="card">' +
    '<div class="chart-title">近 30 天复习次数</div>' + svgBarChart(state.statsHistory) +
    "</div>" +
    '<div class="card">' +
    '<div class="chart-title">近 30 天记住率</div>' + svgLineChart(state.statsHistory) +
    "</div>" +
    '<div class="card"><div class="chart-title">词条状态分布</div>' + stateRows + "</div>";
}
