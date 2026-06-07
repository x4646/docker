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
    this.app.get("/api/photos/groups/dir", (req: any, res: any) => {
      const db   = this.db();
      const dirs = db.prepare("SELECT * FROM photo_watch_dirs WHERE enabled = 1").all() as any[];
      const result: any[] = [];

      const walk = (dirPath: string, depth: number, parentId: string) => {
        const count = (db.prepare("SELECT COUNT(*) as cnt FROM photos WHERE path LIKE ? AND status = 'done'").get(dirPath + "/%") as any).cnt;
        if (count === 0 && depth > 0) return;

        const node = {
          id:       parentId + '_' + dirPath.split('/').pop(),
          path:     dirPath,
          name:     dirPath.split('/').pop(),
          count,
          depth,
          children: [] as any[],
        };

        if (depth < 3) {
          try {
            const fs   = require('fs');
            const path = require('path');
            const items = fs.readdirSync(dirPath);
            for (const name of items) {
              if (name.startsWith('.') || name.startsWith('@')) continue;
              const full = path.join(dirPath, name);
              try {
                if (fs.statSync(full).isDirectory()) {
                  walk(full, depth + 1, node.id);
                }
              } catch(e) {}
            }
          } catch(e) {}
        }

        result.push(node);
      };

      dirs.forEach((d: any) => walk(d.path, 0, String(d.id)));
      res.json(result);
    });

    // 定时派发任务（每30秒）
    setInterval(() => photoUseCase.dispatchPending(), 30000);
    // 超时重置：processing超过10分钟重置为pending
    setInterval(() => {
      const db      = this.db();
      const timeout = Math.floor(Date.now() / 1000) - 600;
      const r       = db.prepare("UPDATE photos SET status='pending' WHERE status='processing' AND updated_at < ?").run(timeout);
      if (r.changes > 0) logger.info(`超时重置 ${r.changes} 张图片`);
    }, 60000);

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
