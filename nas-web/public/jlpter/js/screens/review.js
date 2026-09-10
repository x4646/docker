"use strict";

// 复习范围选择：按大类（全部/词汇/语法/句型…），词汇/语法/句型再往下还能按词性/功能分类筛——
// 跟"选词建批次"页复用同一份 FILTER_CONFIG，避免两套筛选逻辑走样。
// 这里的筛选项都是固定顺序表（LEVELS/POS_ORDER/GROUP_ORDER），不再需要扫全量词条来算"哪些值实际出现过"
function reviewScopeRow() {
  var catChips = ['<button class="chip ' + (state.reviewCategory === "all" ? "active" : "") + '" data-act="setReviewCategory" data-arg="all">全部</button>']
    .concat(CATEGORIES.map(function (c) {
      return '<button class="chip ' + (state.reviewCategory === c.id ? "active" : "") + '" data-act="setReviewCategory" data-arg="' + c.id + '">' + c.name + "</button>";
    }));

  var subRow = "";
  var cfg = FILTER_CONFIG[state.reviewCategory];
  if (cfg) {
    subRow = filterChipRow(
      { get: function () { return state.reviewFilter; }, set: function (v) { state.reviewFilter = v; } },
      "setReviewFilter", cfg.order
    );
  }

  // 等级筛选：跟分类/词性是独立的第三个维度。/review/due 后端本身就支持不限等级查询，不受懒加载限制，所以这里保留"全部"
  var levelRow = filterChipRow(
    { get: function () { return state.reviewLevel; }, set: function (v) { state.reviewLevel = v; } },
    "setReviewLevel", LEVELS
  );

  return '<div class="screen-sub" style="margin:2px 0 6px">复习范围</div><div class="chip-row">' + catChips.join("") + "</div>" + levelRow + subRow;
}

function reviewTemplate() {
  var scopeRow = reviewScopeRow();
  if (state.reviewLoading) {
    return backRow() + '<div><h1 class="screen-title">复习</h1></div>' + scopeRow + '<div class="empty-state">加载复习队列中…</div>';
  }
  var total = state.reviewQueue.length;
  if (total === 0) {
    return backRow() + '<div><h1 class="screen-title">复习</h1></div>' + scopeRow +
      '<div class="empty-state">这个范围里现在没有需要复习的内容</div>';
  }
  if (state.reviewIndex >= total) {
    return backRow() + '<div><h1 class="screen-title">复习</h1></div>' + scopeRow +
      '<div class="empty-state">这一批复习完成了，共 ' + total + ' 条<button class="add-btn" data-act="review">再拉一批</button></div>';
  }

  var item = state.reviewQueue[state.reviewIndex];
  var idx = state.reviewIndex + 1;
  var pct = Math.round((state.reviewIndex / total) * 100);

  var rateRow = "";
  if (state.reviewFlipped) {
    rateRow = '<div class="rate-row" style="flex-wrap:wrap">' +
      '<button class="rate-btn forgot" data-act="rateReview" data-arg="1">忘记了</button>' +
      '<button class="rate-btn" data-act="rateReview" data-arg="2">有点难</button>' +
      '<button class="rate-btn" data-act="rateReview" data-arg="3">记得</button>' +
      '<button class="rate-btn remember" data-act="rateReview" data-arg="4">很简单</button>' +
      "</div>";
  }

  return backRow() +
    '<div><h1 class="screen-title">复习</h1><p class="screen-sub">' + (item.isNew ? "新内容" : "到期复习") + " · 第 " + idx + " / " + total + " 条</p></div>" +
    scopeRow +
    '<div class="progress-line"><span class="mono">' + idx + " / " + total + '</span><div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div></div>' +
    '<div class="flash-stage"><div class="flash-card ' + (state.reviewFlipped ? "flipped" : "") +
    (["grammar", "pattern", "idiom"].indexOf(item.category) !== -1 ? " long" : "") + '" data-act="flipReview">' +
    '<div class="flash-face front">' + item.kanji + "</div>" +
    '<div class="flash-face back"><div class="kana">' + (item.kana || "") + "</div>" +
    '<div class="cn">' + item.cn + "</div><div class=\"en\">" + item.en + "</div>" +
    playBtnHtml(item.id, item.kana, item.kanji, false) + "</div>" +
    "</div></div>" +
    '<div class="flash-hint">点击卡片翻面看释义，再选一个记忆程度</div>' +
    rateRow;
}

// ---- 复习模块：FSRS 到期队列 ----
function loadReviewQueue() {
  state.reviewLoading = true;
  state.reviewQueue = [];
  state.reviewIndex = 0;
  state.reviewFlipped = false;
  render();
  var params = ["limit=20"];
  if (state.reviewCategory !== "all") params.push("category=" + encodeURIComponent(state.reviewCategory));
  var cfg = FILTER_CONFIG[state.reviewCategory];
  if (cfg && state.reviewFilter !== "all") {
    params.push((cfg.field === "pos" ? "pos" : "group") + "=" + encodeURIComponent(state.reviewFilter));
  }
  if (state.reviewLevel !== "all") params.push("level=" + encodeURIComponent(state.reviewLevel));
  if (state.jlptScope !== "all") params.push("jlptScope=" + encodeURIComponent(state.jlptScope));
  api("GET", "/review/due?" + params.join("&")).then(function (items) {
    state.reviewQueue = items;
    state.reviewLoading = false;
    render();
  }).catch(function () {
    state.reviewLoading = false;
    render();
  });
}

function submitReview(rating) {
  var item = state.reviewQueue[state.reviewIndex];
  if (!item) return;
  api("POST", "/review/" + encodeURIComponent(item.id), { rating: rating }).then(function () {
    state.reviewIndex += 1;
    state.reviewFlipped = false;
    render();
    if (state.reviewIndex >= state.reviewQueue.length) refreshHomeStats();
  }).catch(function (err) {
    alert("提交复习结果失败：" + err.message);
  });
}

// ---- 错题本：拉最近评分是"忘记/有点难"的词，进自测强化重练 ----
function enterMistakes() {
  state.screen = "test";
  state.mistakeMode = true;
  state.mistakePool = [];
  render();
  api("GET", "/mistakes").then(function (words) {
    state.mistakePool = words;
    state.qIndex = 0;
    render();
  }).catch(function () {
    render();
  });
}
