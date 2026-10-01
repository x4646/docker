import BetterSqlite3 from 'better-sqlite3';
import { Database } from './Database';

/**
 * 通用仓储基类
 * 所有仓储继承此类，减少重复代码
 */
export abstract class BaseRepository<T> {

  protected readonly db: BetterSqlite3.Database;

  constructor(
    protected readonly tableName: string,
    dbPath: string = '/data/nas.db',
  ) {
    this.db = Database.getInstance(dbPath);
  }

  // ── 基础CRUD ──────────────────────────────────────────
  findById(id: number): T | null {
    const row = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`).get(id);
    return row ? this.fromRow(row) : null;
  }

  findAll(where?: string, params?: any[]): T[] {
    const sql  = where ? `SELECT * FROM ${this.tableName} WHERE ${where}` : `SELECT * FROM ${this.tableName}`;
    const rows = params ? this.db.prepare(sql).all(...params) : this.db.prepare(sql).all();
    return rows.map(r => this.fromRow(r));
  }

  count(where?: string, params?: any[]): number {
    const sql  = where ? `SELECT COUNT(*) as cnt FROM ${this.tableName} WHERE ${where}` : `SELECT COUNT(*) as cnt FROM ${this.tableName}`;
    const row  = params ? this.db.prepare(sql).get(...params) : this.db.prepare(sql).get();
    return (row as any).cnt;
  }

  deleteById(id: number): void {
    this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);
  }

  deleteWhere(where: string, params: any[]): void {
    this.db.prepare(`DELETE FROM ${this.tableName} WHERE ${where}`).run(...params);
  }

  // ── 事务 ──────────────────────────────────────────────
  transaction<R>(fn: () => R): R {
    return this.db.transaction(fn)();
  }

  // ── 子类必须实现 ──────────────────────────────────────
  protected abstract fromRow(row: any): T;
}
