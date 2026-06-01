import express from 'express';
import path from 'path';
import fs from 'fs';
import { ConsoleLogger } from '../infrastructure/logger/ConsoleLogger';
import { JsonSyncDirRepository } from '../infrastructure/repositories/JsonSyncDirRepository';
import { SqliteLogRepository } from '../infrastructure/repositories/SqliteLogRepository';
import { SqliteFileRepository } from '../infrastructure/repositories/SqliteFileRepository';
import { HashWorker } from '../infrastructure/hash/HashWorker';
import { ConfigUseCase } from '../application/ConfigUseCase';
import { LogUseCase } from '../application/LogUseCase';
import { SyncUseCase } from '../application/SyncUseCase';
import { ConfigController } from '../interfaces/http/ConfigController';
import { LogController } from '../interfaces/http/LogController';
import { SyncController } from '../interfaces/http/SyncController';
import { FilterRule } from '../domain/valueObjects/FilterRule';

export class Container {

  private readonly app = express();

  constructor(private readonly config: any) {}

  build(): this {
    const logger     = new ConsoleLogger();
    const configPath = this.config.CONFIG_PATH;
    const dbPath     = this.config.DB_PATH;

    // ── 仓储层 ────────────────────────────────────────
    const dirRepo  = new JsonSyncDirRepository(configPath);
    const logRepo  = new SqliteLogRepository(dbPath);
    const fileRepo = new SqliteFileRepository(dbPath);

    // ── 后台Worker ────────────────────────────────────
    const hashWorker = new HashWorker(fileRepo, logger);
    hashWorker.start();

    // ── 过滤规则 ──────────────────────────────────────
    const filterRule = this.loadFilter(configPath);

    // ── 用例层 ────────────────────────────────────────
    const configUseCase = new ConfigUseCase(dirRepo, configPath);
    const logUseCase    = new LogUseCase(logRepo);
    const syncUseCase   = new SyncUseCase(
      dirRepo, logRepo, filterRule, logger, this.config.PIPE_URL
    );

    // ── 路由 ──────────────────────────────────────────
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../../../public')));

    const configCtrl = new ConfigController(configUseCase);
    const logCtrl    = new LogController(logUseCase);
    const syncCtrl   = new SyncController(syncUseCase, logUseCase, logger, this.config.PIPE_URL, dirRepo, configPath);

    this.app.use('/api/config', configCtrl.router);
    this.app.use('/api/log',    logCtrl.router);
    this.app.use('/api/sync',   syncCtrl.router);

    // inotify事件接口
    this.app.post('/api/event', async (req, res) => {
      const { event, path: filePath, oldPath, size } = req.body;
      await logUseCase.addLog(event, filePath, oldPath, size);

      // 同时更新文件索引
      if (event === 'delete') {
        fileRepo.markDeleted(filePath);
      } else {
        fileRepo.upsert({
          path:     filePath,
          nas_path: filePath,
          size:     size || 0,
          mtime:    Math.floor(Date.now() / 1000),
          sha256:   undefined,
          status:   'pending',
        });
      }
      res.json({ ok: true });
    });

    // 文件索引API
    this.app.get('/api/files', (req, res) => {
      const { nasPath } = req.query as any;
      const files = fileRepo.findAll(nasPath);
      res.json({ count: files.length, files });
    });

    this.app.get('/api/files/stats', (req, res) => {
      const total   = fileRepo.count();
      const pending = fileRepo.findPendingHash(9999).length;
      res.json({ total, pending, hashed: total - pending });
    });

    // PC文件索引上报接口
    this.app.post('/api/pc-files', (req, res) => {
      const { files, pc_path } = req.body;
      if (!Array.isArray(files)) return res.json({ ok: false, error: '缺少files' });
      let updated = 0;
      for (const f of files) {
        if (!f.path || !f.sha256) continue;
        fileRepo.upsert({
          path:     pc_path + '/' + f.path,
          nas_path: pc_path + '/' + f.path,
          size:     f.size || 0,
          mtime:    f.mtime || 0,
          sha256:   f.sha256,
          status:   'hashed',
        });
        updated++;
      }
      res.json({ ok: true, updated });
    });

    logger.info('NAS Sync容器构建完成');
    return this;
  }

  private loadFilter(configPath: string): FilterRule {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return FilterRule.fromJSON(data.filters || {});
    } catch(e) {
      return FilterRule.fromJSON({});
    }
  }

  start(port: number): void {
    this.app.listen(port, '0.0.0.0', () => {
      console.log(`NAS Sync running on port ${port}`);
    });
  }

  getApp() { return this.app; }
}
