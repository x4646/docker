import Database from 'better-sqlite3';
import { Db } from '../db/Database';

export interface FileRecord {
  id?:         number;
  path:        string;   // 相对路径
  nas_path:    string;   // NAS绝对路径
  size:        number;
  mtime:       number;
  sha256?:     string;
  status:      'pending' | 'hashed' | 'deleted';
  created_at?: number;
  updated_at?: number;
}

/**
 * SQLite文件索引仓储
 * 存储NAS文件的元数据和SHA256
 */
export class SqliteFileRepository {

  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = Db.getInstance(dbPath);
  }

  // ── 写入/更新 ──────────────────────────────────────────
  upsert(file: FileRecord): void {
    this.db.prepare(`
      INSERT INTO files (path, nas_path, size, mtime, sha256, status, updated_at)
      VALUES (@path, @nas_path, @size, @mtime, @sha256, @status, strftime('%s','now'))
      ON CONFLICT(path) DO UPDATE SET
        nas_path   = excluded.nas_path,
        size       = excluded.size,
        mtime      = excluded.mtime,
        sha256     = CASE WHEN excluded.sha256 IS NOT NULL THEN excluded.sha256 ELSE sha256 END,
        status     = excluded.status,
        updated_at = strftime('%s','now')
    `).run(file);
  }

  updateSha256(path: string, sha256: string): void {
    this.db.prepare(`
      UPDATE files SET sha256 = ?, status = 'hashed', updated_at = strftime('%s','now')
      WHERE path = ?
    `).run(sha256, path);
  }

  markDeleted(path: string): void {
    this.db.prepare(`
      UPDATE files SET status = 'deleted', updated_at = strftime('%s','now')
      WHERE path = ?
    `).run(path);
  }

  // ── 查询 ──────────────────────────────────────────────
  findByPath(path: string): FileRecord | null {
    return this.db.prepare('SELECT * FROM files WHERE path = ?').get(path) as FileRecord || null;
  }

  findPendingHash(limit = 10): FileRecord[] {
    return this.db.prepare(`
      SELECT * FROM files WHERE status = 'pending' AND status != 'deleted'
      ORDER BY updated_at ASC LIMIT ?
    `).all(limit) as FileRecord[];
  }

  findAll(nasPath?: string): FileRecord[] {
    if (nasPath) {
      return this.db.prepare(`
        SELECT * FROM files WHERE nas_path LIKE ? AND status != 'deleted'
      `).all(nasPath + '%') as FileRecord[];
    }
    return this.db.prepare(`
      SELECT * FROM files WHERE status != 'deleted'
    `).all() as FileRecord[];
  }

  findBySha256(sha256: string): FileRecord[] {
    return this.db.prepare(`
      SELECT * FROM files WHERE sha256 = ? AND status != 'deleted'
    `).all(sha256) as FileRecord[];
  }

  count(nasPath?: string): number {
    if (nasPath) {
      return (this.db.prepare(`
        SELECT COUNT(*) as cnt FROM files WHERE nas_path LIKE ? AND status != 'deleted'
      `).get(nasPath + '%') as any).cnt;
    }
    return (this.db.prepare(`
      SELECT COUNT(*) as cnt FROM files WHERE status != 'deleted'
    `).get() as any).cnt;
  }
}
