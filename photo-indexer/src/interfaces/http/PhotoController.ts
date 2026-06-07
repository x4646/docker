import { Router, Request, Response } from 'express';
import { PhotoUseCase } from '../../application/PhotoUseCase';

export class PhotoController {

  readonly router = Router();

  constructor(private readonly useCase: PhotoUseCase) {
    this.router.get('/stats',              this.getStats.bind(this));
    this.router.get('/',                   this.getPhotos.bind(this));
    this.router.get('/:id',                this.getPhoto.bind(this));
    this.router.post('/result',            this.receiveResult.bind(this));
    this.router.post('/dispatch',          this.dispatch.bind(this));
    this.router.put('/:id/tags',           this.updateTags.bind(this));
    this.router.post('/:id/favorite',      this.toggleFavorite.bind(this));
    this.router.get('/tags/all',           this.getTags.bind(this));
    this.router.post('/scan',              this.scan.bind(this));
    this.router.post('/scan',              this.scan.bind(this));
  }

  private async getStats(req: Request, res: Response) {
    res.json(this.useCase.getStats());
  }

  private async getPhotos(req: Request, res: Response) {
    const { page, limit, status, favorite, tags, q, dateFrom, dateTo, dirPath, year, month } = req.query as any;
    const result = this.useCase.getPhotos({
      page:     parseInt(page)  || 1,
      limit:    parseInt(limit) || 50,
      status,
      favorite: favorite === 'true',
      tags:     tags ? tags.split(',') : undefined,
      q,
      dateFrom: dateFrom ? parseInt(dateFrom) : undefined,
      dateTo:   dateTo   ? parseInt(dateTo)   : undefined,
      dirPath:  dirPath  || undefined,
      year:     year     ? parseInt(year)     : undefined,
      month:    month    ? parseInt(month)    : undefined,
    });
    res.json(result);
  }

  private async getPhoto(req: Request, res: Response) {
    const photo = this.useCase.getPhoto(parseInt(req.params.id));
    if (!photo) return res.status(404).json({ error: 'not found' });
    res.json(photo.toJSON());
  }

  private async receiveResult(req: Request, res: Response) {
    const { path, ...data } = req.body;
    if (!path) return res.status(400).json({ error: '缺少path' });
    this.useCase.receiveResult(path, data);
    res.json({ ok: true });
  }

  private async dispatch(req: Request, res: Response) {
    const sent = await this.useCase.dispatchPending();
    res.json({ ok: true, sent });
  }

  private async updateTags(req: Request, res: Response) {
    const { tags } = req.body;
    this.useCase.updateTags(parseInt(req.params.id), tags || []);
    res.json({ ok: true });
  }

  private async toggleFavorite(req: Request, res: Response) {
    const result = this.useCase.toggleFavorite(parseInt(req.params.id));
    res.json({ ok: true, favorite: result });
  }

  private async getTags(req: Request, res: Response) {
    res.json(this.useCase.getTags());
  }

  private async scan(req: Request, res: Response) {
    const { path: dirPath } = req.body;
    if (!dirPath) return res.status(400).json({ error: "缺少path" });
    const count = await this.useCase.scanDir(dirPath);
    res.json({ ok: true, count });
  }
}
