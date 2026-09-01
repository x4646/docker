"use strict";
// Parser for two-column-per-line lists: "fullwidth-num、word (kana)   fullwidth-num、word (kana)"
// No meaning provided in source -- cn is left null for later translation pass.
const fs = require("fs");
const path = require("path");
const db = require("./db");

const txtFile = process.argv[2];
const materialId = parseInt(process.argv[3], 10);
const level = process.argv[4] || null;
if (!txtFile || !materialId) {
  console.error("usage: node tmp-parse-vocab-2col.js <txtFile> <materialId> [level]");
  process.exit(1);
}

const raw = fs.readFileSync(path.join(__dirname, txtFile), "utf8");
const lines = raw.split(/\r?\n/);

const entryRe = /[０-９0-9]+、\s*(\S+?)\s*[\(（]([^\)）]*)[\)）]/g;

const insert = db.prepare(
  "INSERT INTO material_entries (material_id, kanji, kana, level, ling_type) VALUES (?,?,?,?,'vocab')"
);
let n = 0;
const tx = db.transaction(() => {
  for (let rawLine of lines) {
    let line = rawLine.replace(/\?D[\s\S]{0,12}?[Qh]!\s*/g, "").trim();
    if (!line) continue;
    let m;
    entryRe.lastIndex = 0;
    while ((m = entryRe.exec(line)) !== null) {
      const kanji = m[1];
      const kana = m[2];
      if (!kanji) continue;
      insert.run(materialId, kanji, kana || null, level);
      n++;
    }
  }
});
tx();
console.log("inserted:", n);
