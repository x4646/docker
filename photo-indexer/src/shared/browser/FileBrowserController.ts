import { Router, Request, Response } from 'express';
import { FileBrowserService } from './FileBrowserService';

/**
 * 文件浏览器HTTP接口
 * 挂载到任意服务：app.use('/api/browser', new FileBrowserController().router)
 */
export class FileBrowserController {

  readonly router = Router();
  private readonly service = new FileBrowserService();

  constructor() {
    this.router.get('/roots',      this.getRoots.bind(this));
    this.router.post('/roots',     this.addRoot.bind(this));
    this.router.delete('/roots/:id', this.deleteRoot.bind(this));
    this.router.get('/list',       this.listDir.bind(this));
  }

  // GET /api/browser/roots?source=nas
  private async getRoots(req: Request, res: Response) {
    const source = (req.query.source as 'nas' | 'pc') || 'nas';
    res.json(this.service.getRoots(source));
  }

  // POST /api/browser/roots { name, path, source }
  private async addRoot(req: Request, res: Response) {
    const { name, path, source = 'nas' } = req.body;
    if (!name || !path) return res.status(400).json({ error: '缺少name或path' });
    this.service.addRoot(name, path, source);
    res.json({ ok: true });
  }

  // DELETE /api/browser/roots/:id
  private async deleteRoot(req: Request, res: Response) {
    this.service.deleteRoot(parseInt(req.params.id));
    res.json({ ok: true });
  }

  // GET /api/browser/list?path=/share/BAK&source=nas&filter=.jpg,.png
  private async listDir(req: Request, res: Response) {
    const dirPath = (req.query.path as string) || '/';
    const source  = (req.query.source as 'nas' | 'pc') || 'nas';
    const filter  = req.query.filter ? (req.query.filter as string).split(',') : undefined;

    const result = await this.service.listDir(dirPath, source, filter);
    res.json(result);
  }
}
