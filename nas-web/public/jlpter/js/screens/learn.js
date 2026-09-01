"use strict";

// 一个词现在可以配任意条数的例句（word_examples 表），vocab 一般 0-2 条来自 Tatoeba，
// 语法/句型/惯用语目标是 5 条自造例句。missing=true 时说明一条都还没配到，显示"待补充"而不是留空
function exampleBoxTemplate(ex) {
  var trans = ex.cn || ex.en || "";
  return '<div class="example-box"><div>' + (ex.kana ? ("<ruby>" + ex.kanji + "<rt>" + ex.kana + "</rt></ruby>") : ex.kanji) + "</div><div class=\"en\">" + trans + "</div>" +
    (ex.source === "tatoeba" ? '<div class="example-source">例句来自 Tatoeba（CC BY 2.0 FR）</div>' : "") + "</div>";
}

function wordRowsTemplate(items, opts) {
  opts = opts || {};
  return items.map(function (w) {
    var expanded = String(w.id) === state.expandedId;
    var pulsing = state.wordPlayPulseId === String(w.id);
    var jpHead = w.kana ? ("<ruby>" + w.kanji + "<rt>" + w.kana + "</rt></ruby>") : w.kanji;
    var detail = "";
    if (expanded) {
      var examples = w.examples || [];
      var exampleBlock = examples.length
        ? examples.map(exampleBoxTemplate).join("")
        : ((w.needsExample || w.needsExample2) ? '<div class="example-missing">例句待补充</div>' : "");
      detail = '<div class="word-detail">' +
        (w.en ? ('<div class="row"><span class="k">英文</span><span>' + w.en + "</span></div>") : "") +
        exampleBlock +
        '<button class="play-btn ' + (pulsing ? "pulsing" : "") + '" data-act="playWord" data-arg="' + w.id + '" data-speak="' + (w.kana || w.kanji) + '">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>标准朗读</button>' +
        "</div>";
    }
    var head = '<div class="word-head" data-act="toggleWord" data-arg="' + w.id + '">' +
      '<div><span class="word-jp">' + jpHead + "</span>" +
      (w.pos ? ('<span class="word-pos">' + w.pos + "</span>") : "") +
      (w.custom ? '<span class="custom-badge">自定义</span>' : "") +
      '<div class="word-cn">' + (w.cn || "（未填写中文）") + "</div></div></div>";

    if (!opts.checkable) {
      return '<div class="word-row">' + head + detail + "</div>";
    }
    var id = String(w.id);
    var checked = state.pendingRemoval.indexOf(id) !== -1;
    var checkbox = '<button class="row-check ' + (checked ? "checked" : "") + '" data-act="toggleRemoveSelect" data-arg="' + id + '">' + (checked ? "✓" : "") + "</button>";
    return '<div class="word-row"><div class="word-row-check-wrap">' + checkbox + '<div style="flex:1; min-width:0">' + head + "</div></div>" + detail + "</div>";
  }).join("");
}

// 批次现在是"歌单"式的手动分组：用户自己勾选词条建一批，存在 svc-jp 后端的数据库里，
// 已经进了某一批的词从"待选池"里排除掉，保证同一个词不会被塞进两批里
function batchedIdSet(batches) {
  var set = {};
  batches.forEach(function (b) { b.wordIds.forEach(function (id) { set[id] = true; }); });
  return set;
}

// 选词建批次页当前"筛选后可见、且还没被收进任何批次"的词条——toggleSelectAll 用这份逻辑，
// 保证全选只对眼前这些可勾选的生效（已收录的词条现在会显示出来但不可勾选，不算在"可选"范围内）
function currentSelectableItems() {
  var cat = CATEGORIES.filter(function (c) { return c.id === state.learnCategory; })[0];
  if (!cat) return [];
  var items = getAllScopedWords(cat.id) || [];
  var batches = state.batchesCache[cat.id] || [];
  var used = batchedIdSet(batches);
  var out = items.filter(function (w) { return !used[String(w.id)]; });
  if (state.levelFilter.length > 0) out = out.filter(function (w) { return state.levelFilter.indexOf(w.level) !== -1; });
  var filterCfg = FILTER_CONFIG[cat.id];
  if (filterCfg && state.posFilter !== "all") out = out.filter(function (w) { return w[filterCfg.field] === state.posFilter; });
  if (state.freqFilter !== "all") out = out.filter(function (w) { return w.freqTag === state.freqFilter; });
  return out;
}

function loadBatches(catId) {
  state.batchesCache[catId] = null; // null = 正在加载中，跟"还没请求过"(undefined)区分开
  api("GET", "/batches?category=" + encodeURIComponent(catId)).then(function (list) {
    state.batchesCache[catId] = list;
    render();
  }).catch(function () {
    state.batchesCache[catId] = [];
    render();
  });
}

// 主页面：已有批次（如果有）+ 选词区域直接摆在同一页——不再要求先点一个"进入选词模式"的按钮，
// 用户在这页直接勾词，勾完顶部"创建批次"按钮就会跟着亮起来，点一下就建好，是"选完再建"而不是"先建后选"
function batchListTemplate(cat, items, batches) {
  var used = batchedIdSet(batches);

  // 已建批次：默认折叠成一行摘要，点开才展开瓷砖列表——批次一多就很占地方，平时用不着老看着
  var batchesToggle = "";
  var batchTilesPanel = "";
  if (batches.length > 0) {
    batchesToggle = '<button class="collapse-toggle" data-act="toggleBatchesOpen">' +
      (state.batchesOpen ? "▾" : "▸") + " 已建 " + batches.length + " 批</button>";
    if (state.batchesOpen) {
      var tiles = batches.map(function (b, idx) {
        var label = b.name ? b.name : ("第 " + (idx + 1) + " 批");
        return '<div class="tile" data-act="pickBatch" data-arg="' + b.id + '">' +
          '<div class="glyph" style="background:var(--indigo-tint);color:var(--indigo)">' + (idx + 1) + "</div>" +
          '<div class="name">' + label + "</div>" +
          '<div class="count mono">' + b.count + " 条</div></div>";
      }).join("");
      batchTilesPanel = '<div class="tile-grid" style="margin-top:8px">' + tiles + "</div>";
    }
  }

  // 词条多的分类（词汇按词性、语法/句型按功能分类）加一排筛选方便挑词；其它分类条目不多，不显示
  var filterCfg = FILTER_CONFIG[cat.id];
  var filterRow = "";
  if (filterCfg) {
    filterRow = filterChipRow(
      { get: function () { return state.posFilter; }, set: function (v) { state.posFilter = v; } },
      "setPosFilter", filterCfg.order
    );
  }
  // 频度筛选：所有分类通用，没打过标签的词条不受影响（筛"全部"时照常显示）
  var freqRow = filterChipRow(
    { get: function () { return state.freqFilter; }, set: function (v) { state.freqFilter = v; } },
    "setFreqFilter", FREQ_ORDER
  );
  // 收录状态筛选：看哪些词已经被收进批次了、哪些还没有——不影响勾选逻辑，纯粹是个查看用的筛选维度
  var batchedRow = filterChipRow(
    { get: function () { return state.batchedFilter; }, set: function (v) { state.batchedFilter = v; } },
    "setBatchedFilter", ["未收录", "已收录"]
  );

  // 等级筛选：现在整分类已经全量缓存在浏览器里了，勾选只是本地过滤，不再触发网络请求
  var levelRow = levelFilterCheckboxRow(state.levelFilter);

  // 筛选面板整体默认折叠，收起来只留一行"筛选 ▸"，点开才展开四排筛选 chip——平时不用天天盯着这些筛选项
  var activeFilterCount = (state.levelFilter.length > 0 ? 1 : 0) + (state.posFilter !== "all" ? 1 : 0) +
    (state.freqFilter !== "all" ? 1 : 0) + (state.batchedFilter !== "all" ? 1 : 0);
  var filtersToggle = '<button class="collapse-toggle" data-act="toggleFiltersOpen">' +
    (state.filtersOpen ? "▾" : "▸") + " 筛选" + (activeFilterCount > 0 ? "（" + activeFilterCount + "）" : "") + "</button>";
  var filtersPanel = state.filtersOpen
    ? ('<div style="margin-top:8px">' + levelRow + filterRow + freqRow + batchedRow + "</div>")
    : "";

  var visible = items;
  if (state.levelFilter.length > 0) visible = visible.filter(function (w) { return state.levelFilter.indexOf(w.level) !== -1; });
  if (filterCfg && state.posFilter !== "all") visible = visible.filter(function (w) { return w[filterCfg.field] === state.posFilter; });
  if (state.freqFilter !== "all") visible = visible.filter(function (w) { return w.freqTag === state.freqFilter; });
  if (state.batchedFilter === "已收录") visible = visible.filter(function (w) { return !!used[String(w.id)]; });
  else if (state.batchedFilter === "未收录") visible = visible.filter(function (w) { return !used[String(w.id)]; });

  // 已经收进某个批次的词条照样显示出来（不隐藏），只是打上"已收录"标记、不能再勾选，
  // 这样能看到全貌，同时还是保证一个词不会被塞进两批
  var selectableVisible = visible.filter(function (w) { return !used[String(w.id)]; });

  var visibleIds = selectableVisible.map(function (w) { return String(w.id); });
  var allVisibleChecked = visibleIds.length > 0 && visibleIds.every(function (id) { return state.pendingSelection.indexOf(id) !== -1; });
  var selectAllRow = visible.length > 0
    ? ('<div class="select-row select-all-row" data-act="toggleSelectAll">' +
       '<div class="select-box">' + (allVisibleChecked ? "✓" : "") + "</div>" +
       '<div><span class="word-jp">全选（当前筛选可选 ' + selectableVisible.length + " 条）</span></div></div>")
    : "";

  // 一次最多渲染 visibleLimit 条：筛选结果动辄上千甚至上万条，全部塞进 innerHTML 会让每次点筛选都
  // 卡好几秒——先只建这么多 DOM 节点，剩下的靠"加载更多"按钮追加，筛选变化时 visibleLimit 会被重置
  var truncated = visible.length > state.visibleLimit;
  var pageItems = truncated ? visible.slice(0, state.visibleLimit) : visible;
  var loadMoreRow = truncated
    ? ('<button class="collapse-toggle" style="width:100%; margin-top:8px" data-act="loadMoreVisible">加载更多（已显示 ' +
       pageItems.length + " / " + visible.length + " 条）</button>")
    : "";

  // 行标题只显示词形本身，词性/频度标签和释义（尤其是语法这种一大段带换行的说明）折起来，
  // 点一下词形才展开——避免一整页几十条语法把各自的长释义全摊开，谁都看不清
  var rows = pageItems.map(function (w) {
    var id = String(w.id);
    var isUsed = !!used[id];
    var checked = state.pendingSelection.indexOf(id) !== -1;
    var expanded = state.expandedId === id;
    var jpHead = w.kana ? ("<ruby>" + w.kanji + "<rt>" + w.kana + "</rt></ruby>") : w.kanji;
    var cls = "select-row" + (checked ? " checked" : "") + (isUsed ? " used-row" : "");
    var checkAct = isUsed ? "" : ' data-act="toggleSelect" data-arg="' + id + '"';
    var detail = expanded
      ? ((w.pos ? ('<span class="word-pos">' + w.pos + "</span>") : "") +
         (w.freqTag ? ('<span class="word-pos">' + w.freqTag + "</span>") : "") +
         (isUsed ? '<span class="used-badge">已收录</span>' : "") +
         '<div class="word-cn">' + (w.cn || "") + "</div>")
      : "";
    return '<div class="' + cls + '">' +
      '<div class="select-box"' + checkAct + '>' + (checked ? "✓" : "") + "</div>" +
      '<div style="flex:1; min-width:0" data-act="toggleWord" data-arg="' + id + '">' +
      '<span class="word-jp">' + jpHead + "</span>" + detail + "</div></div>";
  }).join("");

  var confirmDisabled = state.pendingSelection.length === 0 ? " disabled" : "";

  // 创建批次的按钮是页面上最先出现的可交互元素，不被筛选行/已建批次挤到中间——列表可能有上百条，
  // 用户先勾选完想立刻点，不用先滚过一堆筛选UI
  var header = backRow() +
    '<button class="primary-btn" data-act="confirmSelectBatch"' + confirmDisabled + ">创建批次（" + state.pendingSelection.length + " 条）</button>" +
    '<div><h1 class="screen-title">' + cat.name + "</h1><p class=\"screen-sub\">共 " + items.length + " 条 · 已选 " + state.pendingSelection.length +
    " · 当前筛选 " + visible.length + " 条（可选 " + selectableVisible.length + "）</p></div>" +
    '<div style="display:flex; gap:10px; margin-top:6px">' + filtersToggle + batchesToggle + "</div>" +
    filtersPanel + batchTilesPanel;

  if (visible.length === 0) {
    return '<div class="sticky-top">' + header + "</div>" +
      '<div class="empty-state">这个筛选条件下没有词条</div>';
  }

  return '<div class="sticky-top">' + header + "</div>" +
    '<div style="display:flex; flex-direction:column; gap:8px; margin-top:10px">' + selectAllRow + rows + "</div>" + loadMoreRow;
}

function learnTemplate() {
  var cat = CATEGORIES.filter(function (c) { return c.id === state.learnCategory; })[0] || CATEGORIES[0];
  if (!cat) {
    return backRow() + '<div class="empty-state">加载中…</div>';
  }

  var cached = state.batchesCache[cat.id];
  if (cached === undefined) {
    loadBatches(cat.id);
    cached = null;
  }
  if (cached === null) {
    return backRow() + '<div><h1 class="screen-title">' + cat.name + "</h1></div>" +
      '<div class="empty-state">加载批次中…</div>';
  }

  if (state.learnBatch === null) {
    // 主页面直接就是选词界面：整个分类的词条一次性缓存进浏览器（getAllScopedWords），
    // 等级/词性/频度/收录状态筛选都在 batchListTemplate 里对这份缓存做本地过滤，不用每切一次筛选就发请求
    var items = getAllScopedWords(cat.id);
    if (items === null) {
      return backRow() + '<div><h1 class="screen-title">' + cat.name + "</h1></div>" +
        '<div class="empty-state">加载中…</div>';
    }
    if (items.length === 0 && cached.length === 0) {
      return backRow() + '<div><h1 class="screen-title">' + cat.name + "</h1></div>" +
        '<div class="empty-state">这个分类还没有内容<button class="add-btn" data-act="openAdd">+ 手动添加</button></div>';
    }
    return batchListTemplate(cat, items, cached);
  }

  var batch = cached.filter(function (b) { return b.id === state.learnBatch; })[0];
  if (!batch) {
    var fallbackItems = getAllScopedWords(cat.id) || [];
    return batchListTemplate(cat, fallbackItems, cached);
  }
  var batchIdx = cached.indexOf(batch);
  var batchItems = getBatchWords(batch);
  if (batchItems === null) {
    return backRow() + '<div><h1 class="screen-title">' + cat.name + "</h1></div>" +
      '<div class="empty-state">加载批次内容中…</div>';
  }

  // checkbox 和"移出选中"按钮直接显示在批次页里，不用切换模式
  var removeDisabled = state.pendingRemoval.length === 0 ? " disabled" : "";
  var header = '<div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px">' +
    '<button class="back-row" data-act="backToBatches">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>返回批次</button>' +
    '<button class="back-row" data-act="deleteBatch" style="color:var(--hanko)">删除这批</button>' +
    "</div>" +
    '<div><h1 class="screen-title">' + cat.name + '</h1><p class="screen-sub">' + (batch.name ? batch.name : ("第 " + (batchIdx + 1) + " 批")) + " · " + batchItems.length + " 条</p></div>" +
    '<button class="primary-btn" style="background:var(--hanko)" data-act="confirmRemoveSelect"' + removeDisabled + ">移出选中（" + state.pendingRemoval.length + " 条）</button>";

  return '<div class="sticky-top">' + header + "</div>" +
    '<div style="display:flex; flex-direction:column; gap:10px">' + wordRowsTemplate(batchItems, { checkable: true }) + "</div>";
}

function addModalTemplate() {
  if (!state.showAddModal) return "";
  var typeOptions = CATEGORIES.map(function (c) {
    return '<option value="' + c.id + '"' + (c.id === state.learnCategory ? " selected" : "") + ">" + c.name + "</option>";
  }).join("");
  var errorBlock = state.addError ? ('<div class="enrich-note" style="color:var(--hanko);background:var(--hanko-tint)">' + state.addError + "</div>") : "";
  var enrichBlock = state.enrichNote ? '<div class="enrich-note">预留接口：以后由 svc-jp 后端自动补全假名 / 翻译 / 例句，现在还没接入，需要手动填写</div>' : "";

  return '<div class="modal-overlay" data-act="closeAddOverlay">' +
    '<div class="modal-sheet">' +
    '<div class="sticky-top">' +
    '<div class="modal-title">手动添加内容</div>' +
    '<div class="modal-actions">' +
    '<button class="ghost-btn" data-act="closeAdd">取消</button>' +
    '<button class="primary-btn" data-act="saveCustom">保存</button>' +
    "</div>" +
    errorBlock +
    "</div>" +
    '<div class="field"><label>类型</label><select id="add-type">' + typeOptions + "</select></div>" +
    '<div class="field"><label>日文原文 *</label><input id="add-jp" type="text" placeholder="例：頑張る" /></div>' +
    '<div class="field-row">' +
    '<div class="field"><label>假名注音</label><input id="add-kana" type="text" placeholder="がんばる" /></div>' +
    '<div class="field"><label>词性 / 分类补充</label><input id="add-pos" type="text" placeholder="动词" /></div>' +
    "</div>" +
    '<div class="field-row">' +
    '<div class="field"><label>中文释义</label><input id="add-cn" type="text" placeholder="加油，努力" /></div>' +
    '<div class="field"><label>英文释义</label><input id="add-en" type="text" placeholder="to try hard" /></div>' +
    "</div>" +
    '<div class="field"><label>例句（日文，可选）</label><input id="add-ex-jp" type="text" placeholder="最後まで頑張ります。" /></div>' +
    '<div class="field"><label>例句（中文，可选）</label><input id="add-ex-cn" type="text" placeholder="坚持到最后。" /></div>' +
    '<button class="enrich-btn" data-act="stubEnrich">AI 自动补全假名 / 翻译 / 例句（预留）</button>' +
    enrichBlock +
    "</div></div>";
}

function confirmSelectBatch() {
  if (state.pendingSelection.length === 0) return;
  var cat = state.learnCategory;
  var wordIds = state.pendingSelection.slice();
  var name = window.prompt("给这批起个名字（可以留空，用默认的批次序号）", "");
  if (name === null) return; // 用户点了取消，不建批次
  api("POST", "/batches", { category: cat, wordIds: wordIds, name: name.trim() }).then(function (batch) {
    var list = (state.batchesCache[cat] || []).concat([batch]);
    state.batchesCache[cat] = list;
    state.selectingBatch = false;
    state.pendingSelection = [];
    state.learnBatch = batch.id; // 建完直接进这一批开始看
    render();
  }).catch(function (err) {
    alert("创建批次失败：" + err.message);
    render();
  });
}

function deleteBatch() {
  var cat = state.learnCategory;
  var id = state.learnBatch;
  var batches = state.batchesCache[cat] || [];
  var batch = batches.filter(function (b) { return b.id === id; })[0];
  if (!batch) return;
  if (!window.confirm("删除这批（" + batch.count + " 条）？里面的词会回到待选池，可以重新分批。")) return;
  api("DELETE", "/batches/" + id).then(function () {
    state.batchesCache[cat] = batches.filter(function (b) { return b.id !== id; });
    delete state.batchWordsCache[id];
    state.learnBatch = null;
    render();
  }).catch(function (err) {
    alert("删除失败：" + err.message);
  });
}

function confirmRemoveSelect() {
  if (state.pendingRemoval.length === 0) return;
  var cat = state.learnCategory;
  var batchId = state.learnBatch;
  var wordIds = state.pendingRemoval.slice();
  api("DELETE", "/batches/" + batchId + "/items", { wordIds: wordIds }).then(function (result) {
    var batches = state.batchesCache[cat] || [];
    if (result.batchDeleted) {
      state.batchesCache[cat] = batches.filter(function (b) { return b.id !== batchId; });
      delete state.batchWordsCache[batchId];
      state.learnBatch = null;
    } else {
      state.batchesCache[cat] = batches.map(function (b) {
        if (b.id !== batchId) return b;
        var newIds = b.wordIds.filter(function (id) { return wordIds.indexOf(id) === -1; });
        return { id: b.id, category: b.category, wordIds: newIds, count: newIds.length };
      });
      delete state.batchWordsCache[batchId]; // 批次内容变了，缓存作废，下次进去重新按新 id 列表拉
    }
    state.pendingRemoval = [];
    render();
  }).catch(function (err) {
    alert("移出失败：" + err.message);
    render();
  });
}

function doSaveCustom() {
  var jp = (document.getElementById("add-jp").value || "").trim();
  if (!jp) { state.addError = "请至少填写日文原文"; render(); return; }
  var body = {
    category: document.getElementById("add-type").value,
    kanji: jp,
    kana: (document.getElementById("add-kana").value || "").trim(),
    cn: (document.getElementById("add-cn").value || "").trim(),
    en: (document.getElementById("add-en").value || "").trim(),
    pos: (document.getElementById("add-pos").value || "").trim(),
    exampleKanji: (document.getElementById("add-ex-jp").value || "").trim(),
    exampleCn: (document.getElementById("add-ex-cn").value || "").trim()
  };
  api("POST", "/words", body).then(function (word) {
    invalidateWordsCache(word.category);
    state.showAddModal = false;
    state.addError = null;
    state.enrichNote = false;
    state.screen = "learn";
    state.learnCategory = word.category;
    state.learnBatch = null;
    render();
  }).catch(function (err) {
    state.addError = "保存失败：" + err.message;
    render();
  });
}
