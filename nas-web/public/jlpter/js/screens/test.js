"use strict";

// 自测题库按当前分类现算，不再是写死的3道单词题——填空/听写需要有假名可拆，
// 分类里没有带假名注音的条目（比如大多数语法点）时这两种模式就没法用，只能翻卡回忆。
// 错题本模式下题库换成"最近一次评分是忘记/有点难"的词（来自 svc-jp），不看分类
function testPool() {
  var all = state.mistakeMode ? state.mistakePool : (getScopedWords(state.learnCategory, state.level) || []);
  if (state.testMode === "flash") return all;
  return all.filter(function (w) { return w.kana && toKanaChars(w.kana).length >= 2; });
}

function currentQuestion() {
  var pool = testPool();
  if (pool.length === 0) return null;
  var w = pool[state.qIndex % pool.length];
  if (state.testMode === "flash") {
    return { id: w.id, kanji: w.kanji, kanaFull: w.kana || "", cn: w.cn || "", en: w.en || "" };
  }
  var chars = toKanaChars(w.kana);
  var maskLen = chars.length >= 4 ? 2 : 1;
  var cut = chars.length - maskLen;
  return {
    id: w.id,
    kanji: w.kanji,
    kanaFull: w.kana,
    maskPrefix: chars.slice(0, cut).join(""),
    maskSuffix: "",
    answer: chars.slice(cut).join(""),
    cn: w.cn || "",
    en: w.en || ""
  };
}

// 自测的作答结果现在会同步进 FSRS 排期——之前填空/听写/翻卡这三种（尤其是填空、听写，属于主动检索，
// 巩固记忆的效果比"复习"页那种看答案自评强得多）算完对错就扔了，从来不影响复习计划，
// 错题本也因此完全看不到自测里答错的词。统一映射成 FSRS 的 Again(1)/Good(3) 两档，静默上报，
// 失败了不打扰做题流程（离线/网络抖动不该卡住自测）
function submitTestResult(wordId, correct) {
  if (!wordId) return;
  api("POST", "/review/" + encodeURIComponent(wordId), { rating: correct ? 3 : 1 }).catch(function () {});
}

// flash 模式点"没记住/还记得"：以前这里的 rate 分支根本没读 arg，两个按钮点哪个效果都一样（只推进题号），
// 现在既要把选择写回 FSRS，也要让"没记住"真正记为 Again
function submitTestRating(arg) {
  var q = currentQuestion();
  if (q) submitTestResult(q.id, arg === "remember");
  state.qIndex += 1;
  state.flashFlipped = false;
  render();
}

function kanaPadTemplate() {
  // 每行五十音图的一行单独成一个 DOM 行（.kana-row），行内固定 5 个格子——
  // 这样不管外层给 .kana-key 调多大/多小，行与行之间永远不会串到一起
  var rows = KANA_ROWS.map(function (row) {
    var cells = row.map(function (k) {
      return k
        ? ('<button class="kana-key" data-act="tapKana" data-arg="' + k + '">' + k + "</button>")
        : '<div class="kana-key kana-blank"></div>';
    }).join("");
    return '<div class="kana-row">' + cells + "</div>";
  }).join("");
  return '<div class="kana-popover">' +
    '<div class="kana-popover-head">点选假名<button class="kana-close" data-act="setInputMode" data-arg="manual">×</button></div>' +
    '<div class="kana-pad">' + rows + "</div>" +
    '<div class="kana-util-row">' +
    '<button class="kana-util-btn" data-act="kanaBackspace">⌫ 删除</button>' +
    '<button class="kana-util-btn" data-act="kanaClear">清空</button>' +
    "</div>" +
    "</div>";
}

function testTemplate() {
  var cat = CATEGORIES.filter(function (c) { return c.id === state.learnCategory; })[0] || CATEGORIES[0];

  if (!state.mistakeMode) {
    var loadCheck = getScopedWords(state.learnCategory, state.level);
    if (loadCheck === null) {
      return backRow() + '<div><h1 class="screen-title">自测</h1></div><div class="empty-state">加载中…</div>';
    }
  }

  var pool = testPool();
  var q = currentQuestion();
  var total = pool.length;
  var idx = total > 0 ? (state.qIndex % total) + 1 : 0;
  var pct = total > 0 ? Math.round((idx / total) * 100) : 0;

  var body;
  if (!q) {
    // 这个分类里没有带假名的条目，填空/听写没法出题——只能先用翻卡回忆
    body = '<div class="empty-state">这个分类还没有假名注音，暂时不能填空/听写<button class="add-btn" data-act="pickMode" data-arg="flash">换成翻卡回忆</button></div>';
  } else if (state.testMode === "flash") {
    var rateRow = "";
    if (state.flashFlipped) {
      rateRow = '<div class="rate-row">' +
        '<button class="rate-btn forgot" data-act="rate" data-arg="forgot">没记住</button>' +
        '<button class="rate-btn remember" data-act="rate" data-arg="remember">还记得</button></div>';
    }
    body = '<div class="flash-stage"><div class="flash-card ' + (state.flashFlipped ? "flipped" : "") + '" data-act="flip">' +
      '<div class="flash-face front">' + q.kanji + "</div>" +
      '<div class="flash-face back"><div class="kana">' + q.kanaFull + "</div>" +
      '<div class="cn">' + q.cn + "</div><div class=\"en\">" + q.en + "</div></div></div></div>" +
      '<div class="flash-hint">点击卡片翻面</div>' + rateRow;
  } else {
    var isDict = state.testMode === "dictation";
    var target = isDict ? q.kanaFull : q.answer;
    var top = isDict
      ? '<div class="question-hint">播放范读，输入完整假名</div>' +
        '<button class="round-btn ' + (state.playPulse ? "playing" : "") + '" data-act="playAudio" style="margin:0 auto">音<span class="lbl">播放</span></button>'
      : '<div class="question-hint">中文释义：' + q.cn + "　·　请填写空缺处假名</div>" +
        '<div class="question-jp">' + q.maskPrefix + '<span class="blank">＿＿</span>' + q.maskSuffix + "</div>";

    var after;
    if (!state.testSubmitted) {
      after = '<button class="primary-btn" data-act="submit">提交</button>';
    } else {
      var fb = state.lastFeedback;
      var chars = fb.chars.map(function (c) {
        return '<div class="char-box ' + c.cls + '">' + c.ch + "</div>";
      }).join("");
      after = '<div class="feedback-banner ' + (state.testCorrect ? "ok" : "bad") + '">' +
        (state.testCorrect ? "答对了" : "还差一点，再看看") + "</div>" +
        '<div class="char-row">' + chars + "</div>" +
        '<button class="ghost-btn" data-act="next">下一题</button>';
    }

    var inputCls = state.testSubmitted ? (state.testCorrect ? "ok" : "bad") : "";
    var modeToggle = '<div class="input-mode-row">' +
      '<button class="input-mode-btn ' + (state.inputMode === "manual" ? "active" : "") + '" data-act="setInputMode" data-arg="manual">手动输入</button>' +
      '<button class="input-mode-btn ' + (state.inputMode === "pick" ? "active" : "") + '" data-act="setInputMode" data-arg="pick">点选假名</button>' +
      "</div>";
    var pickMode = state.inputMode === "pick";
    var kanaPad = (pickMode && !state.testSubmitted) ? kanaPadTemplate() : "";

    var inputBlock = modeToggle + '<div class="question-card">' + top + "</div>" +
      '<input id="answer-input" class="answer-input ' + inputCls + '" type="text" placeholder="' +
      (isDict ? "输入完整假名" : "输入假名") + '"' + (state.testSubmitted ? " disabled" : "") + (pickMode ? " readonly" : "") + " />" +
      after;

    // 点选假名模式下键盘很长要滚动，把题目/输入框/提交固定在顶部不跟着滚走
    body = pickMode
      ? ('<div class="sticky-top">' + inputBlock + "</div>" + kanaPad)
      : inputBlock;
  }

  return backRow() +
    '<div><h1 class="screen-title">' + (state.mistakeMode ? "错题本 · 强化练习" : "自测") + "</h1>" +
    '<p class="screen-sub">' + (state.mistakeMode ? "优先练习尚未掌握的内容" : (state.level + " · " + (cat ? cat.name : ""))) + "</p></div>" +
    '<div class="seg-row">' +
    '<button class="seg-btn ' + (state.testMode === "cloze" ? "active" : "") + '" data-act="pickMode" data-arg="cloze">填空默写</button>' +
    '<button class="seg-btn ' + (state.testMode === "dictation" ? "active" : "") + '" data-act="pickMode" data-arg="dictation">听写</button>' +
    '<button class="seg-btn ' + (state.testMode === "flash" ? "active" : "") + '" data-act="pickMode" data-arg="flash">翻卡回忆</button>' +
    "</div>" +
    '<div class="progress-line"><span class="mono">' + idx + " / " + total + '</span><div class="progress-track">' +
    '<div class="progress-fill" style="width:' + pct + '%"></div></div></div>' +
    body;
}

function doSubmit() {
  var input = document.getElementById("answer-input");
  var val = input ? input.value : "";
  var q = currentQuestion();
  var target = state.testMode === "dictation" ? q.kanaFull : q.answer;
  var fb = computeFeedback(val, target);
  state.testSubmitted = true;
  state.testCorrect = fb.correct;
  state.lastInput = val;
  state.lastFeedback = fb;
  submitTestResult(q.id, fb.correct);
  render(true); // 提交后输入框保留刚才打的内容（配合下面的逐字反馈），下一题再清空
}
