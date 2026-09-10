"use strict";

function homeTemplate() {
  var levelChips = LEVELS.map(function (id) {
    return '<button class="chip ' + (id === state.level ? "active" : "") + '" data-act="pickLevel" data-arg="' + id + '">' + id + "</button>";
  }).join("");

  var catTiles = CATEGORIES.map(function (c) {
    return '<div class="tile" data-act="pickCat" data-arg="' + c.id + '">' +
      '<div class="glyph" style="background:' + c.bg + ';color:' + c.fg + '">' + c.glyph + "</div>" +
      '<div class="name">' + c.name + "</div>" +
      '<div class="count mono">' + c.count + "</div></div>";
  }).join("");

  return '<div><h1 class="screen-title">早上好</h1><p class="screen-sub">' + state.level + ' 阶段 · 继续保持节奏</p></div>' +
    '<div class="chip-row">' + levelChips + "</div>" +
    '<div class="review-card"><div><div class="num mono">' + state.homeStats.total + '</div><div class="lbl">条到期待复习</div></div>' +
    '<button class="review-btn" data-act="review">去复习</button></div>' +
    '<div class="mistake-row" data-act="mistakes"><div class="glyph">誤</div>' +
    '<div class="body"><div class="title">错题本</div><div class="desc">强化重练，掌握后自动移出</div></div>' +
    '<div class="count mono">' + state.homeStats.mistakes + "</div></div>" +
    '<div class="stats-row" data-act="stats"><div class="glyph">曲</div>' +
    '<div class="body"><div class="title">学习曲线</div><div class="desc">复习历史、记住率，遗忘曲线在这看</div></div>' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></div>' +
    '<div><div class="screen-sub" style="margin-bottom:10px">按分类学习</div><div class="tile-grid">' + catTiles + "</div></div>";
}
