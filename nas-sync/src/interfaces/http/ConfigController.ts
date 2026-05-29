import { Router, Request, Response } from 'express';
import { ConfigUseCase } from '../../application/ConfigUseCase';
import { SyncMode } from '../../domain/entities/SyncDir';

export class ConfigController {

  readonly router = Router();

  constructor(private readonly useCase: ConfigUseCase) {
    this.router.get('/dirs',              this.getDirs.bind(this));
    this.router.post('/dirs',             this.addDir.bind(this));
    this.router.put('/dirs/:id',          this.updateDir.bind(this));
    this.router.delete('/dirs/:id',       this.deleteDir.bind(this));
    this.router.patch('/dirs/:id/toggle', this.toggleDir.bind(this));
    this.router.get('/filters',           this.getFilter.bind(this));
    this.router.post('/filters',          this.saveFilter.bind(this));
  }

  private async getDirs(req: Request, res: Response) {
    const dirs = await this.useCase.getDirs();
    res.json(dirs.map(d => d.toJSON()));
  }

  private async addDir(req: Request, res: Response) {
    const { nas, pc, mode } = req.body;
    if (!nas || !pc) return res.status(400).json({ error: '缺少nas或pc路径' });
    const dir = await this.useCase.addDir(nas, pc, mode as SyncMode);
    res.json(dir.toJSON());
  }

  private async updateDir(req: Request, res: Response) {
    const { nas, pc, enabled, mode } = req.body;
    const dir = await this.useCase.updateDir(req.params.id, nas, pc, enabled, mode as SyncMode);
    if (!dir) return res.status(404).json({ error: '目录不存在' });
    res.json(dir.toJSON());
  }

  private async deleteDir(req: Request, res: Response) {
    await this.useCase.deleteDir(req.params.id);
    res.json({ ok: true });
  }

  private async toggleDir(req: Request, res: Response) {
    const dir = await this.useCase.toggleDir(req.params.id);
    if (!dir) return res.status(404).json({ error: '目录不存在' });
    res.json(dir.toJSON());
  }

  private async getFilter(req: Request, res: Response) {
    res.json(this.useCase.getFilter().toJSON());
  }

  private async saveFilter(req: Request, res: Response) {
    this.useCase.saveFilter(req.body);
    res.json({ ok: true });
  }
}
