import Database from 'better-sqlite3';
import { Db } from '../db/Database';
import { ILogRepository } from '../../domain/repositories/ILogRepository';
import { SyncLog, LogEvent, LogStatus } from '../../domain/entities/SyncLog';

/**
 * SQLite实现的日志仓储
 * 替换JsonLogRepository
 */
export class SqliteLogRepository implements ILogRepository {

  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = Db.getInstance(dbPath);
  }

  async findAll(filter?: { event?: LogEvent; status?: LogStatus; q?: string }): Promise<SyncLog[]> {
    let sql    = 'SELECT * FROM events WHERE 1=1';
    const args: any[] = [];

    if (filter?.event) {
      sql += ' AND event = ?';
      args.push(filter.event);
    }
    if (filter?.status) {
      // status映射：pending=未同步，synced=已同步
      sql += ' AND synced = ?';
      args.push(filter.status === 'synced' ? 1 : 0);
    }
    if (filter?.q) {
      sql += ' AND path LIKE ?';
      args.push('%' + filter.q + '%');
    }

    sql += ' ORDER BY created_at DESC LIMIT 200';

    const rows = this.db.prepare(sql).all(...args) as any[];
    return rows.map(this.rowToLog);
  }

  async save(log: SyncLog): Promise<void> {
    const existing = this.db.prepare('SELECT id FROM events WHERE id = ?').get(log.id);
    if (existing) {
      this.db.prepare(`
        UPDATE events SET synced = ? WHERE id = ?
      `).run(log.status === 'synced' ? 1 : 0, log.id);
    } else {
      this.db.prepare(`
        INSERT INTO events (id, event, path, old_path, size, synced, created_at)
        VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'))
      `).run(
        log.id,
        log.event,
        log.path,
        log.oldPath,
        log.size,
        log.status === 'synced' ? 1 : 0,
      );
    }
  }

  async clear(): Promise<void> {
    this.db.prepare('DELETE FROM events').run();
  }

  async countPending(): Promise<number> {
    return (this.db.prepare('SELECT COUNT(*) as cnt FROM events WHERE synced = 0').get() as any).cnt;
  }

  private rowToLog(row: any): SyncLog {
    return new SyncLog(
      String(row.id),
      row.event as LogEvent,
      row.path,
      row.old_path || null,
      row.size     || 0,
      row.synced   ? 'synced' : 'pending',
      new Date(row.created_at * 1000),
    );
  }
}
