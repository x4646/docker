/*
 * pc-browse.js — 给"选择PC目录"这个功能用, 跟/api/browser/...(NAS本地浏览)是平行的一套接口,
 * 不能直接复用同名路由(那套是core代码里注册的, 改不了热重载), 所以用不同路径, 前端
 * file-browser.js在source==='pc'时会打到这里, 而不是/api/browser/...。
 * 实际浏览动作发生在PC agent自己的HTTP服务(8080端口)上, 这里只是转发+格式转换,
 * 让file-browser.js这个通用组件不用为了"PC"这一种source专门改太多逻辑。
 */
const http = require('http');

const PIPE_HOST = 'nas-pipe';
const PIPE_PORT = 3030;
function httpGetJson(host, port, urlPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path: urlPath, timeout: timeoutMs || 10000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('响应解析失败: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('请求超时')); });
  });
}

module.exports = function (app, getDb) {
  async function getPcIp() {
    const status = await httpGetJson(PIPE_HOST, PIPE_PORT, '/api/status', 5000);
    if (!status.online || !status.ip) throw new Error('电脑不在线');
    return status.ip;
  }

  // GET /api/pc-browse/roots — 返回PC的所有盘符, 当成FileBrowser侧边栏的"根目录"列表
  app.get('/api/pc-browse/roots', async (req, res) => {
    try {
      const ip = await getPcIp();
      const drives = await httpGetJson(ip, 8080, '/browse', 10000);
      res.json(drives.map((d) => ({ name: d.name, path: d.path, source: 'pc' })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/pc-browse/list?path=D:\xxx — 列出PC某个目录下的内容
  app.get('/api/pc-browse/list', async (req, res) => {
    try {
      const ip = await getPcIp();
      const dirPath = req.query.path || '';
      const [drives, items] = await Promise.all([
        httpGetJson(ip, 8080, '/browse', 10000),
        dirPath ? httpGetJson(ip, 8080, '/browse?path=' + encodeURIComponent(dirPath), 10000) : Promise.resolve([]),
      ]);
      const roots = drives.map((d) => ({ name: d.name, path: d.path, source: 'pc' }));
      if (!dirPath) {
        // 没给path就是要看盘符列表本身(等价于FileBrowserService对"没匹配到已知根目录"的处理)
        return res.json({ path: '/', parent: null, items: roots, roots });
      }
      const parent = /^[A-Za-z]:\\?$/.test(dirPath) ? null : dirPath.replace(/\\[^\\]+\\?$/, '') || null;
      res.json({ path: dirPath, parent, items, roots });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('[pc-browse] 接口挂载完成');
};
