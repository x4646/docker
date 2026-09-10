"use strict";

var LEVELS = ["N5", "N4", "N3", "N2", "N1"];

// 分类列表（含实时统计条数），首页秒开只靠这个，不再一次性拉全部词条
var CATEGORIES = [];

// 词汇分类里的词性筛选顺序——固定顺序展示，不用出现的顺序（那样每次刷新都可能不一样）
var POS_ORDER = ["动词", "名词", "い形容词", "な形容词", "副词", "代词", "数词", "感叹词", "连体词", "接续词"];

// 语法/句型分类里的功能分类筛选顺序：顺接/逆接/因果/承上启下这些连接关系排前面，
// 其它语法功能（条件、请求、推测、授受……）跟着，寒暄用语放最后
var GROUP_ORDER = [
  "顺接／并列", "逆接／转折", "因果", "承上启下",
  "条件假设", "时间关系", "意愿／请求／许可", "推测／判断",
  "陈述判断", "助词结构", "能力／可能", "授受",
  "状态／经验", "程度／比较", "疑问／指代", "寒暄／礼貌用语"
];

// 每个分类用哪个字段筛选、按什么顺序展示——只有配置了的分类才会显示筛选栏
var FILTER_CONFIG = {
  vocab: { field: "pos", order: POS_ORDER },
  grammar: { field: "group", order: GROUP_ORDER },
  pattern: { field: "group", order: GROUP_ORDER }
};

// 频度筛选：所有分类通用（对应 words.freq_tag），没打过频度标签的词条不受这个筛选影响
// 频度改成1-5分（5=超高频常用，1=几乎不用），比之前"高/中/低"三档更细
var FREQ_ORDER = ["5", "4", "3", "2", "1"];
var FREQ_LABEL = { "5": "5分·超高频", "4": "4分", "3": "3分", "2": "2分", "1": "1分·罕用" };

// 通用筛选 chip 行：始终显示固定顺序表里的全部候选值 + "全部"，不再依赖已加载的词条数据来算"哪些值实际出现过"
// （以前要扫全量 WORDS 才能算，现在词条按分类/等级懒加载，没有全量数据可扫了）
function filterChipRow(activeValueGetSet, actionName, order, labelMap) {
  var active = activeValueGetSet.get();
  var chips = ['<button class="chip ' + (active === "all" ? "active" : "") + '" data-act="' + actionName + '" data-arg="all">全部</button>']
    .concat(order.map(function (p) {
      var label = labelMap && labelMap[p] ? labelMap[p] : p;
      return '<button class="chip ' + (active === p ? "active" : "") + '" data-act="' + actionName + '" data-arg="' + p + '">' + label + "</button>";
    }));
  return '<div class="chip-row" style="margin-bottom:8px">' + chips.join("") + "</div>";
}

// 等级筛选专用（选词建批次页）：改成 checkbox 多选——"全部"是第 6 个选项，勾了"全部"
// 就清空其它单独等级（等于不限等级），勾任意单独等级会自动取消"全部"，多个等级可以同时勾（合并查看）
function levelFilterCheckboxRow(levelFilterArr) {
  var isAll = levelFilterArr.length === 0;
  function box(active) { return '<span class="level-checkbox ' + (active ? "checked" : "") + '">' + (active ? "✓" : "") + "</span>"; }
  var allChip = '<button class="chip level-chip ' + (isAll ? "active" : "") + '" data-act="toggleLevelFilter" data-arg="all">' + box(isAll) + "全部</button>";
  var chips = LEVELS.map(function (lv) {
    var active = levelFilterArr.indexOf(lv) !== -1;
    return '<button class="chip level-chip ' + (active ? "active" : "") + '" data-act="toggleLevelFilter" data-arg="' + lv + '">' + box(active) + lv + "</button>";
  }).join("");
  return '<div class="chip-row" style="margin-bottom:8px">' + allChip + chips + "</div>";
}

// 五十音图排列：每行 5 个（あ行～わ行），后面接浊音／半浊音／拗音行，跟真实假名表一一对应，"" 表示表格里本来就没有这个格子
var KANA_ROWS = [
  ["あ", "い", "う", "え", "お"],
  ["か", "き", "く", "け", "こ"],
  ["さ", "し", "す", "せ", "そ"],
  ["た", "ち", "つ", "て", "と"],
  ["な", "に", "ぬ", "ね", "の"],
  ["は", "ひ", "ふ", "へ", "ほ"],
  ["ま", "み", "む", "め", "も"],
  ["や", "", "ゆ", "", "よ"],
  ["ら", "り", "る", "れ", "ろ"],
  ["わ", "", "", "", "を"],
  ["ん", "", "", "", ""],
  ["が", "ぎ", "ぐ", "げ", "ご"],
  ["ざ", "じ", "ず", "ぜ", "ぞ"],
  ["だ", "ぢ", "づ", "で", "ど"],
  ["ば", "び", "ぶ", "べ", "ぼ"],
  ["ぱ", "ぴ", "ぷ", "ぺ", "ぽ"],
  ["ゃ", "ゅ", "ょ", "っ", "ー"]
];

var API_BASE = "/api/jp";

// 所有会跨设备/跨浏览器复用的数据（词库、自定义词、批次、复习进度、主题/语速设置）都在 svc-jp 后端的
// SQLite 里，这里不再有本地持久化——state 里除了当前这次会话的临时交互状态，就是从服务端拉回来的缓存
var state = {
  screen: "home",
  level: "N5",
  theme: "light",
  uiScale: 1,
  speechRate: 0.9,
  expandedId: null,
  learnCategory: "vocab",
  learnBatch: null,
  batchesCache: {}, // { categoryId: [{id, category, wordIds, count}, ...] }
  wordsCache: {}, // { "category|level": [...词条] }，按分类+等级懒加载，取代原来一次性全量 WORDS
  allWordsCache: {}, // { category: [...该分类全量词条] }，选词建批次页用，整分类缓存一次，等级/词性/频度筛选全在本地做
  batchWordsCache: {}, // { batchId: [...词条] }，进某一批时按 id 列表懒加载
  selectingBatch: false,
  posFilter: "all", // 词汇分类选词建批次时的词性筛选，只在 category === "vocab" 时用得上
  freqFilter: "all", // 选词建批次时的频度筛选（1-5分/全部），对应 words.freq_score
  batchedFilter: "all", // 选词建批次时按"是否已收录进某个批次"筛：全部/未收录/已收录
  filtersOpen: false, // 筛选面板默认折叠，点开才展开，省地方
  batchesOpen: false, // 已建批次列表默认折叠，点开才展开
  settingsOpen: false, // 明暗度/语速/手动添加，收在侧边的悬浮设置面板，默认折叠
  levelFilter: [], // 选词建批次时的等级筛选，可勾选多个；空数组 = 不限等级（"全部"）
  visibleLimit: 150, // 选词建批次列表一次最多渲染这么多行，避免筛选"全部"时一次性建上万个DOM节点卡死；筛选变化时重置
  pendingSelection: [],
  pendingRemoval: [], // 批次页里直接勾选要移出的词，不用切模式
  mistakeMode: false,
  mistakePool: [], // 错题本模式下，自测题库来自这里而不是当前分类
  testMode: "cloze",
  inputMode: "manual",
  qIndex: 0,
  testSubmitted: false,
  testCorrect: false,
  lastInput: "",
  lastFeedback: null,
  flashFlipped: false,
  playPulse: false,
  wordPlayPulseId: null,
  shadowPlaying: false,
  shadowMicState: "idle",
  shadowResult: null,
  showAddModal: false,
  addError: null,
  enrichNote: false,
  homeStats: { due: 0, new: 0, total: 0, mistakes: 0 },
  statsOverview: null,
  statsHistory: [],
  statsLoading: false,
  // 复习模块：FSRS 到期队列，一次进来处理完一批
  reviewQueue: [],
  reviewIndex: 0,
  reviewFlipped: false,
  reviewLoading: false,
  reviewCategory: "all", // 复习范围：按大类筛，"all" = 不限分类
  reviewFilter: "all", // 复习范围：分类内再按词性/语法功能分类筛（跟词汇/语法页共用 FILTER_CONFIG）
  reviewLevel: "all", // 复习范围：再按等级筛，跟分类/词性是三个独立维度（/review/due 后端本来就支持不限等级，不受懒加载限制）
  // JLPT范围三态筛选：jlpt=只看官方JLPT范围内容，extra=只看超纲内容，all=不限——影响词汇/语法列表和复习队列
  // 默认就是 jlpt：数据库里全量语料含大量超纲/低质内容，首页条数/学习入口默认只应体现精简后的真实JLPT范围，
  // 避免"全部"的虚高总数误导用户对语料规模的判断，"全部"仍可在设置里手动切回
  jlptScope: "jlpt"
};

function api(method, path, body) {
  var opts = { method: method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  return fetch(API_BASE + path, opts).then(function (res) {
    if (!res.ok) {
      return res.json().catch(function () { return {}; }).then(function (e) {
        throw new Error(e.error || ("HTTP " + res.status));
      });
    }
    if (res.status === 204) return null;
    return res.json();
  });
}

function toKanaChars(s) { return Array.from(s || ""); }

function computeFeedback(input, answer) {
  var a = toKanaChars(input), b = toKanaChars(answer);
  var len = Math.max(a.length, b.length);
  var chars = [];
  for (var i = 0; i < len; i++) {
    var ch = a[i] || "＿";
    var ok = a[i] && a[i] === b[i];
    chars.push({ ch: ch, cls: ok ? "fb-ok" : "fb-bad" });
  }
  return { chars: chars, correct: input === answer };
}

// ---- 按需懒加载词条：按"分类+等级"分桶缓存，取代原来一次性全量塞进 WORDS ----
// 返回 null 表示正在加载中（第一次访问这个桶时会顺带发起请求），加载完成后 render() 会自然重新拿到数组
// level 可以是单个等级字符串，也可以是等级数组（多选，会用逗号拼给后端）或空数组（不限等级）
function getScopedWords(category, level) {
  var levelKey = Array.isArray(level) ? level.slice().sort().join(",") : level;
  var key = category + "|" + levelKey + "|" + state.jlptScope;
  var cached = state.wordsCache[key];
  if (cached !== undefined) return cached;
  state.wordsCache[key] = null;
  var qs = "/words?category=" + encodeURIComponent(category);
  if (levelKey) qs += "&level=" + encodeURIComponent(levelKey);
  if (state.jlptScope !== "all") qs += "&jlptScope=" + encodeURIComponent(state.jlptScope);
  api("GET", qs)
    .then(function (list) { state.wordsCache[key] = list; render(); })
    .catch(function () { state.wordsCache[key] = []; render(); });
  return null;
}

// 新增/删除自定义词条后，把该分类下已经缓存的桶清掉，下次访问会重新拉，避免看到过期数据
function invalidateWordsCache(category) {
  Object.keys(state.wordsCache).forEach(function (k) {
    if (k.indexOf(category + "|") === 0) delete state.wordsCache[k];
  });
  Object.keys(state.allWordsCache).forEach(function (k) {
    if (k.indexOf(category + "|") === 0) delete state.allWordsCache[k];
  });
}

// 切换 JLPT 范围三态：清掉所有按分类/等级缓存的词条（缓存键里带了 scope，理论上不用清也不会串数据，
// 但一次性清空能省内存，也确保马上重新拉取当前 scope 下的数据），批次内容（按id拉）不受影响不用清
function setJlptScope(scope) {
  if (scope === state.jlptScope) return;
  state.jlptScope = scope;
  state.wordsCache = {};
  state.allWordsCache = {};
  state.expandedId = null;
  saveLocalSetting("jlptScope", scope);
  loadCategories().then(render);
  refreshHomeStats();
  loadReviewQueue();
}

// ---- 选词建批次页专用：整个分类一次性全量拉回来缓存在浏览器里，之后等级/词性/频度/收录状态
// 筛选全部在本地做，不用每切一次筛选条件就打一次网络请求——点击筛选 chip 是纯本地重渲染，秒切换，
// 只有第一次进某个分类时要等一次网络请求（后台异步，加载完 render() 自动刷新，不卡交互） ----
function getAllScopedWords(category) {
  var key = category + "|" + state.jlptScope;
  var cached = state.allWordsCache[key];
  if (cached !== undefined) return cached;
  state.allWordsCache[key] = null;
  var qs = "/words?category=" + encodeURIComponent(category) + "&limit=30000";
  if (state.jlptScope !== "all") qs += "&jlptScope=" + encodeURIComponent(state.jlptScope);
  api("GET", qs)
    .then(function (list) { state.allWordsCache[key] = list; render(); })
    .catch(function () { state.allWordsCache[key] = []; render(); });
  return null;
}

// 某个批次的词条内容——只按 id 列表精确拉这一批的词，不是从全量词库里筛
function getBatchWords(batch) {
  var cached = state.batchWordsCache[batch.id];
  if (cached !== undefined) return cached;
  state.batchWordsCache[batch.id] = null;
  api("GET", "/words?ids=" + batch.wordIds.map(encodeURIComponent).join(","))
    .then(function (list) { state.batchWordsCache[batch.id] = list; render(); })
    .catch(function () { state.batchWordsCache[batch.id] = []; render(); });
  return null;
}

// "返回首页"按钮去掉了——底部tab栏本来就有"首页"入口，重复了
function backRow() {
  return "";
}

var lastRenderedKey = null;

function shellTemplate() {
  var content;
  if (state.screen === "home") content = homeTemplate();
  else if (state.screen === "learn") content = learnTemplate();
  else if (state.screen === "review") content = reviewTemplate();
  else if (state.screen === "stats") content = statsTemplate();
  else if (state.screen === "test") content = testTemplate();
  else content = shadowTemplate();

  var screenKey = state.screen + ":" + (state.screen === "learn" ? (state.learnCategory + ":" + state.learnBatch) : "");
  var isNewScreen = screenKey !== lastRenderedKey;
  lastRenderedKey = screenKey;
  var screenWrap = '<div class="screen' + (isNewScreen ? " screen-enter" : "") + '">' + content + "</div>";

  var themes = [
    { id: "light", label: "明" },
    { id: "medium", label: "中" },
    { id: "dark", label: "暗" }
  ];
  var themeBtns = themes.map(function (t) {
    return '<button class="theme-btn ' + (state.theme === t.id ? "active" : "") + '" data-act="setTheme" data-arg="' + t.id + '">' + t.label + "</button>";
  }).join("");

  var rateSlider = '<div class="rate-slider-wrap">' +
    '<input type="range" class="rate-slider" data-range-act="setRate" min="0.5" max="1.5" step="0.1" value="' + state.speechRate + '" />' +
    '<span class="mono rate-value">' + state.speechRate.toFixed(1) + "x</span></div>";

  // 明暗度/语速/手动添加，平时只留一个小圆点在右侧边缘，点开才悬浮出设置面板，不占正文空间
  var scalePct = Math.round(state.uiScale * 100);
  var uiScaleRow = '<div class="scale-control">' +
    '<button class="scale-btn" data-act="uiScaleDown" ' + (state.uiScale <= UI_SCALE_MIN ? "disabled" : "") + '>－</button>' +
    '<span class="scale-value mono" data-act="uiScaleReset" title="点击重置为100%">' + scalePct + "%</span>" +
    '<button class="scale-btn" data-act="uiScaleUp" ' + (state.uiScale >= UI_SCALE_MAX ? "disabled" : "") + ">＋</button></div>";

  var jlptScopeOpts = [
    { id: "all", label: "全部内容" },
    { id: "jlpt", label: "仅JLPT范围" },
    { id: "extra", label: "仅超纲内容" }
  ];
  var jlptScopeSwitch = '<div class="jlpt-scope-switch">' + jlptScopeOpts.map(function (o) {
    return '<button class="jlpt-scope-btn ' + (state.jlptScope === o.id ? "active" : "") + '" data-act="setJlptScope" data-arg="' + o.id + '">' + o.label + "</button>";
  }).join("") + "</div>";

  var settingsPanel = state.settingsOpen
    ? ('<div class="dock-panel settings-dock-panel">' +
       '<div class="theme-switch">' + themeBtns + "</div>" + rateSlider + uiScaleRow +
       '<div class="settings-label">词汇/语法范围</div>' + jlptScopeSwitch +
       '<button class="add-btn" data-act="openAdd">+ 手动添加</button></div>')
    : "";
  var settingsDock = '<div class="side-dock settings-dock">' +
    '<button class="dock-toggle ' + (state.settingsOpen ? "active" : "") + '" data-act="toggleSettingsOpen">⚙</button>' +
    settingsPanel + "</div>";

  return '<div class="app-header"><div class="mark">日々<span class="dot">・</span>学び</div>' +
    '<div class="streak">已连续学习 <b class="mono">12</b> 天</div></div>' +
    settingsDock +
    '<div class="app-content">' + screenWrap + "</div>" +
    '<div class="tab-bar">' +
    '<button class="tab-btn ' + (state.screen === "home" ? "active" : "") + '" data-act="home"><div class="tab-glyph">家</div><div class="tab-label">首页</div></button>' +
    '<button class="tab-btn ' + (state.screen === "learn" ? "active" : "") + '" data-act="learnDefault"><div class="tab-glyph">学</div><div class="tab-label">学习</div></button>' +
    '<button class="tab-btn ' + (state.screen === "test" ? "active" : "") + '" data-act="testDefault"><div class="tab-glyph">験</div><div class="tab-label">自测</div></button>' +
    '<button class="tab-btn ' + (state.screen === "shadow" ? "active" : "") + '" data-act="shadow"><div class="tab-glyph">声</div><div class="tab-label">跟读</div></button>' +
    "</div>" + addModalTemplate();
}

function render(preserveInput) {
  var scroller = document.querySelector(".app-content");
  var scrollTop = scroller ? scroller.scrollTop : 0;
  var inputEl = document.getElementById("answer-input");
  // 默认不跨题保留输入框内容——只有"手动输入/点选假名"这种同一题内切换模式的场景
  // 才需要显式传 true 保留，否则下一题会带着上一题的残留答案（之前的 bug）
  var inputVal = (preserveInput && inputEl) ? inputEl.value : null;

  document.getElementById("root").innerHTML = shellTemplate();

  var newScroller = document.querySelector(".app-content");
  if (newScroller) newScroller.scrollTop = scrollTop;
  var newInput = document.getElementById("answer-input");
  if (newInput && inputVal !== null) newInput.value = inputVal;

  var nodes = document.querySelectorAll("[data-act]");
  for (var i = 0; i < nodes.length; i++) {
    nodes[i].addEventListener("click", onAction);
  }

  var rangeNodes = document.querySelectorAll("[data-range-act]");
  for (var j = 0; j < rangeNodes.length; j++) {
    rangeNodes[j].addEventListener("input", onRangeInput);
    rangeNodes[j].addEventListener("change", onRangeChange);
  }
}

// 拖动滑块时（input事件连续触发）只更新旁边的数字显示，不整页重渲染——
// 不然每移动一像素都要重建一次DOM，鼠标拖拽会被打断。松手那一刻(change事件)才真正提交、存后端
function onRangeInput(e) {
  var v = parseFloat(e.target.value);
  var label = e.target.parentElement.querySelector(".rate-value");
  if (label) label.textContent = v.toFixed(1) + "x";
}

function onRangeChange(e) {
  var act = e.target.getAttribute("data-range-act");
  handle(act, e.target.value);
}

function appendKana(ch) {
  var input = document.getElementById("answer-input");
  if (!input || input.disabled) return;
  input.value += ch;
}

function backspaceKana() {
  var input = document.getElementById("answer-input");
  if (!input || input.disabled) return;
  input.value = input.value.slice(0, -1);
}

function clearKana() {
  var input = document.getElementById("answer-input");
  if (!input || input.disabled) return;
  input.value = "";
}

function speakJapanese(text) {
  if (!text || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    var utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";
    utter.rate = state.speechRate || 1;
    window.speechSynthesis.speak(utter);
  } catch (e) {}
}

function playBtnHtml(id, kana, kanji, pulsing) {
  return '<button class="play-btn ' + (pulsing ? "pulsing" : "") + '" data-act="playWord" data-arg="' + id + '" data-speak="' + (kana || kanji) + '">' +
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>标准朗读</button>';
}

function onAction(e) {
  var act = e.currentTarget.getAttribute("data-act");
  if (act === "closeAddOverlay" && e.target !== e.currentTarget) return;
  var arg = e.currentTarget.getAttribute("data-arg");
  if (act === "playWord") { e.stopPropagation(); handle(act, arg, e.currentTarget.getAttribute("data-speak")); return; }
  handle(act, arg);
}

function pulse(field, ms) {
  state[field] = true;
  render();
  setTimeout(function () { state[field] = false; render(); }, ms);
}

function pulse2(field, val) {
  state[field] = val;
  render();
  setTimeout(function () { state[field] = null; render(); }, 900);
}

function handle(act, arg, extra) {
  switch (act) {
    case "home": state.screen = "home"; state.mistakeMode = false; break;
    case "learnDefault": state.screen = "learn"; state.learnBatch = null; state.selectingBatch = false; state.pendingRemoval = []; break;
    case "testDefault": state.screen = "test"; state.mistakeMode = false; break;
    case "shadow": state.screen = "shadow"; break;
    case "review": state.screen = "review"; loadReviewQueue(); return;
    case "stats": state.screen = "stats"; loadStats(); return;
    case "flipReview": state.reviewFlipped = !state.reviewFlipped; break;
    case "rateReview": submitReview(parseInt(arg, 10)); return;
    case "setReviewCategory": state.reviewCategory = arg; state.reviewFilter = "all"; state.reviewLevel = "all"; loadReviewQueue(); return;
    case "setReviewFilter": state.reviewFilter = arg; loadReviewQueue(); return;
    case "setReviewLevel": state.reviewLevel = arg; loadReviewQueue(); return;
    case "mistakes": enterMistakes(); return;
    case "pickLevel": pickLevel(arg); return;
    case "pickCat": state.screen = "learn"; state.learnCategory = arg; state.learnBatch = null; state.selectingBatch = false; state.pendingRemoval = []; state.posFilter = "all"; state.freqFilter = "all"; state.batchedFilter = "all"; state.levelFilter = []; state.visibleLimit = 150; saveLocalSetting("learnCategory", arg); break;
    case "pickBatch": state.learnBatch = parseInt(arg, 10); state.pendingRemoval = []; break;
    case "backToBatches": state.learnBatch = null; state.pendingRemoval = []; break;
    case "setPosFilter": state.posFilter = arg; state.visibleLimit = 150; break;
    case "setFreqFilter": state.freqFilter = arg; state.visibleLimit = 150; break;
    case "setBatchedFilter": state.batchedFilter = arg; state.visibleLimit = 150; break;
    case "toggleFiltersOpen": state.filtersOpen = !state.filtersOpen; break;
    case "toggleBatchesOpen": state.batchesOpen = !state.batchesOpen; break;
    case "toggleSettingsOpen": state.settingsOpen = !state.settingsOpen; break;
    case "loadMoreVisible": state.visibleLimit += 300; break;
    case "toggleLevelFilter":
      if (arg === "all") { state.levelFilter = []; }
      else {
        var lvIdx = state.levelFilter.indexOf(arg);
        if (lvIdx === -1) state.levelFilter.push(arg); else state.levelFilter.splice(lvIdx, 1);
      }
      state.pendingSelection = [];
      state.visibleLimit = 150;
      break;
    case "toggleSelect":
      var selIdx = state.pendingSelection.indexOf(arg);
      if (selIdx === -1) state.pendingSelection.push(arg); else state.pendingSelection.splice(selIdx, 1);
      break;
    case "toggleSelectAll":
      var visibleIds2 = currentSelectableItems().map(function (w) { return String(w.id); });
      var allChecked = visibleIds2.length > 0 && visibleIds2.every(function (id) { return state.pendingSelection.indexOf(id) !== -1; });
      if (allChecked) {
        // 已经全选了：取消勾选（只取消当前可见的这些，别的分类/筛选下已选的不动）
        state.pendingSelection = state.pendingSelection.filter(function (id) { return visibleIds2.indexOf(id) === -1; });
      } else {
        visibleIds2.forEach(function (id) { if (state.pendingSelection.indexOf(id) === -1) state.pendingSelection.push(id); });
      }
      break;
    case "confirmSelectBatch": confirmSelectBatch(); return;
    case "deleteBatch": deleteBatch(); return;
    case "toggleRemoveSelect":
      var rmIdx = state.pendingRemoval.indexOf(arg);
      if (rmIdx === -1) state.pendingRemoval.push(arg); else state.pendingRemoval.splice(rmIdx, 1);
      break;
    case "confirmRemoveSelect": confirmRemoveSelect(); return;
    case "toggleWord": state.expandedId = (state.expandedId === arg) ? null : arg; break;
    case "setInputMode": state.inputMode = arg; render(true); return;
    case "tapKana": appendKana(arg); return;
    case "kanaBackspace": backspaceKana(); return;
    case "kanaClear": clearKana(); return;
    case "setRate": setSpeechRate(Math.round(parseFloat(arg) * 10) / 10); break;
    case "playWord":
      speakJapanese(extra || "");
      pulse2("wordPlayPulseId", arg);
      return;
    case "pickMode": state.testMode = arg; state.testSubmitted = false; state.flashFlipped = false; break;
    case "submit": doSubmit(); return;
    case "next": state.qIndex += 1; state.testSubmitted = false; break;
    case "playAudio":
      speakJapanese(currentQuestion().kanaFull);
      pulse("playPulse", 900);
      return;
    case "flip": state.flashFlipped = !state.flashFlipped; break;
    case "rate": submitTestRating(arg); return;
    case "playShadow":
      speakJapanese("きょうはてんきがいいです");
      pulse("shadowPlaying", 1200);
      return;
    case "toggleRecord": doToggleRecord(); return;
    case "resetShadow": state.shadowResult = null; break;
    case "setTheme": setTheme(arg); break;
    case "setJlptScope": setJlptScope(arg); break;
    case "uiScaleUp": setUiScale(state.uiScale + UI_SCALE_STEP); break;
    case "uiScaleDown": setUiScale(state.uiScale - UI_SCALE_STEP); break;
    case "uiScaleReset": setUiScale(1); break;
    case "openAdd": state.showAddModal = true; state.addError = null; state.enrichNote = false; break;
    case "closeAdd": case "closeAddOverlay": state.showAddModal = false; state.addError = null; break;
    case "stubEnrich": state.enrichNote = true; break;
    case "saveCustom": doSaveCustom(); return;
    default: break;
  }
  render();
}

// 切等级：之前这里只改了 state.level，既没存到后端（跟主题/语速不一样，刷新一下就回退），
// 也没清掉学习/自测里残留的上一个等级的分类、批次、进度——这两个都在这修
function pickLevel(id) {
  if (id === state.level) return;
  state.level = id;
  state.learnCategory = "vocab";
  state.learnBatch = null;
  state.selectingBatch = false;
  state.pendingSelection = [];
  state.pendingRemoval = [];
  state.posFilter = "all";
  state.freqFilter = "all";
  state.batchedFilter = "all";
  state.levelFilter = [];
  state.expandedId = null;
  state.mistakeMode = false;
  state.mistakePool = [];
  state.qIndex = 0;
  state.testSubmitted = false;
  state.flashFlipped = false;
  state.batchesCache = {};
  render();
  saveLocalSetting("level", id);
}

function setTheme(id) {
  state.theme = id;
  document.documentElement.setAttribute("data-theme", id);
  saveLocalSetting("theme", id);
}

function setSpeechRate(v) {
  state.speechRate = v;
  saveLocalSetting("speechRate", v);
}

// UI 放大缩小：改 html 根字号，配合全站 rem 单位整体缩放（不需要改任何组件样式）。
// 纯前端偏好，跟主题/语速不同——不需要跨设备同步，存本机 localStorage 就够，读取失败也不影响功能
var UI_SCALE_MIN = 0.8, UI_SCALE_MAX = 1.5, UI_SCALE_STEP = 0.1;
function applyUiScale() {
  document.documentElement.style.fontSize = (state.uiScale * 100) + "%";
}
function setUiScale(v) {
  var clamped = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(v * 10) / 10));
  state.uiScale = clamped;
  applyUiScale();
  try { localStorage.setItem("jlpter_ui_scale", String(clamped)); } catch (e) {}
}
function loadUiScale() {
  try {
    var saved = parseFloat(localStorage.getItem("jlpter_ui_scale"));
    if (saved && saved >= UI_SCALE_MIN && saved <= UI_SCALE_MAX) state.uiScale = saved;
  } catch (e) {}
  applyUiScale();
}

// 明暗度/语速/等级/学习分类这几项设置改成存本机 localStorage，不再存后端数据库——
// 每个浏览器/设备保留各自独立的设置，不跨设备同步（跟上面的 UI 缩放是同一套思路）
var LOCAL_SETTINGS_PREFIX = "jlpter_setting_";
function saveLocalSetting(key, value) {
  try { localStorage.setItem(LOCAL_SETTINGS_PREFIX + key, JSON.stringify(value)); } catch (e) {}
}
function readLocalSetting(key) {
  try {
    var raw = localStorage.getItem(LOCAL_SETTINGS_PREFIX + key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch (e) { return undefined; }
}

function loadSettings() {
  var theme = readLocalSetting("theme");
  var speechRate = readLocalSetting("speechRate");
  var level = readLocalSetting("level");
  var learnCategory = readLocalSetting("learnCategory");
  var jlptScope = readLocalSetting("jlptScope");
  if (theme) state.theme = theme;
  if (typeof speechRate === "number") state.speechRate = speechRate;
  if (level) state.level = level;
  if (learnCategory) state.learnCategory = learnCategory;
  if (jlptScope === "jlpt" || jlptScope === "extra" || jlptScope === "all") state.jlptScope = jlptScope;
  state.levelFilter = [];
  document.documentElement.setAttribute("data-theme", state.theme);
  return Promise.resolve();
}

// 首页只需要分类信息 + 条数，不带任何词条内容——这是"秒开"的关键，跟之前一次性拉全量语料的 loadCorpus() 换掉了
function loadCategories() {
  var qs = "/categories";
  if (state.jlptScope !== "all") qs += "?jlptScope=" + encodeURIComponent(state.jlptScope);
  return api("GET", qs).then(function (data) {
    CATEGORIES = data || [];
  }).catch(function (err) {
    document.getElementById("root").innerHTML =
      '<div style="padding:60px 24px;text-align:center;color:var(--hanko);font-family:\'Noto Sans SC\',sans-serif">' +
      "语料数据加载失败（svc-jp 后端连不上？）<br><span style=\"font-size:0.8rem;color:var(--ink-faint)\">" + err.message + "</span></div>";
    throw err;
  });
}

function refreshHomeStats() {
  var scopeQs = state.jlptScope !== "all" ? "?jlptScope=" + encodeURIComponent(state.jlptScope) : "";
  Promise.all([
    api("GET", "/review/stats" + scopeQs),
    api("GET", "/mistakes" + scopeQs)
  ]).then(function (results) {
    state.homeStats = {
      due: results[0].due, new: results[0].new, total: results[0].total,
      mistakes: results[1].length
    };
    render();
  }).catch(function () {});
}
