import express from 'express';
import path from 'path';
import fs from 'fs';
import { ConsoleLogger } from '../infrastructure/logger/ConsoleLogger';
import { SqlitePhotoRepository } from '../infrastructure/repositories/SqlitePhotoRepository';
import { PhotoUseCase } from '../application/PhotoUseCase';
import { PhotoController } from '../interfaces/http/PhotoController';
import { FileBrowserController } from '../shared/browser/FileBrowserController';

export class Container {

  private readonly app = express();

  constructor(private readonly config: any) {}

  build(): this {
    const logger       = new ConsoleLogger();
    const photoRepo    = new SqlitePhotoRepository(this.config.DB_PATH);
    const photoUseCase = new PhotoUseCase(photoRepo, logger, this.config.PIPE_URL, this.config.DATA_PATH);

    this.app.use(express.json());
    this.app.use(express.static('/app/public'));
    this.app.use('/thumbs',  express.static(path.join(this.config.DATA_PATH, 'thumbs')));
    this.app.use('/preview', express.static(path.join(this.config.DATA_PATH, 'preview')));

    // 原图访问
    this.app.get('/original/*', (req, res) => {
      const filePath = '/' + (req.params as any)[0];
      if (fs.existsSync(filePath)) res.sendFile(filePath);
      else res.status(404).json({ error: 'not found' });
    });

    // 音乐文件流
    this.app.get('/music/*', (req, res) => {
      const filePath = '/share/' + (req.params as any)[0];
      if (fs.existsSync(filePath)) res.sendFile(filePath);
      else res.status(404).json({ error: 'not found' });
    });

    // 图片API
    // 引入扩展路由（纯JS，挂载后重启即生效）
    try { require("../../../../routes")(this.app, this.db.bind(this)); } catch(e) { logger.warn("routes.js加载失败", { error: String(e) }); }
    // 引入扩展路由（纯JS，挂载后重启即生效）
    try { require("../../../../routes")(this.app, this.db.bind(this)); } catch(e) { logger.warn("routes.js加载失败", { error: String(e) }); }
    const photoCtrl = new PhotoController(photoUseCase);
    this.app.use('/api/photos', photoCtrl.router);

    // 文件浏览器API（共通组件）
    const browserCtrl = new FileBrowserController();
    this.app.use('/api/browser', browserCtrl.router);

    // 监控目录API
    this.app.get('/api/watch-dirs', (req, res) => {
      const dirs = this.db().prepare('SELECT * FROM photo_watch_dirs').all();
      res.json(dirs);
    });
    this.app.post('/api/watch-dirs', (req, res) => {
      const { path: dirPath } = req.body;
      if (!dirPath) return res.status(400).json({ error: '缺少path' });
      this.db().prepare('INSERT OR IGNORE INTO photo_watch_dirs (path) VALUES (?)').run(dirPath);
      res.json({ ok: true });
    });
    this.app.delete('/api/watch-dirs/:id', (req, res) => {
      this.db().prepare('DELETE FROM photo_watch_dirs WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    });

    // 播放列表API
    this.app.get('/api/playlists', (req, res) => {
      const lists = this.db().prepare('SELECT * FROM playlists').all();
      res.json(lists.map((l: any) => ({ ...l, songs: JSON.parse(l.songs) })));
    });
    this.app.post('/api/playlists', (req, res) => {
      const { name, songs = [] } = req.body;
      if (!name) return res.status(400).json({ error: '缺少name' });
      const r = this.db().prepare('INSERT INTO playlists (name, songs) VALUES (?, ?)').run(name, JSON.stringify(songs));
      res.json({ ok: true, id: r.lastInsertRowid });
    });
    this.app.put('/api/playlists/:id', (req, res) => {
      const { name, songs } = req.body;
      this.db().prepare('UPDATE playlists SET name = ?, songs = ? WHERE id = ?')
        .run(name, JSON.stringify(songs || []), req.params.id);
      res.json({ ok: true });
    });
    this.app.delete('/api/playlists/:id', (req, res) => {
      this.db().prepare('DELETE FROM playlists WHERE id = ?').run(req.params.id);
      res.json({ ok: true });
    });

    // 音乐设置
    this.app.get('/api/music-settings', (req, res) => {
      res.json(this.db().prepare('SELECT * FROM music_settings WHERE id = 1').get());
    });
    this.app.post('/api/music-settings', (req, res) => {
      const { mode, volume, auto_play, playlist_id } = req.body;
      this.db().prepare('UPDATE music_settings SET mode=?, volume=?, auto_play=?, playlist_id=? WHERE id=1')
        .run(mode, volume, auto_play ? 1 : 0, playlist_id);
      res.json({ ok: true });
    });


    // 数据库管理接口
    this.app.post("/api/db/query", (req: any, res: any) => {
      const { sql } = req.body;
      if (!sql) return res.status(400).json({ error: "缺少sql" });
      try {
        const stmt = this.db().prepare(sql);
        if (sql.trim().toUpperCase().startsWith("SELECT")) {
          res.json({ rows: stmt.all() });
        } else {
          const r = stmt.run();
          res.json({ changes: r.changes });
        }
      } catch(e: any) {
        res.json({ error: e.message });
      }
    });


    // 时间分组接口
    this.app.get("/api/photos/groups/time", (req: any, res: any) => {
      const rows = this.db().prepare(`
        SELECT
          CAST(strftime('%Y', exif_time, 'unixepoch') AS INTEGER) as year,
          CAST(strftime('%m', exif_time, 'unixepoch') AS INTEGER) as month,
          COUNT(*) as count
        FROM photos
        WHERE status = 'done' AND exif_time IS NOT NULL
        GROUP BY year, month
        ORDER BY year DESC, month DESC
      `).all();
      res.json(rows);
    });

    // 目录分组接口
    // 目录树懒加载：不传path返回根目录，传path返回该目录的直接子目录
    this.app.get("/api/photos/groups/dir", (req: any, res: any) => {
      const db      = this.db();
      const reqPath = req.query.path as string;

      if (!reqPath) {
        // 返回browser_roots根目录
        const roots = db.prepare("SELECT * FROM browser_roots WHERE source = 'nas' AND enabled = 1 ORDER BY name").all() as any[];
        const result = roots.map((r: any) => {
          const count = (db.prepare("SELECT COUNT(*) as cnt FROM photos WHERE path LIKE ?").get(r.path + "/%") as any).cnt;
          const hasChildren = count > 0;
          return { id: String(r.id), path: r.path, name: r.name, count, depth: 0, hasChildren };
        });
        return res.json(result);
      }

      // 返回指定路径的直接子目录
      const fs   = require("fs");
      const path = require("path");
      const result: any[] = [];

      try {
        const items = fs.readdirSync(reqPath);
        for (const name of items) {
          if (name.startsWith(".") || name.startsWith("@")) continue;
          const full = path.join(reqPath, name);
          try {
            if (fs.statSync(full).isDirectory()) {
              const count = (db.prepare("SELECT COUNT(*) as cnt FROM photos WHERE path LIKE ?").get(full + "/%") as any).cnt;
              if (count === 0) continue;
              const pending = (db.prepare("SELECT COUNT(*) as cnt FROM photos WHERE path LIKE ? AND status IN ('pending','processing')").get(full + "/%") as any).cnt;
              const done    = (db.prepare("SELECT COUNT(*) as cnt FROM photos WHERE path LIKE ? AND status = 'done'").get(full + "/%") as any).cnt;
              const hasChildren = fs.readdirSync(full).some((n: string) => !n.startsWith(".") && !n.startsWith("@") && fs.statSync(path.join(full,n)).isDirectory());
              result.push({ id: full, path: full, name, count, done, pending, depth: 1, hasChildren });
            }
          } catch(e) {}
        }
      } catch(e) {}

      result.sort((a: any, b: any) => a.name.localeCompare(b.name, "ja"));
      res.json(result);
    });



    // 按目录统计状态
    this.app.get("/api/photos/stats/by-dir", (req: any, res: any) => {
      const dirPath = req.query.path as string;
      if (!dirPath) return res.status(400).json({ error: "缺少path" });
      const db = this.db();
      const stats = db.prepare(`
        SELECT status, COUNT(*) as cnt FROM photos
        WHERE path LIKE ? GROUP BY status
      `).all(dirPath + "/%");
      const result: any = { pending: 0, processing: 0, done: 0, error: 0 };
      (stats as any[]).forEach((s: any) => { result[s.status] = s.cnt; });
      result.total = result.pending + result.processing + result.done + result.error;
      res.json(result);
    });

    // 文件数量异步统计（单独接口，不阻塞）
    this.app.get("/api/photos/filecount", (req, res) => {
      const dirPath = req.query.path as string;
      if (!dirPath) return res.status(400).json({ error: "缺少path" });
      const fsLib   = require("fs");
      const pathLib = require("path");
      const EXTS    = new Set([".jpg",".jpeg",".png",".heic",".webp",".gif",".bmp",".tiff",".raw"]);
      let count = 0;
      const walk = (dir: string) => {
        try {
          fsLib.readdirSync(dir).forEach((n: string) => {
            if (n.startsWith(".") || n.startsWith("@")) return;
            const f = pathLib.join(dir, n);
            try {
              const s = fsLib.statSync(f);
              if (s.isDirectory()) walk(f);
              else if (EXTS.has(pathLib.extname(n).toLowerCase())) count++;
            } catch(e) {}
          });
        } catch(e) {}
      };
      setImmediate(() => {
        walk(dirPath);
        res.json({ count });
      });
    });

    // 按目录派发任务
    this.app.post("/api/photos/dispatch/dir", async (req: any, res: any) => {
      const { dirPath, reprocess } = req.body;
      if (!dirPath) return res.status(400).json({ error: "缺少dirPath" });
      const db = this.db();
      if (reprocess) {
        db.prepare("UPDATE photos SET status='pending', thumb_path=NULL, preview_path=NULL WHERE path LIKE ? AND status='done'").run(dirPath + "/%");
      }
      const sent = await photoUseCase.dispatchPendingByDir(dirPath);
      res.json({ ok: true, sent });
    });

    // 重新处理单张图片
    this.app.post("/api/photos/:id/reprocess", async (req: any, res: any) => {
      const photo = photoUseCase.getPhoto(parseInt(req.params.id));
      if (!photo) return res.status(404).json({ error: "not found" });
      this.db().prepare("UPDATE photos SET status='pending', thumb_path=NULL, preview_path=NULL WHERE id=?").run(photo.id);
      const sent = await photoUseCase.dispatchPending();
      res.json({ ok: true, sent });
    });

    // 定时派发任务（每30秒）
    // setInterval(() => photoUseCase.dispatchPending(), 30000);
    // 超时重置：processing超过10分钟重置为pending
    setInterval(() => {
      const db      = this.db();
      const timeout = Math.floor(Date.now() / 1000) - 600;
      const r       = db.prepare("UPDATE photos SET status='pending' WHERE status='processing' AND updated_at < ?").run(timeout);
      if (r.changes > 0) logger.info(`超时重置 ${r.changes} 张图片`);
    }, 60000);


    // PC根目录配置接口
    const pcRootsPath = "/data/pc_roots.json";
    this.app.get("/api/pc-roots", (req: any, res: any) => {
      try {
        if (fs.existsSync(pcRootsPath)) {
          res.json(JSON.parse(fs.readFileSync(pcRootsPath, "utf8")));
        } else {
          res.json([]);
        }
      } catch(e) { res.json([]); }
    });
    this.app.post("/api/pc-roots", (req: any, res: any) => {
      const { name, path: dirPath } = req.body;
      if (!name || !dirPath) return res.status(400).json({ error: "缺少name或path" });
      try {
        const roots = fs.existsSync(pcRootsPath) ? JSON.parse(fs.readFileSync(pcRootsPath, "utf8")) : [];
        roots.push({ name, path: dirPath });
        fs.writeFileSync(pcRootsPath, JSON.stringify(roots, null, 2));
        res.json({ ok: true });
      } catch(e: any) { res.json({ error: e.message }); }
    });
    this.app.delete("/api/pc-roots/:idx", (req: any, res: any) => {
      try {
        const roots = fs.existsSync(pcRootsPath) ? JSON.parse(fs.readFileSync(pcRootsPath, "utf8")) : [];
        roots.splice(parseInt(req.params.idx), 1);
        fs.writeFileSync(pcRootsPath, JSON.stringify(roots, null, 2));
        res.json({ ok: true });
      } catch(e: any) { res.json({ error: e.message }); }
    });
    // 引入扩展路由（纯JS，挂载后重启即生效）
    logger.info('Photo Indexer容器构建完成');
    return this;
  }

  private db() {
    return require('better-sqlite3')(this.config.DB_PATH);
  }

  start(port: number): void {
    this.app.listen(port, '0.0.0.0', () => {
      console.log(`Photo Indexer running on port ${port}`);
    });
  }
}
