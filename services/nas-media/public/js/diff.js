/*
 * diff.js — 两个文件夹的重合度对比。薄壳+worker线程, 跟nasmgr/backup同一个套路。
 * A/B两边各自可以是NAS路径, 也可以是PC路径(通过nas-pipe喊PC agent扫描+算md5,
 * 跟backup.js里"备份到PC"用的是同一套机制)。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Worker } = require('worker_threads');

const PIPE_HOST = 'nas-pipe';
const PIPE_PORT = 3030;
function pipeRequest(urlPath, body, timeoutMs, method) {
  return new Promise((resolve, reject) => {
    const m = method || 'POST';
    const payload = m === 'GET' ? '' : JSON.stringify(body || {});
    const req = http.request({
      host: PIPE_HOST, port: PIPE_PORT, path: urlPath, method: m,
      headers: m === 'GET' ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: (timeoutMs || 60000) + 5000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('pipe响应解析失败: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('连接nas-pipe超时')); });
    if (m !== 'GET') req.write(payload);
    req.end();
  });
}

module.exports = function (app, getDb) {
  const tasks = {};
  function newTaskId() { return 'df_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

  function safePath(p) {
    if (!p) return null;
    let real;
    try { real = fs.realpathSync(p); } catch (e) { return null; }
    if (!real.startsWith('/share/')) return null;
    if (!fs.statSync(real).isDirectory()) return null;
    return real;
  }

  app.get('/api/diff/pc-status', async (req, res) => {
    try {
      const r = await pipeRequest('/api/status', null, 5000, 'GET');
      res.json({ online: !!r.online, ip: r.ip || null, startCmd: 'python "X:\\docker\\pc-scripts\\nas_client.py"' });
    } catch (e) {
      res.json({ online: false, ip: null, startCmd: 'python "X:\\docker\\pc-scripts\\nas_client.py"', error: e.message });
    }
  });

  app.post('/api/diff/start', express.json(), (req, res) => {
    const body = req.body || {};
    const kindA = body.kindA === 'pc' ? 'pc' : 'nas';
    const kindB = body.kindB === 'pc' ? 'pc' : 'nas';
    const rawA = body.pathA, rawB = body.pathB;

    const pathA = kindA === 'pc' ? (rawA || '').trim() : safePath(rawA);
    const pathB = kindB === 'pc' ? (rawB || '').trim() : safePath(rawB);
    if (!pathA) return res.status(400).json({ error: kindA === 'pc' ? '缺少PC文件夹A路径' : '文件夹A不存在或不在/share下' });
    if (!pathB) return res.status(400).json({ error: kindB === 'pc' ? '缺少PC文件夹B路径' : '文件夹B不存在或不在/share下' });

    const tid = newTaskId();
    res.json({ ok: true, taskId: tid });
    const task = tasks[tid] = { type: 'diff', status: 'running' };

    (async () => {
      try {
        // PC那一侧的扫描+算md5是喊PC agent自己干的(可能要一会儿, 尤其文件多的时候),
        // 这一步在主线程里await(纯网络IO等待, 不占CPU), 等两边都准备好了(NAS路径不用
        // 提前处理, worker自己会去扫)才真正起worker线程做比对。
        let pcListA = null, pcListB = null;
        if (kindA === 'pc') {
          task.phase = 'pc_scan_a';
          const r = await pipeRequest('/api/file-index', { pc_path: pathA, hash_algo: 'md5', timeoutMs: 7200000 }, 7200000);
          if (!r.ok) throw new Error('扫描PC文件夹A失败: ' + (r.error || '未知错误'));
          pcListA = r.files || [];
        }
        if (kindB === 'pc') {
          task.phase = 'pc_scan_b';
          const r = await pipeRequest('/api/file-index', { pc_path: pathB, hash_algo: 'md5', timeoutMs: 7200000 }, 7200000);
          if (!r.ok) throw new Error('扫描PC文件夹B失败: ' + (r.error || '未知错误'));
          pcListB = r.files || [];
        }

        const worker = new Worker(path.join(__dirname, 'diff-worker-thread.js'), {
          workerData: { pathA, pathB, kindA, kindB, pcListA, pcListB },
        });
        task.worker = worker;
        worker.on('message', (msg) => {
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'progress') Object.assign(task, msg.task || {});
          else if (msg.type === 'done') { task.status = 'done'; task.result = msg.result; }
          else if (msg.type === 'error') { task.status = 'error'; task.error = msg.message; }
        });
        worker.on('error', (e) => { task.status = 'error'; task.error = e.message; });
        worker.on('exit', () => { task.worker = null; });
      } catch (e) {
        task.status = 'error'; task.error = e.message;
      }
    })();
  });

  app.get('/api/diff/progress/:taskId', (req, res) => res.json(tasks[req.params.taskId] || { status: 'unknown' }));
  app.post('/api/diff/stop/:taskId', (req, res) => {
    const t = tasks[req.params.taskId];
    if (!t) return res.json({ ok: false, error: '任务不存在' });
    if (t.worker) { try { t.worker.terminate(); } catch (e) {} }
    t.status = 'stopped';
    res.json({ ok: true });
  });

  console.log('[diff] 接口挂载完成');
};
