import { SyncLog, LogEvent, LogStatus } from '../entities/SyncLog';

/**
 * 日志仓储接口
 */
export interface ILogRepository {
  findAll(filter?: { event?: LogEvent; status?: LogStatus; q?: string }): Promise<SyncLog[]>;
  save(log: SyncLog): Promise<void>;
  clear(): Promise<void>;
  countPending(): Promise<number>;
}
