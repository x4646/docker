"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_DIR = "/data/jp-corpus";
const DB_PATH = path.join(DB_DIR, "app.db");

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  glyph TEXT,
  count_label TEXT,
  bg TEXT,
  fg TEXT
);

CREATE TABLE IF NOT EXISTS words (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  kanji TEXT NOT NULL,
  kana TEXT,
  pos TEXT,
  cn TEXT,
  en TEXT,
  example_kanji TEXT,
  example_kana TEXT,
  example_cn TEXT,
  example_en TEXT,
  example_source TEXT,
  needs_example INTEGER NOT NULL DEFAULT 0,
  example2_kanji TEXT,
  example2_kana TEXT,
  example2_cn TEXT,
  example2_en TEXT,
  example2_source TEXT,
  needs_example2 INTEGER NOT NULL DEFAULT 0,
  func_group TEXT,
  level TEXT,
  freq_tag TEXT,
  is_custom INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS word_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kanji TEXT NOT NULL,
  kana TEXT,
  cn TEXT,
  en TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS batch_items (
  batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  PRIMARY KEY (batch_id, word_id)
);

CREATE TABLE IF NOT EXISTS progress (
  word_id TEXT PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
  due TEXT NOT NULL,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days REAL NOT NULL DEFAULT 0,
  scheduled_days REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0,
  last_review TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 原始教材（M:\\jlpt\\... 下的 PDF）解析后的缓存：先把材料里的条目原样存进这两张表，
-- 以后要用同一份材料时直接查表，不用重新打开 PDF 重读一遍
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  material_type TEXT,
  level TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  extracted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS material_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  kanji TEXT NOT NULL,
  kana TEXT,
  cn TEXT,
  en TEXT,
  level TEXT,
  ling_type TEXT,
  example_kanji TEXT,
  example_cn TEXT,
  merged_word_id TEXT REFERENCES words(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// 老库升级：给已经存在的 words 表补上新加的例句来源字段（新建库不会走到这里，CREATE TABLE 已经带了）
(function migrateWordsColumns() {
  var cols = db.prepare("PRAGMA table_info(words)").all().map(function (c) { return c.name; });
  var add = [];
  if (cols.indexOf("example_en") === -1) add.push("ALTER TABLE words ADD COLUMN example_en TEXT");
  if (cols.indexOf("example_source") === -1) add.push("ALTER TABLE words ADD COLUMN example_source TEXT");
  if (cols.indexOf("needs_example") === -1) add.push("ALTER TABLE words ADD COLUMN needs_example INTEGER NOT NULL DEFAULT 0");
  if (cols.indexOf("func_group") === -1) add.push("ALTER TABLE words ADD COLUMN func_group TEXT");
  if (cols.indexOf("level") === -1) add.push("ALTER TABLE words ADD COLUMN level TEXT");
  if (cols.indexOf("freq_tag") === -1) add.push("ALTER TABLE words ADD COLUMN freq_tag TEXT");
  if (cols.indexOf("example2_kanji") === -1) add.push("ALTER TABLE words ADD COLUMN example2_kanji TEXT");
  if (cols.indexOf("example2_kana") === -1) add.push("ALTER TABLE words ADD COLUMN example2_kana TEXT");
  if (cols.indexOf("example2_cn") === -1) add.push("ALTER TABLE words ADD COLUMN example2_cn TEXT");
  if (cols.indexOf("example2_en") === -1) add.push("ALTER TABLE words ADD COLUMN example2_en TEXT");
  if (cols.indexOf("example2_source") === -1) add.push("ALTER TABLE words ADD COLUMN example2_source TEXT");
  if (cols.indexOf("needs_example2") === -1) add.push("ALTER TABLE words ADD COLUMN needs_example2 INTEGER NOT NULL DEFAULT 0");
  // ling_type：内容真正的语言学分类（语法点/句型结构/惯用语…），跟 category 分开——
  // category 继续是历史上写入的原始分类，ling_type 才是决定"该展示在哪个 tab"的依据，
  // 这样以后调整展示归类只用改 words.ling_type / categories.data_filter，不用碰前端代码
  if (cols.indexOf("ling_type") === -1) add.push("ALTER TABLE words ADD COLUMN ling_type TEXT");
  add.forEach(function (sql) { db.exec(sql); });
  if (add.length) console.log("[svc-jp] migrated words table, added columns:", add.length);
})();

// 老库升级：批次加个可选的自定义名称（之前批次只有"第N批"这种序号显示）
(function migrateBatchesColumns() {
  var cols = db.prepare("PRAGMA table_info(batches)").all().map(function (c) { return c.name; });
  if (cols.indexOf("name") === -1) {
    db.exec("ALTER TABLE batches ADD COLUMN name TEXT");
    console.log("[svc-jp] migrated batches table, added name column");
  }
})();

// 首次启动、words表还是空的时候，从种子文件导入内置词库（分类+词条）
function seedIfEmpty() {
  var count = db.prepare("SELECT COUNT(*) AS n FROM words").get().n;
  if (count > 0) return;

  var seedPath = path.join(__dirname, "seed-words.json");
  if (!fs.existsSync(seedPath)) {
    console.log("[svc-jp] seed-words.json not found, skip seeding");
    return;
  }
  var seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));

  var insertCat = db.prepare(
    "INSERT OR REPLACE INTO categories (id, name, glyph, count_label, bg, fg) VALUES (?,?,?,?,?,?)"
  );
  var insertWord = db.prepare(
    "INSERT OR REPLACE INTO words (id, category, kanji, kana, pos, cn, en, example_kanji, example_kana, example_cn, example_en, example_source, needs_example, " +
    "example2_kanji, example2_kana, example2_cn, example2_en, example2_source, needs_example2, func_group, level, is_custom) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)"
  );

  var tx = db.transaction(function () {
    (seed.categories || []).forEach(function (c) {
      insertCat.run(c.id, c.name, c.glyph || "", c.count || "", c.bg || "", c.fg || "");
    });
    (seed.words || []).forEach(function (w) {
      insertWord.run(
        String(w.id), w.category, w.kanji, w.kana || "", w.pos || "",
        w.cn || "", w.en || "", w.exampleKanji || "", w.exampleKana || "", w.exampleCn || "",
        w.exampleEn || "", w.exampleSource || "", w.needsExample ? 1 : 0,
        w.example2Kanji || "", w.example2Kana || "", w.example2Cn || "", w.example2En || "", w.example2Source || "", w.needsExample2 ? 1 : 0,
        w.group || "", w.level || "N5"
      );
    });
  });
  tx();
  console.log("[svc-jp] seeded", (seed.words || []).length, "words,", (seed.categories || []).length, "categories");
}

// 数据（words 表存的是什么）跟视图（首页 tab 该怎么分组展示）解耦：
// categories.data_filter 定义"这个 tab 底下要聚合 words 表哪个字段的哪些取值"，
// 后端 /categories 和 /words 都读这个配置去查，不再是"words.category 写什么就直接显示成什么"的硬编码 1:1。
// 想调整某个 tab 该包含哪些内容，改这个函数或者直接 UPDATE words.ling_type 就够了，不用碰路由代码。
function migrateCategoryView() {
  var catCols = db.prepare("PRAGMA table_info(categories)").all().map(function (c) { return c.name; });
  if (catCols.indexOf("data_filter") === -1) {
    db.exec("ALTER TABLE categories ADD COLUMN data_filter TEXT");
  }

  // "副词"/"接续词"本来就是词汇的词性之一（pos 字段里已经有这两个值），单独开 adverb/conj 两个 tab
  // 是早期种子数据留下的重复设计——合并进 vocab，用词性筛选一样能找到，不用两套机制维护同一件事
  var strayCount = db.prepare("SELECT COUNT(*) AS n FROM words WHERE category IN ('adverb','conj')").get().n;
  if (strayCount > 0) {
    db.prepare("UPDATE words SET category = 'vocab' WHERE category IN ('adverb','conj')").run();
    db.prepare("DELETE FROM categories WHERE id IN ('adverb','conj')").run();
    console.log("[svc-jp] merged adverb/conj (" + strayCount + " words) into vocab category");
  }

  // 旧的"pattern"分类里那 32 条实际内容是寒暄客套话（如"お願いします"），不是真正的语法句型结构，
  // 语义上更接近惯用语——用 ling_type 记录它们真实的归类，不改 words.category 本身（避免动到历史字段）
  var needsBackfill = db.prepare("SELECT COUNT(*) AS n FROM words WHERE category IN ('grammar','pattern','idiom') AND ling_type IS NULL").get().n;
  if (needsBackfill > 0) {
    db.prepare("UPDATE words SET ling_type = 'idiom' WHERE category IN ('pattern','idiom') AND ling_type IS NULL").run();
    db.prepare("UPDATE words SET ling_type = 'grammar' WHERE category = 'grammar' AND ling_type IS NULL").run();
    console.log("[svc-jp] backfilled ling_type for", needsBackfill, "grammar/pattern/idiom words");
  }

  // 视图配置：vocab 这个 tab 仍按 category 聚合（vocab 本身没有细分类型的必要，pos 字段已经够用），
  // grammar/pattern/idiom 这三个 tab 改成按 ling_type 聚合——这才是真正把"展示归类"从 category 上摘出来的地方
  var filters = {
    vocab: { field: "category", values: ["vocab"] },
    grammar: { field: "ling_type", values: ["grammar"] },
    pattern: { field: "ling_type", values: ["pattern"] },
    idiom: { field: "ling_type", values: ["idiom"] }
  };
  var updateFilter = db.prepare("UPDATE categories SET data_filter = ? WHERE id = ?");
  Object.keys(filters).forEach(function (id) {
    var row = db.prepare("SELECT id FROM categories WHERE id = ?").get(id);
    if (row) updateFilter.run(JSON.stringify(filters[id]), id);
  });
}

seedIfEmpty();
migrateCategoryView();

module.exports = db;
