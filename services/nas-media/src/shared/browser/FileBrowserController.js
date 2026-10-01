const { Router } = require('express');
const { FileBrowserService } = require('./FileBrowserService');

/**
 * 文件浏览器HTTP接口
 * 挂载到任意服务：app.use('/api/browser', new FileBrowserController().router)
 */
class FileBrowserController {
  constructor() {
    this.service = new FileBrowserService();
    this.router = Router();
    this.router.get('/roots',      this.getRoots.bind(this));
    this.router.post('/roots',     this.addRoot.bind(this));
    this.router.delete('/roots/:id', this.deleteRoot.bind(this));
    this.router.get('/list',       this.listDir.bind(this));
  }

  // GET /api/browser/roots?source=nas
  async getRoots(req, res) {
    const source = req.query.source || 'nas';
    res.json(this.service.getRoots(source));
  }

  // POST /api/browser/roots { name, path, source }
  async addRoot(req, res) {
    const { name, path, source = 'nas' } = req.body;
    if (!name || !path) return res.status(400).json({ error: '缺少name或path' });
    this.service.addRoot(name, path, source);
    res.json({ ok: true });
  }

  // DELETE /api/browser/roots/:id
  async deleteRoot(req, res) {
    this.service.deleteRoot(parseInt(req.params.id));
    res.json({ ok: true });
  }

  // GET /api/browser/list?path=/share/BAK&source=nas&filter=.jpg,.png
  async listDir(req, res) {
    const dirPath = req.query.path || '/';
    const source  = req.query.source || 'nas';
    const filter  = req.query.filter ? req.query.filter.split(',') : undefined;

    const result = await this.service.listDir(dirPath, source, filter);
    res.json(result);
  }
}

module.exports = { FileBrowserController };
