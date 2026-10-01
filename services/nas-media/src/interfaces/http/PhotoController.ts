import { Router, Request, Response } from 'express';
import { PhotoUseCase } from '../../application/PhotoUseCase';

export class PhotoController {

  readonly router = Router();

  // 目录/筛选后的照片列表查询实测要几百毫秒(几十万行表里按path前缀扫, 加索引反而更慢,
  // 已经实测过), 加个简单的按参数+版本号的内存缓存: 只要photos表没有新照片入库(MAX(id)不变),
  // 同一套筛选条件直接回放缓存, 跳过整条查询。条目数简单封顶, 超了直接清空重来, 不做LRU。
  private listCache = new Map<string, { version: number; data: any }>();
  private static readonly LIST_CACHE_MAX = 500;

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
    this.router.delete('/:id',             this.deletePhoto.bind(this));
  }

  private async getStats(req: Request, res: Response) {
    res.json(this.useCase.getStats());
  }

  private async getPhotos(req: Request, res: Response) {
    const { page, limit, status, favorite, tags, q, dateFrom, dateTo, dirPath, year, month, mediaType } = req.query as any;
    const query = {
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
      mediaType: mediaType || undefined,
    };

    const cacheKey = JSON.stringify(query);
    const version  = this.useCase.getVersion();
    const cached   = this.listCache.get(cacheKey);
    if (cached && cached.version === version) {
      res.json(cached.data);
      return;
    }

    const result = this.useCase.getPhotos(query);
    if (this.listCache.size >= PhotoController.LIST_CACHE_MAX) this.listCache.clear();
    this.listCache.set(cacheKey, { version, data: result });
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
  private async deletePhoto(req: Request, res: Response) {
    const photo = this.useCase.getPhoto(parseInt(req.params.id));
    if (!photo) return res.status(404).json({ error: "not found" });
    this.useCase.deletePhoto(photo.path);
    res.json({ ok: true });
  }
}
