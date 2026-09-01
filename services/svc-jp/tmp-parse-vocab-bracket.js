"use strict";
// Parser for "N）word「kana」meaning" style lines (fullwidth bracket separates word from reading).
const fs = require("fs");
const path = require("path");
const db = require("./db");

const txtFile = process.argv[2];
const materialId = parseInt(process.argv[3], 10);
const level = process.argv[4] || null;
if (!txtFile || !materialId) {
  console.error("usage: node tmp-parse-vocab-bracket.js <txtFile> <materialId> [level]");
  process.exit(1);
}

const raw = fs.readFileSync(path.join(__dirname, txtFile), "utf8");
const lines = raw.split(/\r?\n/);

const entryRe = /^[\s]*[\(（]?[0-9０-９]{1,4}[\)）、〕]\s*(\S+?)[「『]([^」』]*)[」』]\s*(.*)$/;
const junkLine = /想和小伙伴们|鸿鹄梦在线课堂|^\s*$/;

const insert = db.prepare(
  "INSERT INTO material_entries (material_id, kanji, kana, cn, level, ling_type) VALUES (?,?,?,?,?,'vocab')"
);
let n = 0, skipped = 0;
const tx = db.transaction(() => {
  for (let rawLine of lines) {
    let line = rawLine.replace(/\?D[\s\S]{0,12}?[Qh]!\s*/g, "").replace(/　/g, " ").trim();
    if (!line || junkLine.test(line)) continue;
    const m = line.match(entryRe);
    if (!m) { skipped++; continue; }
    const kanji = m[1];
    const kana = m[2];
    const cn = m[3].trim();
    if (!cn) { skipped++; continue; }
    insert.run(materialId, kanji, kana || null, cn, level);
    n++;
  }
});
tx();
console.log("inserted:", n, "skipped:", skipped);
