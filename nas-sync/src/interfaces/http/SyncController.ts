import { Router, Request, Response } from 'express';
import { SyncUseCase } from '../../application/SyncUseCase';
import { LogUseCase } from '../../application/LogUseCase';
import { ILogger } from '../../domain/shared/ILogger';
import { ISyncDirRepository } from '../../domain/repositories/ISyncDirRepository';
import http from 'http';
import fs from 'fs';
import path from 'path';

export class SyncController {

  readonly router = Router();

  constructor(
    private readonly syncUseCase: SyncUseCase,
    private readonly logUseCase:  LogUseCase,
    private readonly logger:      ILogger,
    private readonly pipeUrl:     string,
    private readonly dirRepo:     ISyncDirRepository,
  ) {
    this.router.get('/status',          this.getStatus.bind(this));
    this.router.post('/start',          this.startSync.bind(this));
    this.router.post('/result',         this.handleResult.bind(this));
    this.router.get('/diff/:id',        this.getDiff.bind(this));
    this.router.post('/sync-diff/:id',  this.syncFromDiff.bind(this));
  }

  private async getStatus(req: Request, res: Response) {
    const pending = await this.logUseCase.getPendingCount();
    try {
      const status = await this.fetchPipeStatus();
      res.json({ ...status, pendingCount: pending });
    } catch(e) {
      res.json({ online: false, pendingCount: pending });
    }
  }

  private async startSync(req: Request, res: Response) {
    this.logger.info('手动触发同步');
    const result = await this.syncUseCase.startSync();
    res.json(result);
  }

  private async handleResult(req: Request, res: Response) {
    const { task_id, status } = req.body;
    if (task_id && status) await this.logUseCase.updateStatus(task_id, status);
    res.json({ ok: true });
  }

  // ── 差异对比 ──────────────────────────────────────────
  private async getDiff(req: Request, res: Response) {
    const dir = await this.dirRepo.findById(req.params.id);
    if (!dir) return res.status(404).json({ error: '目录不存在' });

    try {
      const scanResult = await this.postJson(`${this.pipeUrl}/api/scan`, { pc_path: dir.pc });
      if (!scanResult.ok) return res.json({ ok: false, error: scanResult.error });

      const nasFiles = this.scanNas(dir.nas);
      const pcMap    = new Map<string, any>(scanResult.files.map((f: any) => [f.path, f]));
      const nasMap   = new Map<string, any>(nasFiles.map((f: any) => [f.path, f]));

      const toSync:   any[] = [];
      const toDelete: any[] = [];
      const updated:  any[] = [];

      nasMap.forEach((nasFile, p) => {
        const pcFile = pcMap.get(p);
        if (!pcFile) toSync.push({ path: p, size: nasFile.size });
        else if (nasFile.mtime > pcFile.mtime) updated.push({ path: p, size: nasFile.size });
      });

      pcMap.forEach((_, p) => {
        if (!nasMap.has(p)) toDelete.push({ path: p });
      });

      res.json({
        ok: true, toSync, updated, toDelete,
        summary: { toSync: toSync.length, updated: updated.length, toDelete: toDelete.length }
      });

    } catch(e: any) {
      res.json({ ok: false, error: e.message });
    }
  }

  // ── 基于差异直接同步 ──────────────────────────────────
  private async syncFromDiff(req: Request, res: Response) {
    const dir = await this.dirRepo.findById(req.params.id);
    if (!dir) return res.status(404).json({ error: '目录不存在' });

    try {
      const scanResult = await this.postJson(`${this.pipeUrl}/api/scan`, { pc_path: dir.pc });
      if (!scanResult.ok) return res.json({ ok: false, error: scanResult.error });

      const nasFiles = this.scanNas(dir.nas);
      const pcMap    = new Map<string, any>(scanResult.files.map((f: any) => [f.path, f]));
      const nasMap   = new Map<string, any>(nasFiles.map((f: any) => [f.path, f]));

      const tasks: any[] = [];

      // NAS有PC没有，或NAS更新 → 同步
      nasMap.forEach((nasFile, p) => {
        const pcFile = pcMap.get(p);
        if (!pcFile || nasFile.mtime > pcFile.mtime) {
          tasks.push({
            task_id: String(Date.now() + Math.random()),
            type:    'sync',
            event:   pcFile ? 'modify' : 'create',
            path:    dir.nas + '/' + p,
            nasPath: dir.nas,
            pcPath:  dir.pc,
            mode:    dir.mode,
          });
        }
      });

      // PC有NAS没有，mirror模式下删除
      if (dir.mode === 'mirror') {
        pcMap.forEach((_, p) => {
          if (!nasMap.has(p)) {
            tasks.push({
              task_id: String(Date.now() + Math.random()),
              type:    'sync',
              event:   'delete',
              path:    dir.nas + '/' + p,
              nasPath: dir.nas,
              pcPath:  dir.pc,
              mode:    dir.mode,
            });
          }
        });
      }

      // 发送所有任务
      let sent = 0;
      for (const task of tasks) {
        try {
          await this.postJson(`${this.pipeUrl}/api/task`, task);
          sent++;
        } catch(e) {}
      }

      this.logger.info('差异同步完成', { sent, total: tasks.length });
      res.json({ ok: true, sent, total: tasks.length });

    } catch(e: any) {
      res.json({ ok: false, error: e.message });
    }
  }

  private scanNas(nasPath: string): any[] {
    const files: any[] = [];
    const walk = (dir: string) => {
      try {
        fs.readdirSync(dir).forEach((name: string) => {
          const full = path.join(dir, name);
          try {
            const stat = fs.statSync(full);
            if (stat.isDirectory()) walk(full);
            else {
              const rel = path.relative(nasPath, full).replace(/\\/g, '/');
              files.push({ path: rel, size: stat.size, mtime: Math.floor(stat.mtimeMs / 1000) });
            }
          } catch(e) {}
        });
      } catch(e) {}
    };
    walk(nasPath);
    return files;
  }

  private postJson(url: string, body: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const data = Buffer.from(JSON.stringify(body));
      const u    = new URL(url);
      const req  = http.request({
        hostname: u.hostname,
        port:     parseInt(u.port),
        path:     u.pathname,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': data.length },
      }, (r: any) => {
        let d = '';
        r.on('data', (c: any) => d += c);
        r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  private fetchPipeStatus(): Promise<any> {
    return new Promise((resolve, reject) => {
      http.get(`${this.pipeUrl}/api/status`, (r) => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      }).on('error', reject);
    });
  }
}
