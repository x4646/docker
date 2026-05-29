import crypto from 'crypto';
import fs from 'fs';
import { SqliteFileRepository } from '../repositories/SqliteFileRepository';
import { ILogger } from '../../domain/shared/ILogger';

/**
 * SHA256后台计算Worker
 * 空闲时批量计算pending文件的SHA256
 */
export class HashWorker {

  private running  = false;
  private timer:   NodeJS.Timeout | null = null;
  private readonly BATCH    = 5;
  private readonly INTERVAL = 10000;

  constructor(
    private readonly fileRepo: SqliteFileRepository,
    private readonly logger:   ILogger,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer   = setInterval(() => this.processBatch(), this.INTERVAL);
    this.logger.info('SHA256 HashWorker已启动');
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
  }

  private async processBatch(): Promise<void> {
    const files = this.fileRepo.findPendingHash(this.BATCH);
    if (!files.length) return;

    for (const file of files) {
      try {
        const sha256 = await this.calcSha256(file.nas_path);
        this.fileRepo.updateSha256(file.path, sha256);
        this.logger.debug('SHA256计算完成', { path: file.path });
      } catch(e: any) {
        this.logger.warn('SHA256计算失败', { path: file.path, error: e.message });
      }
    }
  }

  private calcSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(filePath)) return reject(new Error('文件不存在'));
      const hash   = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data',  chunk => hash.update(chunk));
      stream.on('end',   ()    => resolve(hash.digest('hex')));
      stream.on('error', err   => reject(err));
    });
  }

  calcSha256Sync(filePath: string): string | null {
    try {
      const hash = crypto.createHash('sha256');
      const data = fs.readFileSync(filePath);
      hash.update(data);
      return hash.digest('hex');
    } catch(e) {
      return null;
    }
  }
}
