"use strict";
// Parser for header-word + bullet-example style:
//   word（kanji）
//   · example sentence.「chinese gloss」
//   · example sentence.「chinese gloss」
// A header line has no leading bullet and is not itself a bullet/junk line.
const fs = require("fs");
const path = require("path");
const db = require("./db");

const txtFile = process.argv[2];
const materialId = parseInt(process.argv[3], 10);
const level = process.argv[4] || null;
if (!txtFile || !materialId) {
  console.error("usage: node tmp-parse-vocab-bullet.js <txtFile> <materialId> [level]");
  process.exit(1);
}

const raw = fs.readFileSync(path.join(__dirname, txtFile), "utf8");
const lines = raw.split(/\r?\n/);

const bulletRe = /^[・·]\s*(.+)$/;
const headerRe = /^([^\s（(]+)[（(]([^）)]+)[）)]\s*$/; // word（かな）
const junkLine = /想和小伙伴们|鸿鹄梦在线课堂|^[あ-んア-ン]行$|^\s*$/;

const insert = db.prepare(
  "INSERT INTO material_entries (material_id, kanji, kana, cn, level, ling_type) VALUES (?,?,?,?,?,'vocab')"
);
let n = 0;
let cur = null; // {kanji, kana, examples: []}

function flush() {
  if (cur && (cur.examples.length || cur.kanji)) {
    const cn = cur.examples.join("\n");
    insert.run(materialId, cur.kanji, cur.kana || null, cn || null, level);
    n++;
  }
  cur = null;
}

const tx = db.transaction(() => {
  for (let rawLine of lines) {
    let line = rawLine.replace(/\?D[\s\S]{0,12}?[Qh]!\s*/g, "").trim();
    if (!line || junkLine.test(line)) continue;

    const b = line.match(bulletRe);
    if (b) {
      if (cur) cur.examples.push(b[1]);
      continue;
    }
    // header candidate: new word entry
    const h = line.match(headerRe);
    flush();
    if (h) {
      cur = { kanji: h[2] || h[1], kana: h[1] !== h[2] ? h[1] : "", examples: [] };
      // actually file format is "reading（kanji）" -- reading first, kanji in parens
      cur = { kanji: h[2], kana: h[1], examples: [] };
    } else {
      cur = { kanji: line, kana: "", examples: [] };
    }
  }
  flush();
});
tx();
console.log("inserted:", n);
