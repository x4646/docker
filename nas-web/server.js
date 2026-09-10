const express = require('express');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');
const http    = require('http');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app  = express();

// 2026-09-10修复: 代理到后端时原来没指定agent, Node默认全局agent不开keep-alive,
// 意味着每一次代理请求(哪怕是一张缩略图、一段视频Range分片)都要新建一条TCP连接。
// 图库快速翻页/视频快速拖进度条时会在几秒内炸出成百上千条新连接, 每条连接内核都要
// 分配收发缓冲区, 实测会把整机 net.ipv4.tcp_mem 打到硬顶导致NAS级卡死(SMB等其他
// 服务也一起遭殃), 详见 watchdog.log 现场记录。改成显式keep-alive连接池, 复用连接、
// 限制并发上限, 从根上减少瞬时新建连接数量。
// 2026-09-10再调整: maxSockets=12 实测导致更严重的问题——一旦12个槽位被占满
// (哪怕只是暂时的慢请求), 后续所有请求在agent内部排队等空位, 但队列不会超时,
// 直接无限期挂起(浏览器10秒收不到任何响应, nas-media自己完全空闲, 说明请求
// 压根没转发过去)。相当于自己给自己拖了个死锁, 比原来的问题更糟, 紧急回退:
// 只保留keep-alive连接复用(这个是真正解决了TCP内存耗尽问题的部分), 去掉激进的
// 并发上限, 不再用http.Agent的maxSockets当节流阀——这个机制在请求挂起时没有
// 超时/降级路径, 风险太高, 以后如果还要限流, 应该在应用层做带超时的限流,
// 而不是指望Agent的排队机制。
const keepAliveAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 256,
  maxFreeSockets: 32,
});

// 2026-08-21: NAS地址/端口统一从共享配置读取, 见 data/nas-config.json
const net  = JSON.parse(fs.readFileSync('/data/nas-config.json', 'utf8'));
const PORT = net.ports.nas_web;

// svc-jp(日语学习后端)——要放在下面那条通用 /api 规则前面,不然会被 nas-media 那条先吃掉
// 跟 nas-web 同一个 compose 项目,用容器名直连(比绕宿主机 IP 更稳定、更快)。
const JP_BACKEND = `http://svc-jp:${net.ports.svc_jp}`;
app.use('/api/jp', createProxyMiddleware({ target: JP_BACKEND, changeOrigin: true, agent: keepAliveAgent }));

// notepad(速记本)——现在跟 nas-web 合并进同一个 compose 项目了,天生在同一张
// 默认网络里,直接用容器名访问,不用再绕宿主机 IP(之前绕host IP连8000端口连不通,
// 原因没查清;同项目内用容器名走的是网桥内部直连,不存在那个问题)。
// 后端自己的路由前缀已经改成 /api/notepad(见 compose 里的 API_PREFIX),原样透传即可。
app.use('/api/notepad', createProxyMiddleware({ target: 'http://notepad:8000', changeOrigin: true, agent: keepAliveAgent }));

// asset-inference(资产/记账)——现在也合并进同一个 compose 项目了,同样用容器名。
// 它自己的路由是没有前缀的(/products、/holdings 这种),用 FastAPI 的 mount
// 在应用层包了一层 /api/asset 前缀(见 app.py 末尾),这里原样透传即可。
app.use('/api/asset', createProxyMiddleware({ target: 'http://asset-inference:8300', changeOrigin: true, agent: keepAliveAgent }));

// nas-media(照片/视频/音乐后端)的前端(photo/viewer/videoer)用的是相对路径调用自己的API,
// 挪到这里之后统一反向代理回nas-media后端,页面代码不用改一行,浏览器全程同源也没有CORS问题。
// 跟 nas-web 同一个 compose 项目,用容器名直连。
const PHOTO_BACKEND = `http://nas-media:${net.ports.nas_media}`;
// 2026-09-10再修复: 实测现场抓到同一个视频文件被同时打开几十个fd从未关闭
// (watchdog.log + /proc/PID/fd 现场记录), 怀疑是keep-alive复用的某条连接卡进了
// 坏状态, 后续请求换新连接又卡住, 没有超时/降级路径, 只能无限堆积。这里加请求超时:
// 代理请求超过30秒没等到nas-media响应就主动掐断, 让被拖住的连接/fd能被回收,
// 而不是无限期挂着——把"服务彻底不可用"降级成"个别请求超时可重试"。
const PROXY_TIMEOUT_MS = 30000;
// 2026-09-10再修复(真正根因): 用户反馈是"拖同一个视频的进度条", 不是切换文件——
// 现场抓到同一个文件被开几十个fd从未关闭, 说明拖进度条时浏览器中断上一个Range请求,
// 但这个"中断"信号没有从 客户端->nas-web->nas-media 完整传导下去, nas-media那边
// 的读流孤儿化, 一直挂着。怀疑是keepAlive连接复用削弱了"客户端断开自动带崩上游连接"
// 这层隐式行为(不复用连接时, 底层socket关闭天然会级联; 复用之后未必)。
// 显式监听客户端断开(res close), 主动destroy转发给nas-media的上游请求, 把这条链路
// 的中断信号补回来。
app.use(
  ['/api', '/thumbs', '/thumbs2', '/vthumbs', '/preview', '/original', '/music', '/convfiles'],
  createProxyMiddleware({
    target: PHOTO_BACKEND,
    changeOrigin: true,
    agent: keepAliveAgent,
    proxyTimeout: PROXY_TIMEOUT_MS,
    timeout: PROXY_TIMEOUT_MS,
    on: {
      proxyReq: (proxyReq, req, res) => {
        const abort = () => { if (!proxyReq.destroyed) proxyReq.destroy(); };
        res.on('close', abort);
        req.on('aborted', abort);
      },
      error: (err, req, res) => {
        console.log('[proxy-timeout-or-error]', req.method, req.url, err.message);
        if (res.writeHead && !res.headersSent) res.writeHead(504, { 'Content-Type': 'text/plain' });
        if (res.end && !res.writableEnded) res.end('Upstream timeout');
      },
    },
  })
);

// 每个前端模块放在 public/<模块名>/ 下,访问路径就是 /<模块名>/
// 无扩展名页面入口：明确按 HTML 返回，避免浏览器显示源码
app.get('/map', (req, res) => res.sendFile(path.join(__dirname, 'public', 'map.html')));
app.get('/jp/word', (req, res) => res.sendFile(path.join(__dirname, 'public', 'jp', 'index_word.html')));
app.get('/jp/grammar', (req, res) => res.sendFile(path.join(__dirname, 'public', 'jp', 'index_grammar.html')));

// 每个前端模块放在 public/<模块名>/ 下,访问路径就是 /<模块名>/
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => console.log(`NAS Web Gateway running on port ${PORT}`));

// 局域网自签名证书, 减少浏览器工具对http+非标准端口的逐次权限确认(见 certs/ 目录)
const HTTPS_PORT = net.ports.nas_web_https;
if (HTTPS_PORT) {
  const certDir = path.join(__dirname, 'certs');
  const keyFile  = path.join(certDir, 'key.pem');
  const certFile = path.join(certDir, 'cert.pem');
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    https.createServer({
      key:  fs.readFileSync(keyFile),
      cert: fs.readFileSync(certFile),
    }, app).listen(HTTPS_PORT, '0.0.0.0', () => console.log(`NAS Web Gateway (https, self-signed) running on port ${HTTPS_PORT}`));
  }
}
