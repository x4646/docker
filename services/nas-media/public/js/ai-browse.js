// AI标签浏览 - NAS端JS扩展 (基于 photo_tags 关联表，走索引，秒回)
module.exports = function (app, getDb) {

  app.get('/api/ai/tags', (req, res) => {
    const db = getDb();
    try {
      const rows = db.prepare(
        "SELECT tag, COUNT(DISTINCT md5) count FROM photo_tags GROUP BY tag ORDER BY count DESC"
      ).all();
      res.json(rows.map(r => ({ name: r.tag, count: r.count })));
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get('/api/ai/photos', (req, res) => {
    const db = getDb();
    const tags = String(req.query.tags || '').split(',').map(s => s.trim()).filter(Boolean);
    const mode = req.query.mode === 'and' ? 'and' : 'or';
    const dirPath = req.query.dirPath ? String(req.query.dirPath).replace(/\\/g, '/') : '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    if (tags.length === 0) return res.json({ photos: [], total: 0 });

    try {
      const placeholders = tags.map(() => '?').join(',');
      let sql, params;

      if (mode === 'and') {
        sql = `SELECT md5, MIN(score) rank_score FROM photo_tags WHERE tag IN (${placeholders})
               GROUP BY md5 HAVING COUNT(DISTINCT tag) = ?`;
        params = [...tags, tags.length];
      } else {
        sql = `SELECT md5, MAX(score) rank_score FROM photo_tags WHERE tag IN (${placeholders})
               GROUP BY md5`;
        params = [...tags];
      }

      const matched = db.prepare(sql).all(...params);
      if (matched.length === 0) return res.json({ photos: [], total: 0 });

      const scoreMap = new Map(matched.map(r => [r.md5, r.rank_score]));
      const md5List = matched.map(r => r.md5);

      const md5Placeholders = md5List.map(() => '?').join(',');
      let photoSql = `SELECT * FROM photos WHERE md5 IN (${md5Placeholders})`;
      const photoParams = [...md5List];
      if (dirPath) { photoSql += " AND path LIKE ?"; photoParams.push(dirPath + '%'); }

      let photos = db.prepare(photoSql).all(...photoParams);
      photos.sort((a, b) => (scoreMap.get(b.md5) || 0) - (scoreMap.get(a.md5) || 0));

      const total = photos.length;
      const pageItems = photos.slice(offset, offset + limit);

      res.json({ photos: pageItems, total });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // ── 按标签取“含该标签图片的目录”列表(平铺, 带数量) ──
  app.get('/api/ai/tag-dirs', (req, res) => {
    const db = getDb();
    const tags = String(req.query.tags || '').split(',').map(s => s.trim()).filter(Boolean);
    const mode = req.query.mode === 'and' ? 'and' : 'or'; // single按or处理(单标签语义相同)
    const th = Math.max(0, Math.min(1, parseFloat(req.query.threshold || '0') || 0));
    if (tags.length === 0) return res.json([]);
    try {
      const placeholders = tags.map(() => '?').join(',');
      // 阈值过滤: manual恒通过, AI按每图归一化分
      const thCond = "(t.source='manual' OR (tp.top > 0 AND t.score >= tp.top * ?))";
      const base = `FROM photo_tags t LEFT JOIN (SELECT md5, MAX(score) top FROM photo_tags WHERE source != 'manual' GROUP BY md5) tp ON tp.md5 = t.md5 WHERE t.tag IN (${placeholders}) AND ${thCond}`;
      let sql, params;
      if (mode === 'and') {
        sql = `SELECT t.md5 ${base} GROUP BY t.md5 HAVING COUNT(DISTINCT t.tag)=?`;
        params = [...tags, th, tags.length];
      } else {
        sql = `SELECT DISTINCT t.md5 ${base}`;
        params = [...tags, th];
      }
      const md5s = db.prepare(sql).all(...params).map(r => r.md5);
      if (md5s.length === 0) return res.json([]);
      const dirCount = new Map();
      const CHUNK = 500;
      for (let i = 0; i < md5s.length; i += CHUNK) {
        const part = md5s.slice(i, i + CHUNK);
        const ph = part.map(() => '?').join(',');
        const rows = db.prepare(`SELECT path, dir FROM photos WHERE md5 IN (${ph})`).all(...part);
        for (const r of rows) {
          let d = r.dir;
          if (!d && r.path) {
            const p = String(r.path).replace(/\\/g, '/');
            const idx = p.lastIndexOf('/');
            d = idx > 0 ? p.slice(0, idx) : p;
          }
          if (!d) continue;
          dirCount.set(d, (dirCount.get(d) || 0) + 1);
        }
      }
      const list = Array.from(dirCount.entries())
        .map(([path, count]) => ({ path, count }))
        .sort((a, b) => b.count - a.count);
      res.json(list);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

};
