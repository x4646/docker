/*
 * migrate-shard-thumbs.js — 把 data/photos/thumbs、data/photos/preview 从平铺目录
 * 迁移成按 md5 前2位分 256 个子目录(跟 vthumbs、NAS端sharp处理、PC端处理新写入的规则统一)。
 *
 * ⚠ 只能在 NAS 容器里跑(操作的是容器本地磁盘 /data/photos,不是从别的机器挂网络盘去搬,
 *   几十万个文件的改名操作走网络盘会非常慢而且容易中途出问题)。
 *
 * 安全设计:
 *   - 每一行"先挪文件、再更新DB"; 中途被打断也不会出现"DB指向的文件消失了"这种坏状态
 *     ——要么这一行完全没动(旧路径还在), 要么完全迁移完(新路径, DB也已更新)。
 *   - 幂等、可重复跑:已经是分片路径的记录会被自动跳过; 如果上次跑到一半被杀掉,导致
 *     "文件已经挪到新位置但DB还没来得及提交"这种情况,重新跑一遍会自动识别出来只补DB、
 *     不会重复挪文件或报错。
 *   - 文件本身已经不存在的(孤立记录), 记一个数, DB不动, 不影响其它记录。
 *
 * 用法(容器里执行, 路径按实际情况调整):
 *   node migrate-shard-thumbs.js --dry-run   # 先只统计一遍,不改任何东西,看看规模/有没有异常
 *   node migrate-shard-thumbs.js             # 真正执行
 *
 * docker exec 示例(容器名换成实际的):
 *   docker exec -it photo-indexer node /app/migrate-shard-thumbs.js --dry-run
 *   docker exec -it photo-indexer node /app/migrate-shard-thumbs.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA      = process.env.DATA_PATH || '/data';
const DB_PATH   = process.env.DB_PATH   || path.join(DATA, 'nas.db');
const THUMB_DIR   = path.join(DATA, 'photos', 'thumbs');
const PREVIEW_DIR = path.join(DATA, 'photos', 'preview');

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH   = 200;   // 每处理这么多行提交一次事务(减少fsync次数,加快速度)

// 只认"平铺"的老格式: thumbs/<32位hex>_thumb.jpg / preview/<32位hex>_preview.jpg
// 已经分片过的(thumbs/xx/<hash>_thumb.jpg)不会匹配, 天然跳过。
const FLAT_THUMB_RE   = /^thumbs\/([0-9a-f]{32})_thumb\.jpg$/;
const FLAT_PREVIEW_RE = /^preview\/([0-9a-f]{32})_preview\.jpg$/;

// 注意: 分片用的hash是从文件名里解析出来的,不是DB的md5列——实测DB里存在少量
// thumb_path文件名内嵌的hash跟md5列对不上的历史脏数据(大概是复用缩略图时留下的),
// 按文件名本身的hash分片才能保证挪完文件还能找到,不能信md5列。
function planOne(rel, re, baseDir, kind) {
  const m = rel && rel.match(re);
  if (!m) return null;
  const hash = m[1];
  const shard = hash.slice(0, 2);
  const base = path.basename(rel);
  return {
    kind,
    oldFull: path.join(baseDir, base),
    newFull: path.join(baseDir, shard, base),
    newRel:  rel.replace(hash, shard + '/' + hash),
    shardDir: path.join(baseDir, shard),
  };
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[migrate] 找不到数据库: ${DB_PATH} —— 这个脚本要在NAS容器里跑,不是在挂载的网络盘上跑`);
    process.exit(1);
  }
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const rows = db.prepare(
    "SELECT id, thumb_path, preview_path FROM photos WHERE thumb_path LIKE 'thumbs/%' OR preview_path LIKE 'preview/%'"
  ).all();

  console.log(`[migrate] 候选行数: ${rows.length}${DRY_RUN ? '  (dry-run,不会真的改文件/DB)' : ''}`);

  const updateStmt = db.prepare(
    'UPDATE photos SET thumb_path = COALESCE(?, thumb_path), preview_path = COALESCE(?, preview_path) WHERE id = ?'
  );

  let scanned = 0, skipped = 0, errors = 0;
  const stat = { movedThumb: 0, movedPreview: 0, healedThumb: 0, healedPreview: 0, missingThumb: 0, missingPreview: 0 };

  let inTx = false;
  const begin  = () => { if (!inTx && !DRY_RUN) { db.exec('BEGIN'); inTx = true; } };
  const commit = () => { if (inTx) { db.exec('COMMIT'); inTx = false; } };

  for (const row of rows) {
    scanned++;
    const tPlan = planOne(row.thumb_path,   FLAT_THUMB_RE,   THUMB_DIR,   'thumb');
    const pPlan = planOne(row.preview_path, FLAT_PREVIEW_RE, PREVIEW_DIR, 'preview');
    if (!tPlan && !pPlan) { skipped++; continue; }

    let newThumbRel = null, newPreviewRel = null;
    try {
      for (const plan of [tPlan, pPlan].filter(Boolean)) {
        if (!DRY_RUN) fs.mkdirSync(plan.shardDir, { recursive: true });
        const oldExists = fs.existsSync(plan.oldFull);
        const newExists = fs.existsSync(plan.newFull);
        if (oldExists) {
          if (!DRY_RUN) fs.renameSync(plan.oldFull, plan.newFull);
          stat[plan.kind === 'thumb' ? 'movedThumb' : 'movedPreview']++;
        } else if (newExists) {
          // 上次跑到一半被打断: 文件已经在新位置了,只是DB还没来得及提交,这次只补DB
          stat[plan.kind === 'thumb' ? 'healedThumb' : 'healedPreview']++;
        } else {
          // 两边都没有,文件本身已经丢了(孤立记录), 跳过, 不动DB, 留着老路径方便排查
          stat[plan.kind === 'thumb' ? 'missingThumb' : 'missingPreview']++;
          continue;
        }
        if (plan.kind === 'thumb') newThumbRel = plan.newRel; else newPreviewRel = plan.newRel;
      }
      if ((newThumbRel || newPreviewRel) && !DRY_RUN) {
        begin();
        updateStmt.run(newThumbRel, newPreviewRel, row.id);
      }
    } catch (e) {
      errors++;
      console.error(`[migrate] id=${row.id} 出错:`, e.message);
    }

    if (scanned % BATCH === 0) commit();
    if (scanned % 5000 === 0) console.log(`[migrate] 进度 ${scanned}/${rows.length}`);
  }
  commit();

  console.log('[migrate] 完成:', { scanned, skipped, errors, ...stat });
  db.close();
}

main();
