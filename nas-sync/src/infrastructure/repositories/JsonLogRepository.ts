import fs from 'fs';
import path from 'path';
import { ILogRepository } from '../../domain/repositories/ILogRepository';
import { SyncLog, LogEvent, LogStatus } from '../../domain/entities/SyncLog';

const MAX_LOGS = 1000;

/**
 * JSON文件实现的日志仓储
 */
export class JsonLogRepository implements ILogRepository {

  constructor(private readonly filePath: string) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private read(): SyncLog[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8')).map(SyncLog.fromJSON);
    } catch(e) { return []; }
  }

  private write(logs: SyncLog[]): void {
    // 只保留最新的MAX_LOGS条
    const trimmed = logs.slice(-MAX_LOGS);
    fs.writeFileSync(this.filePath, JSON.stringify(trimmed.map(l => l.toJSON()), null, 2));
  }

  async findAll(filter?: { event?: LogEvent; status?: LogStatus; q?: string }): Promise<SyncLog[]> {
    let logs = this.read().reverse(); // 最新的在前

    if (filter?.event)  logs = logs.filter(l => l.event === filter.event);
    if (filter?.status) logs = logs.filter(l => l.status === filter.status);
    if (filter?.q)      logs = logs.filter(l => l.path.includes(filter.q!));

    return logs.slice(0, 200);
  }

  async save(log: SyncLog): Promise<void> {
    const logs = this.read();
    const idx  = logs.findIndex(l => l.id === log.id);
    if (idx >= 0) logs[idx] = log;
    else logs.push(log);
    this.write(logs);
  }

  async clear(): Promise<void> {
    this.write([]);
  }

  async countPending(): Promise<number> {
    return this.read().filter(l => l.status === 'pending').length;
  }
}
