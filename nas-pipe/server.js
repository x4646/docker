const WebSocket = require('ws');
const express   = require('express');
const http      = require('http');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });
const PORT   = 3030;

app.use(express.json());

let pcClient     = null;
const pendingScans = new Map();

wss.on('connection', (ws) => {
  console.log('电脑已连接');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'online') {
        pcClient = ws;
        console.log('电脑上线', msg);
      }

      if (msg.type === 'scan_result') {
        console.log(`扫描结果：${msg.count}个文件`);
        const cb = pendingScans.get(msg.task_id);
        if (cb) {
          cb(msg);
          pendingScans.delete(msg.task_id);
        }
      }

      if (msg.type === 'result') {
        console.log('任务结果', msg);
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }

    } catch(e) {
      console.error('消息解析失败', e.message);
    }
  });

  ws.on('close', () => {
    console.log('电脑已断开');
    pcClient = null;
  });

  ws.on('error', (e) => {
    console.error('WebSocket错误', e.message);
  });
});

app.get('/api/status', (req, res) => {
  res.json({ online: pcClient !== null });
});

app.post('/api/task', (req, res) => {
  if (!pcClient) return res.json({ ok: false, error: '电脑不在线' });
  try {
    pcClient.send(JSON.stringify(req.body));
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

app.post('/api/scan', (req, res) => {
  if (!pcClient) return res.json({ ok: false, error: '电脑不在线' });

  const task_id = String(Date.now());
  const pc_path = req.body.pc_path || 'D:\\cloud';

  const timeout = setTimeout(() => {
    pendingScans.delete(task_id);
    res.json({ ok: false, error: '扫描超时11111' });
  }, 48000000);

  pendingScans.set(task_id, (result) => {
    clearTimeout(timeout);
    res.json({ ok: true, files: result.files, count: result.count });
  });

  pcClient.send(JSON.stringify({
    type:    'scan_request',
    task_id,
    pc_path,
  }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NAS Pipe WebSocket服务启动，端口${PORT}`);
});
