import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

/**
 * SQLite数据库单例
 * 管理数据库连接和表结构初始化
 */
export class Db {

  private static instance: Database.Database | null = null;

  static getInstance(dbPath: string): Database.Database {
    if (!this.instance) {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      this.instance = new Database(dbPath);
      this.instance.pragma('journal_mode = WAL');  // 写性能优化
      this.instance.pragma('synchronous = NORMAL'); // 平衡安全和性能
      this.migrate(this.instance);
    }
    return this.instance;
  }

  /**
   * 数据库迁移
   * 创建所有表结构
   */
  private static migrate(db: Database.Database): void {
    db.exec(`
      -- 文件索引表
      CREATE TABLE IF NOT EXISTS files (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        path        TEXT    NOT NULL UNIQUE,  -- 相对路径
        nas_path    TEXT    NOT NULL,         -- NAS绝对路径
        size        INTEGER NOT NULL DEFAULT 0,
        mtime       INTEGER NOT NULL DEFAULT 0,
        sha256      TEXT,                     -- 后台计算，可为空
        status      TEXT    NOT NULL DEFAULT 'pending',  -- pending/hashed/deleted
        created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      CREATE INDEX IF NOT EXISTS idx_files_status  ON files(status);
      CREATE INDEX IF NOT EXISTS idx_files_sha256  ON files(sha256);
      CREATE INDEX IF NOT EXISTS idx_files_nas_path ON files(nas_path);

      -- 变更事件表
      CREATE TABLE IF NOT EXISTS events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        event       TEXT    NOT NULL,  -- create/modify/move/delete
        path        TEXT    NOT NULL,
        old_path    TEXT,              -- move时的旧路径
        size        INTEGER DEFAULT 0,
        synced      INTEGER NOT NULL DEFAULT 0,  -- 0未同步 1已同步
        created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      CREATE INDEX IF NOT EXISTS idx_events_synced ON events(synced);
      CREATE INDEX IF NOT EXISTS idx_events_path   ON events(path);
    `);
  }
}
