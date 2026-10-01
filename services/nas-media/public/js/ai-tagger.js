// AI图像标签识别 - NAS端接口扩展(纯JS模块)
module.exports = function (app, getDb) {

  (() => {
    const db = getDb();
    try { db.prepare("ALTER TABLE photos ADD COLUMN ai_status INTEGER DEFAULT 0").run(); } catch (e) {}
    try { db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_status ON photos(ai_status)").run(); } catch (e) {}
    try {
      db.prepare("CREATE TABLE IF NOT EXISTS photo_tags (md5 TEXT, tag TEXT, score REAL, source TEXT)").run();
      db.prepare("CREATE INDEX IF NOT EXISTS idx_pt_tag_score ON photo_tags(tag, score DESC)").run();
      db.prepare("CREATE INDEX IF NOT EXISTS idx_pt_md5 ON photo_tags(md5)").run();
    } catch (e) {}
  })();

  app.post('/api/photos/claim-ai', (req, res) => {
    const db = getDb();
    db.pragma('busy_timeout=3000');
    const b = req.body || {};
    const n = Math.max(1, Math.min(500, parseInt(b.n) || 20));
    const dirFilter = b.dirFilter ? String(b.dirFilter).replace(/\\/g, '/') : null;

    if (b.sample) {
      const rows = dirFilter
        ? db.prepare("SELECT id,path,md5 FROM photos WHERE status='done' AND path LIKE ? ORDER BY RANDOM() LIMIT ?").all(dirFilter + '%', n)
        : db.prepare("SELECT id,path,md5 FROM photos WHERE status='done' ORDER BY RANDOM() LIMIT ?").all(n);
      return res.json({ tasks: rows, sample: true });
    }

    const rows = dirFilter
      ? db.prepare("SELECT id,path,md5 FROM photos WHERE status='done' AND (ai_status IS NULL OR ai_status=0) AND path LIKE ? ORDER BY id ASC LIMIT ?").all(dirFilter + '%', n)
      : db.prepare("SELECT id,path,md5 FROM photos WHERE status='done' AND (ai_status IS NULL OR ai_status=0) ORDER BY id ASC LIMIT ?").all(n);
    res.json({ tasks: rows });
  });

  app.post('/api/photos/ai-result', (req, res) => {
    const b = req.body || {};
    const rawTags = Array.isArray(b.tags) ? b.tags : [];
    const scored = rawTags.map(t => {
      if (typeof t === 'string') return { tag: t, score: 0 };
      return { tag: String(t.tag), score: typeof t.score === 'number' ? t.score : 0 };
    });
    const tagNames = scored.map(t => t.tag);
    const tagsJson = JSON.stringify(tagNames);

    const db = getDb();
    db.pragma('busy_timeout=3000');

    let md5 = b.md5 || null;
    let r = { changes: 0 };
    if (md5) {
      r = db.prepare("UPDATE photos SET ai_tags=?, ai_status=1 WHERE md5=?").run(tagsJson, md5);
    }
    if (r.changes === 0 && b.path) {
      const norm = String(b.path).replace(/\\/g, '/');
      r = db.prepare("UPDATE photos SET ai_tags=?, ai_status=1 WHERE path=?").run(tagsJson, norm);
      if (r.changes > 0 && !md5) {
        const row = db.prepare("SELECT md5 FROM photos WHERE path=?").get(norm);
        if (row && row.md5) md5 = row.md5;
      }
    }

    if (md5) {
      const tx = db.transaction(() => {
        db.prepare("DELETE FROM photo_tags WHERE md5=? AND source='ai'").run(md5);
        const ins = db.prepare("INSERT INTO photo_tags (md5,tag,score,source) VALUES (?,?,?,'ai')");
        for (const t of scored) ins.run(md5, t.tag, t.score);
      });
      tx();
    }

    res.json({ ok: true, changes: r.changes, md5 });
  });

  app.post('/api/photos/ai-fail', (req, res) => {
    const b = req.body || {};
    const db = getDb();
    db.pragma('busy_timeout=3000');
    let r = { changes: 0 };
    if (b.md5) r = db.prepare("UPDATE photos SET ai_status=2 WHERE md5=?").run(b.md5);
    if (r.changes === 0 && b.path) {
      const norm = String(b.path).replace(/\\/g, '/');
      r = db.prepare("UPDATE photos SET ai_status=2 WHERE path=?").run(norm);
    }
    res.json({ ok: true, changes: r.changes });
  });

  app.get('/api/photos/ai-stats', (req, res) => {
    const db = getDb();
    const todo = db.prepare("SELECT COUNT(*) c FROM photos WHERE status='done' AND (ai_status IS NULL OR ai_status=0)").get().c;
    const done = db.prepare("SELECT COUNT(*) c FROM photos WHERE ai_status=1").get().c;
    res.json({ todo, done });
  });
};
