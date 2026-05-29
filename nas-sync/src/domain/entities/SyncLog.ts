/**
 * 同步日志实体
 * 记录文件变更事件
 */
export type LogEvent = 'create' | 'modify' | 'move' | 'delete';
export type LogStatus = 'pending' | 'synced' | 'failed' | 'excluded';

export class SyncLog {
  constructor(
    public readonly id:       string,
    public readonly event:    LogEvent,
    public readonly path:     string,
    public readonly oldPath:  string | null, // move时的旧路径
    public readonly size:     number,
    public status:            LogStatus,
    public readonly time:     Date,
  ) {}

  markSynced():   void { this.status = 'synced'; }
  markFailed():   void { this.status = 'failed'; }
  markExcluded(): void { this.status = 'excluded'; }

  toJSON() {
    return {
      id:      this.id,
      event:   this.event,
      path:    this.path,
      oldPath: this.oldPath,
      size:    this.size,
      status:  this.status,
      time:    this.time.toISOString(),
    };
  }

  static fromJSON(data: any): SyncLog {
    return new SyncLog(
      data.id,
      data.event,
      data.path,
      data.oldPath || null,
      data.size    || 0,
      data.status  || 'pending',
      new Date(data.time),
    );
  }
}
