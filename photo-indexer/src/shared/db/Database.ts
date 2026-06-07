import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

/**
 * 统一SQLite数据库单例
 * 所有服务共用 /data/nas.db
 */
export class Database {

  private static instance: BetterSqlite3.Database | null = null;

  static getInstance(dbPath: string = '/data/nas.db'): BetterSqlite3.Database {
    if (!this.instance) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      this.instance = new BetterSqlite3(dbPath);
      this.instance.pragma('journal_mode = WAL');
      this.instance.pragma('synchronous = NORMAL');
      this.instance.pragma('foreign_keys = ON');
      this.migrate(this.instance);
    }
    return this.instance;
  }

  private static migrate(db: BetterSqlite3.Database): void {
    db.exec(`
      -- 版本控制
      CREATE TABLE IF NOT EXISTS schema_version (
        version     INTEGER PRIMARY KEY,
        applied_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      -- 图片索引
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
        ai_tags      TEXT    NOT NULL DEFAULT '[]',
        user_tags    TEXT    NOT NULL DEFAULT '[]',
        favorite     INTEGER NOT NULL DEFAULT 0,
        status       TEXT    NOT NULL DEFAULT 'pending',
        created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_photos_status    ON photos(status);
      CREATE INDEX IF NOT EXISTS idx_photos_favorite  ON photos(favorite);
      CREATE INDEX IF NOT EXISTS idx_photos_exif_time ON photos(exif_time);
      CREATE INDEX IF NOT EXISTS idx_photos_phash     ON photos(phash);

      -- 标签索引
      CREATE TABLE IF NOT EXISTS tags (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT    NOT NULL UNIQUE,
        count INTEGER NOT NULL DEFAULT 0
      );

      -- 图片监控目录
      CREATE TABLE IF NOT EXISTS photo_watch_dirs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        path       TEXT    NOT NULL UNIQUE,
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      -- 文件同步日志
      CREATE TABLE IF NOT EXISTS sync_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        event      TEXT    NOT NULL,
        path       TEXT    NOT NULL,
        old_path   TEXT,
        size       INTEGER DEFAULT 0,
        synced     INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sync_events_synced ON sync_events(synced);
      CREATE INDEX IF NOT EXISTS idx_sync_events_path   ON sync_events(path);

      -- 文件索引（SHA256）
      CREATE TABLE IF NOT EXISTS file_index (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        path       TEXT    NOT NULL UNIQUE,
        nas_path   TEXT    NOT NULL,
        size       INTEGER NOT NULL DEFAULT 0,
        mtime      INTEGER NOT NULL DEFAULT 0,
        sha256     TEXT,
        status     TEXT    NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_file_index_sha256 ON file_index(sha256);
      CREATE INDEX IF NOT EXISTS idx_file_index_status ON file_index(status);

      -- 同步目录配置
      CREATE TABLE IF NOT EXISTS sync_dirs (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        nas     TEXT    NOT NULL,
        pc      TEXT    NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        mode    TEXT    NOT NULL DEFAULT 'mirror',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      -- 播放列表
      CREATE TABLE IF NOT EXISTS playlists (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        songs      TEXT    NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      -- 音乐设置
      CREATE TABLE IF NOT EXISTS music_settings (
        id          INTEGER PRIMARY KEY DEFAULT 1,
        mode        TEXT    NOT NULL DEFAULT 'shuffle',
        volume      REAL    NOT NULL DEFAULT 0.6,
        auto_play   INTEGER NOT NULL DEFAULT 1,
        playlist_id INTEGER
      );
      INSERT OR IGNORE INTO music_settings (id) VALUES (1);

      -- 文件浏览器根目录
      CREATE TABLE IF NOT EXISTS browser_roots (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        name    TEXT    NOT NULL,
        path    TEXT    NOT NULL UNIQUE,
        source  TEXT    NOT NULL DEFAULT 'nas',
        enabled INTEGER NOT NULL DEFAULT 1
      );

      -- 默认NAS根目录
    `);
  }
}
