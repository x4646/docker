import { ILogRepository } from '../domain/repositories/ILogRepository';
import { SyncLog, LogEvent, LogStatus } from '../domain/entities/SyncLog';

/**
 * 日志用例
 */
export class LogUseCase {

  constructor(private readonly logRepo: ILogRepository) {}

  async getLogs(filter?: { event?: LogEvent; status?: LogStatus; q?: string }): Promise<SyncLog[]> {
    return this.logRepo.findAll(filter);
  }

  async addLog(event: LogEvent, filePath: string, oldPath?: string, size?: number): Promise<SyncLog> {
    const log = new SyncLog(
      String(Date.now()),
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
