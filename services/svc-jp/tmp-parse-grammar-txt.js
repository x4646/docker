"use strict";
// Generic parser for "numbered grammar list" txt (pdftotext -layout output).
// Entry boundary: a line that starts with optional whitespace then digits followed by ')'.
// First non-empty line after the marker = kanji (pattern head).
// Remaining lines until next entry = explanation/meaning, joined with \n into `cn`.
const fs = require("fs");
const path = require("path");
const db = require("./db");

const txtFile = process.argv[2];
const materialId = parseInt(process.argv[3], 10);
const level = process.argv[4] || null;
if (!txtFile || !materialId) {
  console.error("usage: node tmp-parse-grammar-txt.js <txtFile> <materialId> [level]");
  process.exit(1);
}

const raw = fs.readFileSync(path.join(__dirname, txtFile), "utf8");
const lines = raw.split(/\r?\n/);

const entryStartA = /^\s*(\d{1,3})\s*[)）]\s*(.+)$/; // "12)pattern" or "12）pattern"
const entryStartB = /^(\d{1,3})[　\s]+(～.+)$/; // "12　～pattern" (fullwidth-number-space style)
const junkLine = /^\s*(\?D|www\.|http|按住|进入免费|想和小伙伴们|关注|鸿鹄梦|[\s~～～]*)\s*$/;

let entries = [];
let cur = null;

for (let rawLine of lines) {
  let line = rawLine.replace(/\?D[\s\S]{0,12}?[Qh]!\s*/g, "").trim();
  if (!line) continue;
  if (/^义义$|想和小伙伴们|鸿鹄梦在线课堂/.test(line)) continue;
  line = line.replace(/　/g, " ").trim();
  if (!line) continue;
  const m = line.match(entryStartA) || line.match(entryStartB);
  if (m) {
    if (cur) entries.push(cur);
    cur = { num: parseInt(m[1], 10), kanji: m[2].trim(), rest: [] };
    continue;
  }
  if (junkLine.test(line)) continue;
  if (!cur) continue;
  if (!cur.kanji) {
    cur.kanji = line;
  } else {
    cur.rest.push(line);
  }
}
if (cur) entries.push(cur);

entries = entries.filter(e => e.kanji && e.kanji.length > 0);

const insert = db.prepare(
  "INSERT INTO material_entries (material_id, kanji, cn, level, ling_type) VALUES (?,?,?,?,?)"
);
let n = 0;
const tx = db.transaction(() => {
  for (const e of entries) {
    const cn = e.rest.join("\n");
    insert.run(materialId, e.kanji, cn || null, level, "grammar");
    n++;
  }
});
tx();
console.log("parsed entries:", entries.length, "inserted:", n);
console.log(JSON.stringify(entries.slice(0, 5), null, 1));
