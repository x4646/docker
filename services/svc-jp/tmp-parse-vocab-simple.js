"use strict";
// Generic parser for "word [kana] meaning" line-per-entry vocab lists,
// optionally prefixed with a number marker (halfwidth or fullwidth).
const fs = require("fs");
const path = require("path");
const db = require("./db");

const txtFile = process.argv[2];
const materialId = parseInt(process.argv[3], 10);
const level = process.argv[4] || null;
if (!txtFile || !materialId) {
  console.error("usage: node tmp-parse-vocab-simple.js <txtFile> <materialId> [level]");
  process.exit(1);
}

const raw = fs.readFileSync(path.join(__dirname, txtFile), "utf8");
const lines = raw.split(/\r?\n/);

const kanaOnly = /^[぀-ゟー・]+$/;
const junkLine = /^\s*(\?D|www\.|http|按住|进入免费|想和小伙伴们|关注|鸿鹄梦|[\s~～]*|[0-9０-９]+)\s*$/;
const numPrefix = /^[\s]*[\(（]?[0-9０-９]{1,4}[\)）、,.]?\s+/;

const insert = db.prepare(
  "INSERT INTO material_entries (material_id, kanji, kana, cn, level, ling_type) VALUES (?,?,?,?,?,'vocab')"
);
let n = 0, skipped = 0;
const tx = db.transaction(() => {
  for (let rawLine of lines) {
    let line = rawLine.replace(/\?D[\s\S]{0,12}?[Qh]!\s*/g, "").replace(/　/g, " ").trim();
    if (!line) continue;
    if (junkLine.test(line)) continue;
    if (/想和小伙伴们|鸿鹄梦在线课堂/.test(line)) continue;
    line = line.replace(numPrefix, "");
    if (!line) continue;
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) { skipped++; continue; }
    let kanji = tokens[0];
    let kana = "";
    let meaning;
    if (tokens.length >= 3 && kanaOnly.test(tokens[1])) {
      kana = tokens[1];
      meaning = tokens.slice(2).join(" ");
    } else {
      meaning = tokens.slice(1).join(" ");
    }
    if (!meaning) { skipped++; continue; }
    insert.run(materialId, kanji, kana || null, meaning, level);
    n++;
  }
});
tx();
console.log("inserted:", n, "skipped:", skipped);
