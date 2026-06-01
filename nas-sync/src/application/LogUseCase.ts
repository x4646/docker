import { ILogRepository } from '../domain/repositories/ILogRepository';
import { SyncLog, LogEvent, LogStatus } from '../domain/entities/SyncLog';

export class LogUseCase {

  // 去重缓存：key=event+path，value=时间戳
  private readonly dedupeCache = new Map<string, number>();
  private readonly DEDUPE_TTL  = 2000; // 5秒内相同事件去重

  constructor(private readonly logRepo: ILogRepository) {}

  async getLogs(filter?: { event?: LogEvent; status?: LogStatus; q?: string }): Promise<SyncLog[]> {
    return this.logRepo.findAll(filter);
  }

  async addLog(event: LogEvent, filePath: string, oldPath?: string, size?: number): Promise<SyncLog | null> {
    // 去重检查
    const key  = `${event}:${filePath}`;
    const last = this.dedupeCache.get(key);
    const now  = Date.now();

    if (last && (now - last) < this.DEDUPE_TTL) {
      return null; // 忽略重复事件
    }
    this.dedupeCache.set(key, now);

    // 定期清理缓存
    if (this.dedupeCache.size > 1000) {
      const expire = now - this.DEDUPE_TTL;
      this.dedupeCache.forEach((t, k) => { if (t < expire) this.dedupeCache.delete(k); });
    }

    const log = new SyncLog(
      String(now),
      event,
      filePath,
      oldPath || null,
      size    || 0,
      'pending',
      new Date(),
    );
    await this.logRepo.save(log);
    return log;
  }

  async updateStatus(id: string, status: LogStatus): Promise<void> {
    const logs = await this.logRepo.findAll();
    const log  = logs.find(l => l.id === id);
    if (!log) return;
    log.status = status;
    await this.logRepo.save(log);
  }

  async clearLogs(): Promise<void> {
    await this.logRepo.clear();
  }

  async getPendingCount(): Promise<number> {
    return this.logRepo.countPending();
  }
}
