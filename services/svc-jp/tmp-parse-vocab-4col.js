"use strict";
// Parser for "kanji  kana  pos  meaning" 4-column lines (columns separated by 2+ spaces).
const fs = require("fs");
const path = require("path");
const db = require("./db");

const txtFile = process.argv[2];
const materialId = parseInt(process.argv[3], 10);
const level = process.argv[4] || null;
if (!txtFile || !materialId) {
  console.error("usage: node tmp-parse-vocab-4col.js <txtFile> <materialId> [level]");
  process.exit(1);
}

const raw = fs.readFileSync(path.join(__dirname, txtFile), "utf8");
const lines = raw.split(/\r?\n/);
const junkLine = /想和小伙伴们|鸿鹄梦在线课堂|honghumeng|^\s*$|^汉字\s/;
const kanaOnly = /^[぀-ゟー～、,・]+$/;

const insert = db.prepare(
  "INSERT INTO material_entries (material_id, kanji, kana, cn, level, ling_type) VALUES (?,?,?,?,?,'vocab')"
);
let n = 0, skipped = 0;
const tx = db.transaction(() => {
  for (let rawLine of lines) {
    let line = rawLine.replace(/\?D[\s\S]{0,12}?[Qh]!\s*/g, "").trim();
    if (!line || junkLine.test(line)) continue;
    const cols = line.split(/[　\s]{2,}|\t/).map(s => s.trim()).filter(Boolean);
    if (cols.length < 3) { skipped++; continue; }
    const kanji = cols[0];
    const kanaCandidate = cols[1];
    const hasKana = kanaOnly.test(kanaCandidate);
    const kana = hasKana ? kanaCandidate : null;
    const restStart = hasKana ? 2 : 1;
    // rest[0] is usually the pos tag (名/動/形 etc, possibly with ，サ変 suffix); meaning is everything after
    const rest = cols.slice(restStart);
    const cn = rest.length > 1 ? rest.slice(1).join(" ") : rest[0];
    if (!cn) { skipped++; continue; }
    insert.run(materialId, kanji, kana, cn, level);
    n++;
  }
});
tx();
console.log("inserted:", n, "skipped:", skipped);
