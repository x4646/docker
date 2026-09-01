"use strict";
const fs = require("fs");
const path = require("path");
const db = require("./db");
const tag = process.argv[2];
const materialId = parseInt(process.argv[3], 10);
const lingType = process.argv[4] || "pattern";
if (!tag || !materialId) { console.error("usage: node tmp-apply-material.js <tag> <materialId> [lingType]"); process.exit(1); }
const file = path.join(__dirname, "tmp-material-" + tag + ".json");
const items = JSON.parse(fs.readFileSync(file, "utf8"));
const insert = db.prepare(
  "INSERT INTO material_entries (material_id, kanji, cn, level, ling_type, example_kanji, example_cn) VALUES (?,?,?,?,?,?,?)"
);
let n = 0;
const tx = db.transaction(() => {
  for (const it of items) {
    insert.run(materialId, it.kanji, it.cn || null, it.level || null, lingType, it.exampleKanji || null, it.exampleCn || null);
    n++;
  }
});
tx();
console.log(tag, "material entries inserted:", n, "/ entries in file:", items.length);
