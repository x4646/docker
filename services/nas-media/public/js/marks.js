// marks.js — 收藏 / 评分系统
// 设计原则:md5 为唯一主键,重扫入库不丢失;photos.favorite 保持双写以兼容 TS 核心
// rating: 0=未评分, 1-10
// 挂载: try { require('./public/js/marks.js')(app, getDb); } catch(e) { }

module.exports = function (app, getDb) {

  // ── 初始化建表 ──────────────────────────────────────
  (function init() {
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS photo_marks (
      md5        TEXT PRIMARY KEY,
      favorite   INTEGER NOT NULL DEFAULT 0,
      rating     INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_marks_rating ON photo_marks(rating)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_marks_fav    ON photo_marks(favorite)`);

    // 播放历史(2026-08-13加): last_watched_at=最近一次播放的时间戳, watch_count=累计播放次数
    const marksCols = db.prepare('PRAGMA table_info(photo_marks)').all().map(c => c.name);
    if (marksCols.indexOf('last_watched_at') < 0) {
      db.exec('ALTER TABLE photo_marks ADD COLUMN last_watched_at INTEGER NOT NULL DEFAULT 0');
      db.exec('CREATE INDEX IF NOT EXISTS idx_marks_watched ON photo_marks(last_watched_at)');
      console.log('[marks] 已添加 last_watched_at 字段(播放历史)');
    }
    if (marksCols.indexOf('watch_count') < 0) {
      db.exec('ALTER TABLE photo_marks ADD COLUMN watch_count INTEGER NOT NULL DEFAULT 0');
      console.log('[marks] 已添加 watch_count 字段(播放历史)');
    }

    // 首次迁移:仅当表为空时,从 photos.favorite 导入一次
    const c = db.prepare('SELECT COUNT(*) c FROM photo_marks').get().c;
    if (c === 0) {
      const n = db.prepare(
        "INSERT OR IGNORE INTO photo_marks (md5, favorite, rating, updated_at) " +
        "SELECT md5, 1, 0, strftime('%s','now') FROM photos " +
        "WHERE favorite = 1 AND md5 IS NOT NULL AND length(md5) = 32"
      ).run().changes;
      console.log('[marks] 首次迁移收藏:', n, '条');
    }
    console.log('[marks] loaded, 现有记录:', db.prepare('SELECT COUNT(*) c FROM photo_marks').get().c);
  })();

  const isMd5 = (s) => typeof s === 'string' && /^[0-9a-fA-F]{32}$/.test(s);
  const now   = () => Math.floor(Date.now() / 1000);

  // ── 单查 ────────────────────────────────────────────
  // GET /api/marks?md5=xxx
  app.get('/api/marks', (req, res) => {
    const md5 = String(req.query.md5 || '').toLowerCase();
    if (!isMd5(md5)) return res.status(400).json({ error: 'md5 无效' });
    const db  = getDb();
    const row = db.prepare('SELECT md5, favorite, rating FROM photo_marks WHERE md5 = ?').get(md5);
    res.json(row || { md5, favorite: 0, rating: 0 });
  });

  // ── 批量查(网格缩略图用)─────────────────────────────
  // POST /api/marks/batch  {md5s:[...]}  → { md5: {favorite, rating} }
  app.post('/api/marks/batch', (req, res) => {
    const list = Array.isArray(req.body && req.body.md5s) ? req.body.md5s : [];
    const md5s = list.map(s => String(s || '').toLowerCase()).filter(isMd5);
    const out  = {};
    if (!md5s.length) return res.json(out);
    const db = getDb();
    for (let i = 0; i < md5s.length; i += 400) {
      const chunk = md5s.slice(i, i + 400);
      const ph    = chunk.map(() => '?').join(',');
      const rows  = db.prepare(
        'SELECT md5, favorite, rating FROM photo_marks WHERE md5 IN (' + ph + ')'
      ).all(...chunk);
      for (const r of rows) out[r.md5] = { favorite: r.favorite, rating: r.rating };
    }
    res.json(out);
  });

  // ── 设置(收藏 / 评分,两个维度独立,可单独传)────────────
  // POST /api/marks/set  {md5, favorite?: 0|1, rating?: 0-10}
  app.post('/api/marks/set', (req, res) => {
    const b   = req.body || {};
    const md5 = String(b.md5 || '').toLowerCase();
    if (!isMd5(md5)) return res.status(400).json({ error: 'md5 无效' });

    const hasFav = b.favorite !== undefined && b.favorite !== null;
    const hasRat = b.rating   !== undefined && b.rating   !== null;
    if (!hasFav && !hasRat) return res.status(400).json({ error: '未提供 favorite 或 rating' });

    let rating = 0;
    if (hasRat) {
      rating = parseInt(b.rating, 10);
      if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
        return res.status(400).json({ error: 'rating 必须为 0-10 的整数' });
      }
    }
    const favorite = hasFav ? (b.favorite ? 1 : 0) : 0;

    const db  = getDb();
    const cur = db.prepare('SELECT favorite, rating FROM photo_marks WHERE md5 = ?').get(md5);
    const nf  = hasFav ? favorite : (cur ? cur.favorite : 0);
    const nr  = hasRat ? rating   : (cur ? cur.rating   : 0);

    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO photo_marks (md5, favorite, rating, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(md5) DO UPDATE SET favorite = excluded.favorite, ' +
        'rating = excluded.rating, updated_at = excluded.updated_at'
      ).run(md5, nf, nr, now());
      // 双写 photos.favorite,兼容 TS 核心的 /api/photos?favorite=true
      if (hasFav) db.prepare('UPDATE photos SET favorite = ? WHERE md5 = ?').run(nf, md5);
    });
    tx();

    res.json({ ok: true, md5, favorite: nf, rating: nr });
  });

  // ── 翻转收藏 ────────────────────────────────────────
  // POST /api/marks/toggle-fav  {md5}
  app.post('/api/marks/toggle-fav', (req, res) => {
    const md5 = String((req.body && req.body.md5) || '').toLowerCase();
    if (!isMd5(md5)) return res.status(400).json({ error: 'md5 无效' });

    const db  = getDb();
    const cur = db.prepare('SELECT favorite, rating FROM photo_marks WHERE md5 = ?').get(md5);
    const nf  = cur && cur.favorite ? 0 : 1;
    const nr  = cur ? cur.rating : 0;

    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO photo_marks (md5, favorite, rating, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(md5) DO UPDATE SET favorite = excluded.favorite, updated_at = excluded.updated_at'
      ).run(md5, nf, nr, now());
      db.prepare('UPDATE photos SET favorite = ? WHERE md5 = ?').run(nf, md5);
    });
    tx();

    res.json({ ok: true, md5, favorite: nf, rating: nr });
  });

  // ── 播放历史(2026-08-13加) ──────────────────────────
  // POST /api/marks/clear-watched  {md5s:[...]}  批量清除播放记录(只清last_watched_at/watch_count,
  // 不动favorite/rating, 也不删整行记录, 避免误删收藏/评分)
  app.post('/api/marks/clear-watched', (req, res) => {
    const md5s = (req.body && req.body.md5s) || [];
    if (!Array.isArray(md5s) || !md5s.length) return res.status(400).json({ error: 'md5s 为空' });
    const valid = md5s.filter(isMd5).map(s => s.toLowerCase());
    if (!valid.length) return res.status(400).json({ error: '没有合法的md5' });

    const db = getDb();
    const stmt = db.prepare('UPDATE photo_marks SET last_watched_at = 0, watch_count = 0 WHERE md5 = ?');
    const tx = db.transaction((arr) => { arr.forEach((m) => stmt.run(m)); });
    tx(valid);

    res.json({ ok: true, cleared: valid.length });
  });

  // POST /api/marks/watched  {md5}  每次真正开始播放(在线播放或调起PotPlayer)时上报一次
  app.post('/api/marks/watched', (req, res) => {
    const md5 = String((req.body && req.body.md5) || '').toLowerCase();
    if (!isMd5(md5)) return res.status(400).json({ error: 'md5 无效' });

    const db = getDb();
    const t = now();
    db.prepare(
      'INSERT INTO photo_marks (md5, favorite, rating, updated_at, last_watched_at, watch_count) VALUES (?, 0, 0, ?, ?, 1) ' +
      'ON CONFLICT(md5) DO UPDATE SET last_watched_at = excluded.last_watched_at, watch_count = watch_count + 1'
    ).run(md5, t, t);

    res.json({ ok: true, md5, last_watched_at: t });
  });

  // ── 批量设置(右键多选用)────────────────────────────
  // POST /api/marks/set-batch  {md5s:[...], favorite?, rating?}
  app.post('/api/marks/set-batch', (req, res) => {
    const b    = req.body || {};
    const list = Array.isArray(b.md5s) ? b.md5s : [];
    const md5s = list.map(s => String(s || '').toLowerCase()).filter(isMd5);
    if (!md5s.length) return res.status(400).json({ error: 'md5s 为空' });

    const hasFav = b.favorite !== undefined && b.favorite !== null;
    const hasRat = b.rating   !== undefined && b.rating   !== null;
    if (!hasFav && !hasRat) return res.status(400).json({ error: '未提供 favorite 或 rating' });

    let rating = 0;
    if (hasRat) {
      rating = parseInt(b.rating, 10);
      if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
        return res.status(400).json({ error: 'rating 必须为 0-10 的整数' });
      }
    }
    const favorite = hasFav ? (b.favorite ? 1 : 0) : 0;

    const db  = getDb();
    const ins = db.prepare(
      'INSERT INTO photo_marks (md5, favorite, rating, updated_at) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(md5) DO UPDATE SET favorite = excluded.favorite, ' +
      'rating = excluded.rating, updated_at = excluded.updated_at'
    );
    const sel  = db.prepare('SELECT favorite, rating FROM photo_marks WHERE md5 = ?');
    const updP = db.prepare('UPDATE photos SET favorite = ? WHERE md5 = ?');
    const ts   = now();

    const tx = db.transaction(() => {
      for (const m of md5s) {
        const cur = sel.get(m);
        const nf  = hasFav ? favorite : (cur ? cur.favorite : 0);
        const nr  = hasRat ? rating   : (cur ? cur.rating   : 0);
        ins.run(m, nf, nr, ts);
        if (hasFav) updP.run(nf, m);
      }
    });
    tx();

    res.json({ ok: true, count: md5s.length });
  });

  // ── 统计 ────────────────────────────────────────────
  // GET /api/marks/stats?mediaType=video|photo&live=1
  //   mediaType 限定媒体类型(视频页只数视频, 否则计数会把照片算进来)
  //   live=1 只数 photos 表里还存在的记录(排除清理后的孤儿)
  let _mtOk = null;
  function hasMediaType() {
    if (_mtOk !== null) return _mtOk;
    try {
      _mtOk = getDb().prepare('PRAGMA table_info(photos)').all()
                .some(c => c.name === 'media_type');
    } catch (e) { _mtOk = false; }
    return _mtOk;
  }

  app.get('/api/marks/stats', (req, res) => {
    const db = getDb();
    let mt = String(req.query.mediaType || '').trim();
    if (mt !== 'photo' && mt !== 'video') mt = '';
    const live = req.query.live === '1' || !!mt;   // 指定类型时必然要 join

    let from = 'photo_marks m', where = [];
    const params = [];
    if (live) {
      from = 'photo_marks m CROSS JOIN photos p ON p.md5 = m.md5';
      if (mt && hasMediaType()) { where.push('p.media_type = ?'); params.push(mt); }
      else if (mt) { where.push('1 = 0'); }
    }
    const w = where.length ? (' AND ' + where.join(' AND ')) : '';

    const favSql = 'SELECT COUNT(DISTINCT m.md5) c FROM ' + from + ' WHERE m.favorite = 1' + w;
    const fav = db.prepare(favSql).get(...params).c;

    const rows = db.prepare(
      'SELECT m.rating rating, COUNT(DISTINCT m.md5) c FROM ' + from +
      ' WHERE m.rating > 0' + w + ' GROUP BY m.rating ORDER BY m.rating'
    ).all(...params);

    const ratings = {};
    let rated = 0;
    for (const r of rows) { ratings[r.rating] = r.c; rated += r.c; }
    res.json({ favorite: fav, rated: rated, ratings: ratings, mediaType: mt || 'all', live: live });
  });

  // ── 重扫入库后的双向对账 ────────────────────────────
  // 背景: 清理策略是"删记录留缓存", 重扫后 photos 行是新建的, favorite 恒为 0,
  //       而 photo_marks 仍记着收藏 → 旧接口 /api/photos?favorite=true 会返回空。
  // 本接口以 photo_marks 为准, 让 photos.favorite 与之一致。
  // 顺序不可颠倒: 先把旧后门接口写进 photos 的收藏捡回来, 再回填, 最后清零。
  // POST /api/marks/resync  {dryRun?: true}
  app.post('/api/marks/resync', (req, res) => {
    const db     = getDb();
    const dryRun = !!(req.body && req.body.dryRun);

    // ① photos 里收藏了、但 photo_marks 没有记录的 —— 来自旧接口 /api/photos/:id/favorite
    const qImport = "SELECT COUNT(DISTINCT md5) c FROM photos p WHERE p.favorite = 1 " +
      "AND p.md5 IS NOT NULL AND length(p.md5) = 32 " +
      "AND NOT EXISTS (SELECT 1 FROM photo_marks m WHERE m.md5 = p.md5)";
    // ② photo_marks 说收藏、photos 说没有 —— 重扫后的典型状态
    const qFill = "SELECT COUNT(*) c FROM photos p JOIN photo_marks m ON m.md5 = p.md5 " +
      "WHERE m.favorite = 1 AND p.favorite <> 1";
    // ③ photo_marks 说没收藏、photos 说收藏 —— 别处取消过收藏但没同步
    const qClear = "SELECT COUNT(*) c FROM photos p JOIN photo_marks m ON m.md5 = p.md5 " +
      "WHERE m.favorite = 0 AND p.favorite <> 0";

    const plan = {
      willImport: db.prepare(qImport).get().c,
      willFill:   db.prepare(qFill).get().c,
      willClear:  db.prepare(qClear).get().c
    };

    if (dryRun) return res.json({ dryRun: true, plan: plan });

    const tx = db.transaction(() => {
      const imported = db.prepare(
        "INSERT OR IGNORE INTO photo_marks (md5, favorite, rating, updated_at) " +
        "SELECT DISTINCT p.md5, 1, 0, strftime('%s','now') FROM photos p " +
        "WHERE p.favorite = 1 AND p.md5 IS NOT NULL AND length(p.md5) = 32"
      ).run().changes;

      const filled = db.prepare(
        "UPDATE photos SET favorite = 1 WHERE md5 IN " +
        "(SELECT md5 FROM photo_marks WHERE favorite = 1) AND favorite <> 1"
      ).run().changes;

      const cleared = db.prepare(
        "UPDATE photos SET favorite = 0 WHERE md5 IN " +
        "(SELECT md5 FROM photo_marks WHERE favorite = 0) AND favorite <> 0"
      ).run().changes;

      return { imported: imported, filled: filled, cleared: cleared };
    });

    const r = tx();
    console.log('[marks] resync 导入', r.imported, '回填', r.filled, '清零', r.cleared);
    res.json({ ok: true, imported: r.imported, filled: r.filled, cleared: r.cleared });
  });

  // ── 一致性体检(只读, 不改数据)────────────────────────
  // GET /api/marks/health
  app.get('/api/marks/health', (req, res) => {
    const db = getDb();
    res.json({
      marksTotal: db.prepare('SELECT COUNT(*) c FROM photo_marks').get().c,
      orphans: db.prepare(
        'SELECT COUNT(*) c FROM photo_marks m WHERE NOT EXISTS (SELECT 1 FROM photos p WHERE p.md5 = m.md5)'
      ).get().c,
      photosNoMd5: db.prepare(
        'SELECT COUNT(*) c FROM photos WHERE md5 IS NULL OR length(md5) <> 32'
      ).get().c,
      favMismatch: db.prepare(
        'SELECT COUNT(*) c FROM photos p JOIN photo_marks m ON m.md5 = p.md5 WHERE m.favorite <> p.favorite'
      ).get().c,
      favOnlyInPhotos: db.prepare(
        "SELECT COUNT(DISTINCT md5) c FROM photos p WHERE p.favorite = 1 " +
        "AND p.md5 IS NOT NULL AND length(p.md5) = 32 " +
        "AND NOT EXISTS (SELECT 1 FROM photo_marks m WHERE m.md5 = p.md5)"
      ).get().c
    });
  });

  // ── 手动重跑迁移(幂等,INSERT OR IGNORE)──────────────
  // POST /api/marks/migrate  {dryRun?: true}
  app.post('/api/marks/migrate', (req, res) => {
    const db     = getDb();
    const dryRun = !!(req.body && req.body.dryRun);
    const sql    = "FROM photos WHERE favorite = 1 AND md5 IS NOT NULL AND length(md5) = 32";
    const willBe = db.prepare(
      "SELECT COUNT(*) c FROM (SELECT DISTINCT md5 " + sql +
      " AND md5 NOT IN (SELECT md5 FROM photo_marks))"
    ).get().c;
    if (dryRun) return res.json({ dryRun: true, willInsert: willBe });
    const n = db.prepare(
      "INSERT OR IGNORE INTO photo_marks (md5, favorite, rating, updated_at) " +
      "SELECT md5, 1, 0, strftime('%s','now') " + sql
    ).run().changes;
    res.json({ ok: true, inserted: n });
  });

};
