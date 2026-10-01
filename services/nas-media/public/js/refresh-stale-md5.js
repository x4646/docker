/*
 * refresh-stale-md5.js — 扫描photos表, 找出"数据库记录的size/mtime"跟"文件实际情况"
 * 对不上的记录(说明文件入库之后又被改过, 数据库没跟着刷新), 重新算identity(JPG优先
 * 读EXIF标记)刷新数据库。薄壳+worker线程, 跟nasmgr/backup同一个套路。
 */
const path = require('path');
const express = require('express');
const { Worker } = require('worker_threads');

module.exports = function (app, getDb) {
  const tasks = {};
  function newTaskId() { return 'rf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

  app.post('/api/refresh-stale-md5/start', express.json(), (req, res) => {
    const dryRun = !!(req.body && req.body.dryRun);
    const tid = newTaskId();
    res.json({ ok: true, taskId: tid });
    const task = tasks[tid] = { type: 'refresh', status: 'running', dryRun };
    const worker = new Worker(path.join(__dirname, 'refresh-stale-md5-worker-thread.js'), { workerData: { dryRun } });
    task.worker = worker;
    worker.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'progress') Object.assign(task, msg.task || {});
      else if (msg.type === 'done') { task.status = 'done'; task.result = msg.result; }
      else if (msg.type === 'error') { task.status = 'error'; task.error = msg.message; }
    });
    worker.on('error', (e) => { task.status = 'error'; task.error = e.message; });
    worker.on('exit', () => { task.worker = null; });
  });

  app.get('/api/refresh-stale-md5/progress/:taskId', (req, res) => res.json(tasks[req.params.taskId] || { status: 'unknown' }));
  app.post('/api/refresh-stale-md5/stop/:taskId', (req, res) => {
    const t = tasks[req.params.taskId];
    if (!t) return res.json({ ok: false, error: '任务不存在' });
    if (t.worker) { try { t.worker.terminate(); } catch (e) {} }
    t.status = 'stopped';
    res.json({ ok: true });
  });

  console.log('[refresh-stale-md5] 接口挂载完成');
};
