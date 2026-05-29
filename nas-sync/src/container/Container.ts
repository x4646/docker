import express from 'express';
import path from 'path';
import { ConsoleLogger } from '../infrastructure/logger/ConsoleLogger';
import { JsonSyncDirRepository } from '../infrastructure/repositories/JsonSyncDirRepository';
import { JsonLogRepository } from '../infrastructure/repositories/JsonLogRepository';
import { ConfigUseCase } from '../application/ConfigUseCase';
import { LogUseCase } from '../application/LogUseCase';
import { SyncUseCase } from '../application/SyncUseCase';
import { ConfigController } from '../interfaces/http/ConfigController';
import { LogController } from '../interfaces/http/LogController';
import { SyncController } from '../interfaces/http/SyncController';
import { FilterRule } from '../domain/valueObjects/FilterRule';
import fs from 'fs';

export class Container {

  private readonly app = express();

  constructor(private readonly config: any) {}

  build(): this {
    const logger     = new ConsoleLogger();
    const configPath = this.config.CONFIG_PATH;

    // ── 仓储层 ────────────────────────────────────────
    const dirRepo = new JsonSyncDirRepository(configPath);
    const logRepo = new JsonLogRepository(this.config.LOG_PATH);

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
    const syncCtrl   = new SyncController(syncUseCase, logUseCase, logger, this.config.PIPE_URL, dirRepo);

    this.app.use('/api/config', configCtrl.router);
    this.app.use('/api/log',    logCtrl.router);
    this.app.use('/api/sync',   syncCtrl.router);

    // inotify推送变更日志接口
    this.app.post('/api/event', async (req, res) => {
      const { event, path: filePath, oldPath, size } = req.body;
      await logUseCase.addLog(event, filePath, oldPath, size);
      res.json({ ok: true });
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
