"use strict";

const express = require("express");
const db = require("./db");
const { schedule } = require("./fsrs");

const router = express.Router();

var EXAMPLE_CHUNK = 500;

// 批量查例句，避免每个词单独查一次数据库（N+1）——按 word_id 分块查，
// 避免一次 IN (...) 塞太多参数撞上 SQLite 默认的 999 个绑定参数上限
function examplesByWordId(wordIds) {
  var map = {};
  if (wordIds.length === 0) return map;
  for (var i = 0; i < wordIds.length; i += EXAMPLE_CHUNK) {
    var chunk = wordIds.slice(i, i + EXAMPLE_CHUNK);
    var placeholders = chunk.map(function () { return "?"; }).join(",");
    var stmt = db.prepare(
      "SELECT word_id, kanji, kana, cn, en, source FROM word_examples WHERE word_id IN (" + placeholders + ") ORDER BY word_id, seq ASC"
    );
    stmt.all(chunk).forEach(function (e) {
      if (!map[e.word_id]) map[e.word_id] = [];
      map[e.word_id].push({ kanji: e.kanji, kana: e.kana || "", cn: e.cn || "", en: e.en || "", source: e.source || "" });
    });
  }
  return map;
}

function buildWordRow(w, examples) {
  return {
    id: w.id,
    category: w.category,
    lingType: w.ling_type || "",
    kanji: w.kanji,
    kana: w.kana || "",
    pos: w.pos || "",
    cn: w.cn || "",
    en: w.en || "",
    // 旧的定长例句字段继续透出，给还没升级到 examples[] 的前端代码兜底
    exampleKanji: w.example_kanji || "",
    exampleKana: w.example_kana || "",
    exampleCn: w.example_cn || "",
    exampleEn: w.example_en || "",
    exampleSource: w.example_source || "",
    needsExample: !!w.needs_example,
    example2Kanji: w.example2_kanji || "",
    example2Kana: w.example2_kana || "",
    example2Cn: w.example2_cn || "",
    example2En: w.example2_en || "",
    example2Source: w.example2_source || "",
    needsExample2: !!w.needs_example2,
    examples: examples || [],
    group: w.func_group || "",
    level: w.level || "N5",
    freqTag: w.freq_tag || "",
    freqScore: w.freq_score || 0,
    custom: !!w.is_custom,
    // 是否命中官方JLPT词表/语法表——1=level是官方等级，可信；0=超纲/未收录内容，level 不一定准
    isJlpt: !!w.is_jlpt,
    // 安宁《词源+联想记忆法》导入的记忆技巧/声调，vocab 分类才有，其它分类恒为空
    etymologyNote: w.etymology_note || "",
    pitchAccent: w.pitch_accent || ""
  };
}

// jlptScope 三态筛选：jlpt=只要官方范围内的，extra=只要超纲的，其它(不传/all)=不筛选
// 统一在这里解析，配合下面 whereParts.push 惯例拼 SQL 片段
function jlptScopeClause(scope, prefix) {
  var col = (prefix || "") + "is_jlpt";
  if (scope === "jlpt") return col + " = 1";
  if (scope === "extra") return col + " = 0";
  return null;
}

// 批量拼装词条行——一次查完所有例句，而不是每行一次查询
function wordRowsBulk(rows) {
  var exMap = examplesByWordId(rows.map(function (w) { return w.id; }));
  return rows.map(function (w) { return buildWordRow(w, exMap[w.id]); });
}

function catRow(c, count) {
  return { id: c.id, name: c.name, glyph: c.glyph, count: count + "条", bg: c.bg, fg: c.fg };
}

// data_filter 只允许指向这两个字段——不是用户输入，是我们自己在 db.js 里写死存进去的配置，
// 这里加白名单纯粹是"存进 SQL 片段里的字段名不能是任意字符串"这条底线，不是防外部攻击
var FILTERABLE_FIELDS = { category: true, ling_type: true };

// 把 categories.data_filter 解析成 { field, values }——这是"数据分类"和"展示归类"解耦的关键：
// 一个 tab 该聚合 words 表哪个字段的哪些取值，由这个配置决定，不再是硬编码 category = tab.id
function parseDataFilter(catRowRaw) {
  var filter = null;
  if (catRowRaw.data_filter) {
    try { filter = JSON.parse(catRowRaw.data_filter); } catch (e) { filter = null; }
  }
  if (!filter || !FILTERABLE_FIELDS[filter.field] || !Array.isArray(filter.values) || filter.values.length === 0) {
    filter = { field: "category", values: [catRowRaw.id] }; // 没配置 data_filter 时兜底成老的 1:1 行为
  }
  return filter;
}

// ---- 分类：首页用，只有分类信息 + 实时统计的条数，不带任何词条内容 ----
router.get("/categories", function (req, res) {
  var level = req.query.level || null;
  var jlptClause = jlptScopeClause(req.query.jlptScope);
  var rows = db.prepare("SELECT * FROM categories ORDER BY rowid").all();
  var categories = rows.map(function (c) {
    var filter = parseDataFilter(c);
    var placeholders = filter.values.map(function () { return "?"; }).join(",");
    var whereParts = [filter.field + " IN (" + placeholders + ")"];
    var params = filter.values.slice();
    if (level) { whereParts.push("level = ?"); params.push(level); }
    if (jlptClause) whereParts.push(jlptClause);
    var n = db.prepare("SELECT COUNT(*) AS n FROM words WHERE " + whereParts.join(" AND ")).get(params).n;
    return catRow(c, n);
  });
  res.json(categories);
});

// ---- 词条：按需拉取，不再一次性吐出整个词库 ----
// ?ids=1,2,3            按 id 列表批量取（用于展开某个批次/复习队列的词条内容）
// ?category=vocab&...   按 tab 浏览（通过 categories.data_filter 转译成真实字段查询），level/pos/group/freq 均可选，用于"选词建批次"页
router.get("/words", function (req, res) {
  var idsParam = req.query.ids;
  if (idsParam) {
    var ids = String(idsParam).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    if (ids.length === 0) return res.json([]);
    var rows = [];
    for (var i = 0; i < ids.length; i += EXAMPLE_CHUNK) {
      var chunk = ids.slice(i, i + EXAMPLE_CHUNK);
      var placeholders = chunk.map(function () { return "?"; }).join(",");
      rows = rows.concat(db.prepare("SELECT * FROM words WHERE id IN (" + placeholders + ")").all(chunk));
    }
    return res.json(wordRowsBulk(rows));
  }

  var category = req.query.category;
  if (!category) return res.status(400).json({ error: "category_or_ids_required" });
  var catRowRaw = db.prepare("SELECT * FROM categories WHERE id = ?").get(category);
  if (!catRowRaw) return res.status(400).json({ error: "unknown_category" });
  var filter = parseDataFilter(catRowRaw);

  // level 支持逗号分隔多选，比如 level=N1,N2——对应前端"等级筛选"从单选改成可勾选多个
  var levelParam = req.query.level || null;
  var levels = levelParam ? String(levelParam).split(",").map(function (s) { return s.trim(); }).filter(Boolean) : [];
  var pos = req.query.pos || null;
  var group = req.query.group || null;
  var freq = req.query.freq || null;
  // 选词建批次页现在整类目一次性拉全量进浏览器缓存、筛选改成前端做，所以上限要放宽到能装下最大的
  // 分类（词汇快 17000 条）——这是本机单用户应用，不用担心有人拿超大 limit 来打爆内存
  var limit = Math.min(parseInt(req.query.limit, 10) || 5000, 30000);

  var placeholders = filter.values.map(function () { return "?"; }).join(",");
  var whereParts = [filter.field + " IN (" + placeholders + ")"];
  var params = filter.values.slice();
  if (levels.length === 1) { whereParts.push("level = ?"); params.push(levels[0]); }
  else if (levels.length > 1) {
    var levelPh = levels.map(function () { return "?"; }).join(",");
    whereParts.push("level IN (" + levelPh + ")");
    params = params.concat(levels);
  }
  if (pos) { whereParts.push("pos = ?"); params.push(pos); }
  if (group) { whereParts.push("func_group = ?"); params.push(group); }
  if (freq) { whereParts.push("freq_tag = ?"); params.push(freq); }
  var jlptClause = jlptScopeClause(req.query.jlptScope);
  if (jlptClause) whereParts.push(jlptClause);
  params.push(limit);

  var wordRows = db.prepare(
    "SELECT * FROM words WHERE " + whereParts.join(" AND ") + " ORDER BY id LIMIT ?"
  ).all(params);
  res.json(wordRowsBulk(wordRows));
});

// ---- 手动添加的自定义词条 ----
router.post("/words", function (req, res) {
  var b = req.body || {};
  var kanji = (b.kanji || "").trim();
  if (!kanji) return res.status(400).json({ error: "kanji_required" });
  var category = b.category || "vocab";
  var id = "custom-" + Date.now();
  // grammar/pattern/idiom 这三个 tab 现在按 ling_type 聚合（见 db.js migrateCategoryView），
  // 手动添加时也要把 ling_type 配上，不然新词会查不出来、显示不到对应 tab 里
  var lingType = ["grammar", "pattern", "idiom"].indexOf(category) !== -1 ? category : null;
  db.prepare(
    "INSERT INTO words (id, category, kanji, kana, pos, cn, en, example_kanji, example_kana, example_cn, ling_type, is_custom) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,1)"
  ).run(
    id, category, kanji, b.kana || "", b.pos || "",
    b.cn || "", b.en || "", b.exampleKanji || "", b.exampleKana || "", b.exampleCn || "", lingType
  );
  var row = db.prepare("SELECT * FROM words WHERE id = ?").get(id);
  res.status(201).json(buildWordRow(row, []));
});

router.delete("/words/:id", function (req, res) {
  var row = db.prepare("SELECT * FROM words WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not_found" });
  if (!row.is_custom) return res.status(403).json({ error: "cannot_delete_builtin" });
  db.prepare("DELETE FROM words WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---- 批次：手动挑词建的学习批次，支持删单条 / 删整批 ----
router.get("/batches", function (req, res) {
  var category = req.query.category;
  var batches = category
    ? db.prepare("SELECT * FROM batches WHERE category = ? ORDER BY id").all(category)
    : db.prepare("SELECT * FROM batches ORDER BY id").all();
  var itemStmt = db.prepare("SELECT word_id FROM batch_items WHERE batch_id = ?");
  var out = batches.map(function (b) {
    var wordIds = itemStmt.all(b.id).map(function (r) { return r.word_id; });
    return { id: b.id, category: b.category, name: b.name || "", wordIds: wordIds, count: wordIds.length };
  });
  res.json(out);
});

router.post("/batches", function (req, res) {
  var b = req.body || {};
  var category = b.category;
  var wordIds = Array.isArray(b.wordIds) ? b.wordIds : [];
  var name = (b.name || "").trim();
  if (!category || wordIds.length === 0) return res.status(400).json({ error: "category_and_wordIds_required" });

  var batchId;
  var tx = db.transaction(function () {
    var info = db.prepare("INSERT INTO batches (category, name) VALUES (?, ?)").run(category, name || null);
    batchId = info.lastInsertRowid;
    var insertItem = db.prepare("INSERT OR IGNORE INTO batch_items (batch_id, word_id) VALUES (?, ?)");
    wordIds.forEach(function (wid) { insertItem.run(batchId, String(wid)); });
  });
  tx();
  res.status(201).json({ id: batchId, category: category, name: name, wordIds: wordIds.map(String), count: wordIds.length });
});

router.delete("/batches/:id", function (req, res) {
  var info = db.prepare("DELETE FROM batches WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

// 删批次里的某一条——如果删完这批变空了，顺手把这个空批次也清掉，不留垃圾批次
router.delete("/batches/:id/items/:wordId", function (req, res) {
  var batchId = req.params.id;
  db.prepare("DELETE FROM batch_items WHERE batch_id = ? AND word_id = ?").run(batchId, req.params.wordId);
  var remaining = db.prepare("SELECT COUNT(*) AS n FROM batch_items WHERE batch_id = ?").get(batchId).n;
  var batchDeleted = false;
  if (remaining === 0) {
    db.prepare("DELETE FROM batches WHERE id = ?").run(batchId);
    batchDeleted = true;
  }
  res.json({ ok: true, batchDeleted: batchDeleted, remaining: remaining });
});

// 批量移出——前端"多选删除"用这个，一次事务删完，比循环调单条接口更稳
router.delete("/batches/:id/items", function (req, res) {
  var batchId = req.params.id;
  var wordIds = Array.isArray((req.body || {}).wordIds) ? req.body.wordIds : [];
  if (wordIds.length === 0) return res.status(400).json({ error: "wordIds_required" });

  var del = db.prepare("DELETE FROM batch_items WHERE batch_id = ? AND word_id = ?");
  var tx = db.transaction(function () {
    wordIds.forEach(function (wid) { del.run(batchId, String(wid)); });
  });
  tx();

  var remaining = db.prepare("SELECT COUNT(*) AS n FROM batch_items WHERE batch_id = ?").get(batchId).n;
  var batchDeleted = false;
  if (remaining === 0) {
    db.prepare("DELETE FROM batches WHERE id = ?").run(batchId);
    batchDeleted = true;
  }
  res.json({ ok: true, batchDeleted: batchDeleted, remaining: remaining });
});

// ---- 设置：主题/语速/等级/上次浏览的分类，跨浏览器共享 ----
var SETTINGS_KEYS = ["theme", "speechRate", "level", "learnCategory"];

router.get("/settings", function (req, res) {
  var rows = db.prepare("SELECT key, value FROM settings").all();
  var out = {};
  rows.forEach(function (r) { out[r.key] = JSON.parse(r.value); });
  res.json(out);
});

router.put("/settings", function (req, res) {
  var b = req.body || {};
  var upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  var tx = db.transaction(function () {
    SETTINGS_KEYS.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(b, k)) upsert.run(k, JSON.stringify(b[k]));
    });
  });
  tx();
  res.json({ ok: true });
});

// 每天最多引入这么多张全新卡——不设这个上限的话，到期项一旦占满 limit 新词就完全挤不进来，
// 到期项少的日子又会一次性涌入几百个新词，两头都不科学（对照 Anki 等主流 SRS 的惯例做法）。
// 用 progress.reps=1 且 last_review 是今天来判断"今天新引入了几张"，不用额外加字段
var DEFAULT_DAILY_NEW_CAP = 20;

// ---- 复习：FSRS 排期 ----
// 到期条目 = (progress.due <= 现在) 或者 (从没复习过、还没有progress记录的词，算作New，立刻可学)
router.get("/review/due", function (req, res) {
  var category = req.query.category || null;
  var pos = req.query.pos || null;
  var group = req.query.group || null;
  var level = req.query.level || null;
  var freq = req.query.freq || null;
  var limit = Math.min(parseInt(req.query.limit, 10) || 20, 200);
  var newCap = Math.min(parseInt(req.query.newCap, 10) || DEFAULT_DAILY_NEW_CAP, 200);
  var nowIso = new Date().toISOString();

  // category 参数是 tab id（vocab/grammar/pattern/idiom），要经过 data_filter 转译成真实字段查询，
  // 跟 /words、/categories 走的是同一套映射，不然这里筛选到的内容会跟其它页面看到的对不上
  var whereParts = [];
  var scopeParams = [];
  if (category) {
    var catRowRaw = db.prepare("SELECT * FROM categories WHERE id = ?").get(category);
    var filter = catRowRaw ? parseDataFilter(catRowRaw) : { field: "category", values: [category] };
    var catPlaceholders = filter.values.map(function () { return "?"; }).join(",");
    whereParts.push("w." + filter.field + " IN (" + catPlaceholders + ")");
    scopeParams = scopeParams.concat(filter.values);
  }
  if (pos) { whereParts.push("w.pos = ?"); scopeParams.push(pos); }
  if (group) { whereParts.push("w.func_group = ?"); scopeParams.push(group); }
  if (level) { whereParts.push("w.level = ?"); scopeParams.push(level); }
  if (freq) { whereParts.push("w.freq_tag = ?"); scopeParams.push(freq); }
  var jlptClause = jlptScopeClause(req.query.jlptScope, "w.");
  if (jlptClause) whereParts.push(jlptClause);
  var scopeWhere = whereParts.length ? whereParts.join(" AND ") : "1=1";

  var dueRows = db.prepare(
    "SELECT w.*, p.due AS p_due, p.state AS p_state FROM words w " +
    "JOIN progress p ON p.word_id = w.id " +
    "WHERE p.due <= ? AND " + scopeWhere + " " +
    "ORDER BY p.due ASC LIMIT ?"
  ).all([nowIso].concat(scopeParams, [limit]));

  var todayNewCount = db.prepare(
    "SELECT COUNT(*) AS n FROM progress WHERE reps = 1 AND date(last_review) = date('now')"
  ).get().n;
  var newBudget = Math.max(0, Math.min(newCap - todayNewCount, limit));

  var newRows = newBudget > 0 ? db.prepare(
    "SELECT w.* FROM words w " +
    "LEFT JOIN progress p ON p.word_id = w.id " +
    "WHERE p.word_id IS NULL AND " + scopeWhere + " " +
    "ORDER BY w.id LIMIT ?"
  ).all(scopeParams.concat([newBudget])) : [];

  var items = wordRowsBulk(dueRows).map(function (row, i) {
    return Object.assign(row, { isNew: false, due: dueRows[i].p_due });
  }).concat(wordRowsBulk(newRows).map(function (row) {
    return Object.assign(row, { isNew: true, due: null });
  }));

  res.json(items.slice(0, limit));
});

// 首页"今日待复习 N 条"卡片用的统计
router.get("/review/stats", function (req, res) {
  var nowIso = new Date().toISOString();
  var jlptClause = jlptScopeClause(req.query.jlptScope, "w.");
  var dueWhere = jlptClause
    ? " JOIN words w ON w.id = progress.word_id WHERE progress.due <= ? AND " + jlptClause
    : " WHERE due <= ?";
  var due = db.prepare("SELECT COUNT(*) AS n FROM progress" + dueWhere).get(nowIso).n;
  var newWhere = "WHERE p.word_id IS NULL" + (jlptClause ? " AND " + jlptClause : "");
  var brandNew = db.prepare("SELECT COUNT(*) AS n FROM words w LEFT JOIN progress p ON p.word_id = w.id " + newWhere).get().n;
  res.json({ due: due, new: brandNew, total: due + brandNew });
});

router.post("/review/:wordId", function (req, res) {
  var wordId = req.params.wordId;
  var rating = parseInt((req.body || {}).rating, 10);
  if ([1, 2, 3, 4].indexOf(rating) === -1) {
    return res.status(400).json({ error: "rating_must_be_1_to_4" });
  }
  var word = db.prepare("SELECT * FROM words WHERE id = ?").get(wordId);
  if (!word) return res.status(404).json({ error: "word_not_found" });

  var existing = db.prepare("SELECT * FROM progress WHERE word_id = ?").get(wordId);
  var now = new Date();
  var result = schedule(existing, rating, now);
  var row = result.row;

  var upsert = db.prepare(
    "INSERT INTO progress (word_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, updated_at) " +
    "VALUES (@word_id,@due,@stability,@difficulty,@elapsed_days,@scheduled_days,@reps,@lapses,@state,@last_review,datetime('now')) " +
    "ON CONFLICT(word_id) DO UPDATE SET due=excluded.due, stability=excluded.stability, difficulty=excluded.difficulty, " +
    "elapsed_days=excluded.elapsed_days, scheduled_days=excluded.scheduled_days, reps=excluded.reps, lapses=excluded.lapses, " +
    "state=excluded.state, last_review=excluded.last_review, updated_at=datetime('now')"
  );
  upsert.run(Object.assign({}, row, { word_id: wordId }));
  db.prepare("INSERT INTO review_log (word_id, rating) VALUES (?, ?)").run(wordId, rating);

  res.json({ wordId: wordId, due: row.due, state: row.state, reps: row.reps, lapses: row.lapses });
});

// ---- 错题本：最近一次复习评分是 Again(1) 或 Hard(2) 的词 ----
router.get("/mistakes", function (req, res) {
  var category = req.query.category;
  var whereCat = "";
  var params = [];
  if (category) {
    var catRowRaw = db.prepare("SELECT * FROM categories WHERE id = ?").get(category);
    var filter = catRowRaw ? parseDataFilter(catRowRaw) : { field: "category", values: [category] };
    var placeholders = filter.values.map(function () { return "?"; }).join(",");
    whereCat = "AND w." + filter.field + " IN (" + placeholders + ")";
    params = filter.values.slice();
  }
  var mistakesJlptClause = jlptScopeClause(req.query.jlptScope, "w.");
  if (mistakesJlptClause) whereCat += " AND " + mistakesJlptClause;
  var rows = db.prepare(
    "SELECT w.*, latest.rating FROM words w " +
    "JOIN (" +
    "  SELECT word_id, rating FROM review_log rl1 " +
    "  WHERE reviewed_at = (SELECT MAX(reviewed_at) FROM review_log rl2 WHERE rl2.word_id = rl1.word_id)" +
    ") latest ON latest.word_id = w.id " +
    "WHERE latest.rating IN (1,2) " + whereCat +
    " GROUP BY w.id"
  ).all(params);
  res.json(wordRowsBulk(rows));
});

// ---- 统计：学习曲线 / 记住率，给"统计"页画图用 ----
router.get("/stats/overview", function (req, res) {
  var totalWords = db.prepare("SELECT COUNT(*) AS n FROM words").get().n;
  var reviewedWords = db.prepare("SELECT COUNT(*) AS n FROM progress").get().n;
  var totalReviews = db.prepare("SELECT COUNT(*) AS n FROM review_log").get().n;
  var remembered = db.prepare("SELECT COUNT(*) AS n FROM review_log WHERE rating >= 3").get().n;
  var lapses = db.prepare("SELECT COALESCE(SUM(lapses), 0) AS n FROM progress").get().n;

  var stateMap = { 0: "new", 1: "learning", 2: "review", 3: "relearning" };
  var byState = { new: 0, learning: 0, review: 0, relearning: 0 };
  db.prepare("SELECT state, COUNT(*) AS n FROM progress GROUP BY state").all().forEach(function (r) {
    byState[stateMap[r.state]] = r.n;
  });

  res.json({
    totalWords: totalWords,
    reviewedWords: reviewedWords,
    unreviewedWords: totalWords - reviewedWords,
    totalReviews: totalReviews,
    retention: totalReviews > 0 ? remembered / totalReviews : null,
    lapses: lapses,
    byState: byState
  });
});

// 按天聚合的复习次数 + 记住率——没复习过的那天也补0，图表x轴才连续
router.get("/stats/history", function (req, res) {
  var days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
  var rows = db.prepare(
    "SELECT date(reviewed_at) AS day, " +
    "SUM(CASE WHEN rating >= 3 THEN 1 ELSE 0 END) AS remembered, " +
    "COUNT(*) AS total " +
    "FROM review_log " +
    "WHERE date(reviewed_at) >= date('now', '-' || ? || ' days') " +
    "GROUP BY day"
  ).all(days - 1);
  var byDay = {};
  rows.forEach(function (r) { byDay[r.day] = { total: r.total, remembered: r.remembered }; });

  var out = [];
  for (var i = days - 1; i >= 0; i--) {
    var key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    var found = byDay[key];
    out.push({ date: key, total: found ? found.total : 0, remembered: found ? found.remembered : 0 });
  }
  res.json(out);
});

module.exports = router;
