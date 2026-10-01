const { Router } = require('express');

class PhotoController {
  constructor(useCase) {
    this.useCase = useCase;
    // 目录/筛选后的照片列表查询实测要几百毫秒(几十万行表里按path前缀扫, 加索引反而更慢,
    // 已经实测过), 加个简单的按参数+版本号的内存缓存: 只要photos表没有新照片入库(MAX(id)不变),
    // 同一套筛选条件直接回放缓存, 跳过整条查询。条目数简单封顶, 超了直接清空重来, 不做LRU。
    this.listCache = new Map();
    this.router = Router();
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

  async getStats(req, res) {
    res.json(this.useCase.getStats());
  }

  async getPhotos(req, res) {
    const { page, limit, status, favorite, tags, q, dateFrom, dateTo, dirPath, year, month, mediaType } = req.query;
    const query = {
      page:      parseInt(page)  || 1,
      limit:     parseInt(limit) || 50,
      status,
      favorite:  favorite === 'true',
      tags:      tags ? tags.split(',') : undefined,
      q,
      dateFrom:  dateFrom ? parseInt(dateFrom) : undefined,
      dateTo:    dateTo   ? parseInt(dateTo)   : undefined,
      dirPath:   dirPath  || undefined,
      year:      year     ? parseInt(year)     : undefined,
      month:     month    ? parseInt(month)    : undefined,
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

  async getPhoto(req, res) {
    const photo = this.useCase.getPhoto(parseInt(req.params.id));
    if (!photo) return res.status(404).json({ error: 'not found' });
    res.json(photo.toJSON());
  }

  async receiveResult(req, res) {
    const { path, ...data } = req.body;
    if (!path) return res.status(400).json({ error: '缺少path' });
    this.useCase.receiveResult(path, data);
    res.json({ ok: true });
  }

  async dispatch(req, res) {
    const sent = await this.useCase.dispatchPending();
    res.json({ ok: true, sent });
  }

  async updateTags(req, res) {
    const { tags } = req.body;
    this.useCase.updateTags(parseInt(req.params.id), tags || []);
    res.json({ ok: true });
  }

  async toggleFavorite(req, res) {
    const result = this.useCase.toggleFavorite(parseInt(req.params.id));
    res.json({ ok: true, favorite: result });
  }

  async getTags(req, res) {
    res.json(this.useCase.getTags());
  }

  async scan(req, res) {
    const { path: dirPath } = req.body;
    if (!dirPath) return res.status(400).json({ error: '缺少path' });
    const count = await this.useCase.scanDir(dirPath);
    res.json({ ok: true, count });
  }

  async deletePhoto(req, res) {
    const photo = this.useCase.getPhoto(parseInt(req.params.id));
    if (!photo) return res.status(404).json({ error: 'not found' });
    this.useCase.deletePhoto(photo.path);
    res.json({ ok: true });
  }
}
PhotoController.LIST_CACHE_MAX = 500;

module.exports = { PhotoController };
