import { ISyncDirRepository } from '../domain/repositories/ISyncDirRepository';
import { ILogRepository } from '../domain/repositories/ILogRepository';
import { FilterRule } from '../domain/valueObjects/FilterRule';
import { ILogger } from '../domain/shared/ILogger';

/**
 * 同步用例
 * 触发同步，通过WebSocket推送任务给电脑
 */
export class SyncUseCase {

  constructor(
    private readonly dirRepo:  ISyncDirRepository,
    private readonly logRepo:  ILogRepository,
    private readonly filter:   FilterRule,
    private readonly logger:   ILogger,
    private readonly pipeUrl:  string, // nas-pipe地址
  ) {}

  /**
   * 触发同步
   * 把pending的变更推送给电脑
   */
  async startSync(): Promise<{ sent: number; skipped: number }> {
    const http    = require('http');
    const pending = await this.logRepo.findAll({ status: 'pending' });

    let sent    = 0;
    let skipped = 0;

    for (const log of pending) {
      // 过滤规则检查
      if (this.filter.shouldExclude(log.path, log.size)) {
        log.status = 'excluded';
        await this.logRepo.save(log);
        skipped++;
        continue;
      }

      // 找到对应的同步目录
      const dirs   = await this.dirRepo.findAll();
      const srcDir = dirs.find(d => d.enabled && log.path.startsWith(d.nas));
      if (!srcDir) { skipped++; continue; }

      // 发送任务给电脑（通过nas-pipe）
      try {
        await this.sendTask({
          task_id:  log.id,
          type:     'sync',
          event:    log.event,
          path:     log.path,
          oldPath:  log.oldPath,
          nasPath:  srcDir.nas,
          pcPath:   srcDir.pc,
        });
        sent++;
      } catch(e: any) {
        this.logger.error('发送任务失败', { error: e.message });
        skipped++;
      }
    }

    return { sent, skipped };
  }

  private sendTask(task: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const http = require('http');
      const body = Buffer.from(JSON.stringify(task));
      const url  = new URL(this.pipeUrl + '/api/task');
      const req  = http.request({
        hostname: url.hostname,
        port:     parseInt(url.port),
        path:     url.pathname,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': body.length },
      }, (res: any) => {
        let data = '';
        res.on('data', (c: any) => data += c);
        res.on('end', () => resolve());
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
