import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export class PhotoDb {

  private static instance: Database.Database | null = null;

  static getInstance(dbPath: string): Database.Database {
    if (!this.instance) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      this.instance = new Database(dbPath);
      this.instance.pragma('journal_mode = WAL');
      this.instance.pragma('synchronous = NORMAL');
      this.migrate(this.instance);
    }
    return this.instance;
  }

  private static migrate(db: Database.Database): void {
    db.exec(`
      -- 图片表
      CREATE TABLE IF NOT EXISTS photos (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        path         TEXT    NOT NULL UNIQUE,
        thumb_path   TEXT,
        preview_path TEXT,
        size         INTEGER NOT NULL DEFAULT 0,
        mtime        INTEGER NOT NULL DEFAULT 0,
        md5          TEXT,
        width        INTEGER,
        height       INTEGER,
        exif_time    INTEGER,
        exif_camera  TEXT,
        exif_gps     TEXT,
        phash        TEXT,
        ai_desc      TEXT,
        ai_tags      TEXT,
        user_tags    TEXT    DEFAULT '[]',
        favorite     INTEGER NOT NULL DEFAULT 0,
        status       TEXT    NOT NULL DEFAULT 'pending',
        created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      CREATE INDEX IF NOT EXISTS idx_photos_status   ON photos(status);
      CREATE INDEX IF NOT EXISTS idx_photos_favorite ON photos(favorite);
      CREATE INDEX IF NOT EXISTS idx_photos_exif_time ON photos(exif_time);
      CREATE INDEX IF NOT EXISTS idx_photos_phash    ON photos(phash);

      -- 标签索引表
      CREATE TABLE IF NOT EXISTS tags (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT    NOT NULL UNIQUE,
        count INTEGER NOT NULL DEFAULT 0
      );

      -- 监控目录表
      CREATE TABLE IF NOT EXISTS watch_dirs (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        path    TEXT    NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      -- 播放列表表
      CREATE TABLE IF NOT EXISTS playlists (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        songs      TEXT    NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      -- 音乐设置表
      CREATE TABLE IF NOT EXISTS music_settings (
        id           INTEGER PRIMARY KEY DEFAULT 1,
        mode         TEXT    NOT NULL DEFAULT 'shuffle',
        volume       REAL    NOT NULL DEFAULT 0.6,
        auto_play    INTEGER NOT NULL DEFAULT 1,
        playlist_id  INTEGER
      );

      INSERT OR IGNORE INTO music_settings (id) VALUES (1);
    `);
  }
}
