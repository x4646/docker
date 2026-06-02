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
    this.app.use(express.static(path.join(__dirname, '../../../public')));
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
      const filePath = '/' + (req.params as any)[0];
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

    // 定时派发任务（每30秒）
    setInterval(() => photoUseCase.dispatchPending(), 30000);

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
