/*
 * backup.js — 备份系统(建索引/比对差异/复制缺失文件), 薄壳+worker线程, 挂载方式
 * 跟photo-worker.js一致: 长耗时逻辑全部丢进backup-worker-thread.js的独立线程里跑,
 * 这个文件只管建表、派活、收进度, 不直接碰文件系统。
 *
 * 2026-09-24改: 从"全局唯一一套目标盘+源目录"改成"多套备份计划(profile)",
 * 每套计划自己一个目标路径 + 一组源目录(支持一对一, 也支持多个源目录备份到同一个目标——
 * 多对一)。备份盘索引(backup_index)按target_path分开存, 待复制清单(backup_missing)
 * 按profile_id分开存, 这样多套计划互不干扰、各自独立跑索引/比对/复制。
 *
 * 流程(每套计划各走一遍): ①配置目标盘路径+源目录 -> ②建索引(给目标盘现有文件算md5) ->
 *       ③比对差异(NAS库md5 vs 索引, 找出目标盘没有的) -> ④复制缺失文件(镜像路径存放)
 * 进度落两份: 内存(tasks, 实时轮询用) + backup_jobs表(容器重启后还能看到上次跑到哪)。
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Worker } = require('worker_threads');

// 2026-09-25加: "备份到PC"用——NAS这边通过nas-pipe(WebSocket中转服务)喊PC自己扫描/复制文件,
// PC那边(pc-scripts/nas_client.py)早就有现成的处理逻辑(handle_sync单文件复制、
// handle_file_index扫描+算哈希), 不用发明新协议, 直接调它。nas-pipe容器名可以直接用
// (跟nas-media在同一个services_default网络下)。
const PIPE_HOST = 'nas-pipe';
const PIPE_PORT = 3030;
function pipeRequest(urlPath, body, timeoutMs, method) {
  return new Promise((resolve, reject) => {
    const m = method || 'POST';
    const payload = m === 'GET' ? '' : JSON.stringify(body || {});
    const req = http.request({
      host: PIPE_HOST, port: PIPE_PORT, path: urlPath, method: m,
      headers: m === 'GET' ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: (timeoutMs || 60000) + 5000, // 比pipe自己的等待超时再多留5秒余量
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
  (function initSchema() {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS backup_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        target_path  TEXT,
        source_paths TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS backup_profiles (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT,
        target_kind  TEXT NOT NULL DEFAULT 'nas',
        target_path  TEXT NOT NULL,
        source_paths TEXT NOT NULL DEFAULT '[]',
        created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS backup_index (
        path       TEXT PRIMARY KEY,
        size       INTEGER,
        md5        TEXT,
        mtime      INTEGER,
        indexed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_backup_index_md5 ON backup_index(md5);
      CREATE TABLE IF NOT EXISTS backup_missing (
        path       TEXT,
        size       INTEGER,
        md5        TEXT,
        copied     INTEGER NOT NULL DEFAULT 0,
        profile_id INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (path, profile_id)
      );
      CREATE TABLE IF NOT EXISTS backup_jobs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        type         TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'running',
        total        INTEGER DEFAULT 0,
        done         INTEGER DEFAULT 0,
        extra        TEXT,
        error        TEXT,
        created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
    `);
    // 旧字段补丁(老库没有这一列, 加了才能按target分开存索引)——沿用项目里一贯的
    // "ALTER TABLE包try/catch"写法, 已存在就报错忽略, 保持幂等可重复执行。
    try { db.exec("ALTER TABLE backup_index ADD COLUMN target_path TEXT"); } catch (e) {}
    try { db.exec("ALTER TABLE backup_jobs ADD COLUMN profile_id INTEGER"); } catch (e) {}
    try { db.exec("ALTER TABLE backup_missing ADD COLUMN error TEXT"); } catch (e) {}
    try { db.exec("ALTER TABLE backup_profiles ADD COLUMN target_kind TEXT NOT NULL DEFAULT 'nas'"); } catch (e) {}

    // backup_missing老表是path单列主键(一个path全局只能有一条记录), 多套计划场景下
    // 同一个源文件可能同时是好几套计划各自的"缺失项", 单列主键会互相覆盖——检测到老结构
    // 就重建成(path, profile_id)联合主键的新表, 顺手把老数据(如果有)搬过去。
    const missingSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='backup_missing'").get();
    if (missingSql && !/profile_id/.test(missingSql.sql)) {
      db.exec(`
        ALTER TABLE backup_missing RENAME TO backup_missing_old;
        CREATE TABLE backup_missing (
          path       TEXT,
          size       INTEGER,
          md5        TEXT,
          copied     INTEGER NOT NULL DEFAULT 0,
          profile_id INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (path, profile_id)
        );
      `);
      db.exec("INSERT INTO backup_missing (path, size, md5, copied, profile_id) SELECT path, size, md5, copied, 0 FROM backup_missing_old");
      db.exec("DROP TABLE backup_missing_old");
      console.log('[backup] backup_missing表已重建为(path,profile_id)联合主键');
    }

    // 老数据一次性迁移: 原来的单一全局配置(backup_config)搬成第一套profile,
    // 已有的索引/待复制清单也回填上target_path/profile_id, 不然它们会变成"没归属"的孤儿数据。
    const oldCfg = db.prepare('SELECT * FROM backup_config WHERE id = 1').get();
    const profileCount = db.prepare('SELECT COUNT(*) c FROM backup_profiles').get().c;
    if (oldCfg && oldCfg.target_path && profileCount === 0) {
      const ins = db.prepare(
        'INSERT INTO backup_profiles (name, target_path, source_paths) VALUES (?, ?, ?)'
      ).run('默认备份计划', oldCfg.target_path, oldCfg.source_paths || '[]');
      const newId = ins.lastInsertRowid;
      db.prepare("UPDATE backup_index SET target_path = ? WHERE target_path IS NULL").run(oldCfg.target_path);
      db.prepare("UPDATE backup_missing SET profile_id = ? WHERE profile_id = 0").run(newId);
      console.log('[backup] 已将旧的全局配置迁移成profile #' + newId);
    }

    // backup_jobs回填: profile_id这一列是后加的, 加列之前跑过的任务(建索引/比对/复制)
    // 全部是profile_id=NULL, 页面上"上一次跑到哪"这个查询是按profileId筛选的, 找不到
    // 归属就等于"这些历史记录直接从页面上消失了"。只有唯一一套计划的情况下可以安全地
    // 把这些孤儿记录直接认领给那一套计划(当时本来就只有它在跑); 如果已经有多套计划,
    // 没法确定孤儿记录原本是哪一套跑的, 就不回填, 避免把历史记录安错身份。
    const onlyProfile = db.prepare('SELECT id FROM backup_profiles').all();
    if (onlyProfile.length === 1) {
      const changed = db.prepare('UPDATE backup_jobs SET profile_id = ? WHERE profile_id IS NULL').run(onlyProfile[0].id).changes;
      if (changed) console.log('[backup] 已把' + changed + '条历史任务记录认领给profile #' + onlyProfile[0].id);
    }
    // 2026-09-25加: nas-media进程重启(部署新代码/容器重启)会让还在跑的worker/PC任务
    // 直接消失, 但backup_jobs表里那条记录还停在status='running', 永远不会再被更新——
    // 页面刷新后拿这条"假的进行中"记录去渲染, 看起来就像"进度卡住不动"或者跟按钮状态
    // (start可点/stop不可点)对不上号, 容易让人以为"状态没显示出来"。进程刚启动时,
    // 内存里的tasks{}必然是空的, 能百分百确定上一轮所有"running"状态的任务都已经
    // 不可能再继续跑了, 一律标记成stopped, 不再假装还在进行中。
    const orphaned = db.prepare("UPDATE backup_jobs SET status='stopped', error='进程重启, 任务已中断' WHERE status='running'").run().changes;
    if (orphaned) console.log('[backup] 已清理' + orphaned + '条因进程重启而卡住的"进行中"任务记录');

    console.log('[backup] 初始化完成');
  })();

  // taskId -> { type, status, ...progress字段, worker }
  const tasks = {};
  function newTaskId() { return 'bk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

  function getProfile(db, id) {
    return db.prepare('SELECT * FROM backup_profiles WHERE id = ?').get(id);
  }
  function profileJson(row) {
    return { id: row.id, name: row.name || '', targetKind: row.target_kind || 'nas', targetPath: row.target_path, sourcePaths: JSON.parse(row.source_paths || '[]'), createdAt: row.created_at };
  }
  // PC目标在backup_index/backup_missing里用这个前缀区分, 避免跟真实NAS路径混淆冲突
  function pcTargetKey(targetPath) { return 'pc:' + targetPath; }

  function syncJobRow(taskId) {
    const t = tasks[taskId];
    if (!t || !t.jobRowId) return;
    try {
      const db = getDb();
      db.prepare(
        "UPDATE backup_jobs SET status=?, total=?, done=?, extra=?, error=?, updated_at=strftime('%s','now') WHERE id=?"
      ).run(t.status, t.total || 0, t.done || 0, JSON.stringify(t), t.error || null, t.jobRowId);
    } catch (e) {}
  }

  function runInWorker(jobType, workerData, taskId, profileId) {
    const task = tasks[taskId] || (tasks[taskId] = { type: jobType, status: 'running', total: 0, done: 0 });
    const db = getDb();
    const row = db.prepare("INSERT INTO backup_jobs (type, status, profile_id) VALUES (?, 'running', ?)").run(jobType, profileId || null);
    task.jobRowId = row.lastInsertRowid;

    const worker = new Worker(path.join(__dirname, 'backup-worker-thread.js'), { workerData });
    task.worker = worker;
    worker.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'progress') { Object.assign(task, msg.task || {}); }
      else if (msg.type === 'done') { task.status = 'done'; task.result = msg.result; console.log('[backup] ' + jobType + '完成', JSON.stringify(msg.result)); }
      else if (msg.type === 'error') { task.status = 'error'; task.error = msg.message; console.error('[backup] ' + jobType + '出错', msg.message); }
      syncJobRow(taskId);
    });
    worker.on('error', (e) => { task.status = 'error'; task.error = e.message; syncJobRow(taskId); });
    worker.on('exit', () => { task.worker = null; });
  }

  // PC目标的index/copy不是CPU密集活(就是发HTTP请求等WebSocket那头的PC回话), 不需要
  // 丢进worker线程——直接在主线程里await, 不会卡事件循环(阻塞的是网络IO等待, 不是同步计算)。
  function startJobRow(jobType, taskId, profileId) {
    const task = tasks[taskId] = { type: jobType, status: 'running', total: 0, done: 0 };
    const db = getDb();
    const row = db.prepare("INSERT INTO backup_jobs (type, status, profile_id) VALUES (?, 'running', ?)").run(jobType, profileId || null);
    task.jobRowId = row.lastInsertRowid;
    return task;
  }

  // ── PC目标: 建索引——喊PC自己扫目标文件夹+算md5, 一次性拿回整批结果再写进backup_index ──
  async function runPcIndex(profile, taskId) {
    const task = startJobRow('index', taskId, profile.id);
    try {
      const r = await pipeRequest('/api/file-index', { pc_path: profile.target_path, hash_algo: 'md5', timeoutMs: 7200000 }, 7200000);
      if (!r.ok) throw new Error(r.error || 'PC没有响应');
      const files = r.files || [];
      const db = getDb();
      const targetKey = pcTargetKey(profile.target_path);
      const upsert = db.prepare(
        'INSERT INTO backup_index (path, size, md5, mtime, indexed_at, target_path) VALUES (?,?,?,?,strftime(\'%s\',\'now\'),?) ' +
        'ON CONFLICT(path) DO UPDATE SET size=excluded.size, md5=excluded.md5, mtime=excluded.mtime, indexed_at=excluded.indexed_at, target_path=excluded.target_path'
      );
      let indexed = 0, failed = 0;
      const tx = db.transaction(() => {
        for (const f of files) {
          if (!f.md5) { failed++; continue; }
          // 用targetKey+相对路径拼一个全局唯一的key(backup_index.path是全局主键, 不能直接用
          // 相对路径, 不同PC目标/不同NAS目标之间可能撞名)
          upsert.run(targetKey + '/' + f.path, f.size, f.md5, f.mtime, targetKey);
          indexed++;
        }
      });
      tx();
      task.status = 'done'; task.total = files.length; task.done = files.length;
      task.indexed = indexed; task.skipped = 0; task.failed = failed;
      task.result = { total: files.length, done: files.length, indexed, skipped: 0, failed };
      console.log('[backup] PC index完成', JSON.stringify(task.result));
    } catch (e) {
      task.status = 'error'; task.error = e.message;
      console.error('[backup] PC index出错', e.message);
    }
    syncJobRow(taskId);
  }

  // ── PC目标: 复制——待复制清单里的文件一个个喊PC自己去SMB读NAS、写本地盘 ──
  async function runPcCopy(profile, taskId) {
    const task = startJobRow('copy', taskId, profile.id);
    try {
      const db = getDb();
      const rows = db.prepare('SELECT path, size FROM backup_missing WHERE copied = 0 AND profile_id = ?').all(profile.id);
      const totalSize = rows.reduce((s, r) => s + (r.size || 0), 0);
      task.total = rows.length; task.totalSize = totalSize; task.doneSize = 0; task.failed = 0;
      const markCopied = db.prepare('UPDATE backup_missing SET copied = 1, error = NULL WHERE path = ? AND profile_id = ?');
      const markFailed = db.prepare('UPDATE backup_missing SET error = ? WHERE path = ? AND profile_id = ?');

      for (const r of rows) {
        if (task.status === 'stopped') break; // 支持中途停止(跟worker那条路径的语义保持一致)
        task.currentPath = r.path;
        // 单个文件给的等待时间按大小估, 至少60秒、每100MB多给60秒, 封顶30分钟(超大视频文件兜底)
        const timeoutMs = Math.min(1800000, Math.max(60000, Math.ceil((r.size || 0) / (100 * 1024 * 1024)) * 60000));
        try {
          const resp = await pipeRequest('/api/task-wait', {
            type: 'sync', event: 'create', nasPath: '/share', pcPath: profile.target_path, path: r.path, timeoutMs,
          }, timeoutMs);
          if (resp.ok && resp.result && resp.result.status === 'done') {
            markCopied.run(r.path, profile.id);
            task.doneSize += r.size || 0;
          } else {
            task.failed++;
            const errMsg = resp.error || (resp.result && resp.result.error) || '未知错误';
            markFailed.run(errMsg, r.path, profile.id);
            console.error('[backup] PC复制失败', r.path, errMsg);
          }
        } catch (e) {
          task.failed++;
          markFailed.run(e.message, r.path, profile.id);
          console.error('[backup] PC复制出错', r.path, e.message);
        }
        task.done = (task.done || 0) + 1;
        syncJobRow(taskId);
      }
      if (task.status !== 'stopped') task.status = 'done';
      task.result = { total: task.total, done: task.done, failed: task.failed, totalSize, doneSize: task.doneSize };
      console.log('[backup] PC copy完成', JSON.stringify(task.result));
    } catch (e) {
      task.status = 'error'; task.error = e.message;
      console.error('[backup] PC copy出错', e.message);
    }
    syncJobRow(taskId);
  }

  function progressJson(t) {
    if (!t) return { status: 'unknown' };
    const out = { status: t.status, total: t.total || 0, done: t.done || 0, error: t.error };
    ['indexed', 'skipped', 'failed', 'matched', 'missing', 'missingSize', 'totalSize', 'doneSize', 'currentPath', 'result']
      .forEach((k) => { if (t[k] !== undefined) out[k] = t[k]; });
    return out;
  }

  // PC在不在线——PC目标的备份计划用这个决定是显示"在线可以用"还是给一段可以直接复制去
  // PowerShell里执行的命令(手动按需启动, 不强求开机自启动, 用户明确说了不想要开机自启动)。
  app.get('/api/backup/pc-status', async (req, res) => {
    try {
      const r = await pipeRequest('/api/status', null, 5000, 'GET');
      res.json({ online: !!r.online, ip: r.ip || null, startCmd: 'python "X:\\docker\\pc-scripts\\nas_client.py"' });
    } catch (e) {
      res.json({ online: false, ip: null, startCmd: 'python "X:\\docker\\pc-scripts\\nas_client.py"', error: e.message });
    }
  });

  // ── 备份计划(profile)增删改查 ──
  // 一套计划 = 一个目标路径 + 一组源目录; 想做"一对一"就一个计划填一个源目录,
  // 想做"多对一"就一个计划填多个源目录; 想让不同的源分别备份到不同的盘, 就建多套计划。
  app.get('/api/backup/profiles', (req, res) => {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM backup_profiles ORDER BY id').all();
      res.json(rows.map(profileJson));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 目标是NAS本地路径就直接fs.existsSync查; 目标是PC的话NAS没法直接stat一个Windows路径,
  // 只能退而求其次查"PC现在在不在线"——路径本身对不对得等真正建索引/复制那一刻才知道。
  async function validateTarget(targetKind, targetPath) {
    if (targetKind === 'pc') {
      // PC不一定随时开着, 允许离线时也能先把配置存下来, 不因为PC暂时不在线就阻断保存
      if (!targetPath.trim()) return '缺少PC目标路径(比如 D:\\NASBackup\\Gcloud)';
      return null;
    }
    try {
      if (!fs.existsSync(targetPath)) return '目标路径不存在, 请确认硬盘已挂载: ' + targetPath;
    } catch (e) { return '目标路径无法访问: ' + e.message; }
    return null;
  }

  app.post('/api/backup/profiles', express.json(), async (req, res) => {
    const { name, targetKind, targetPath, sourcePaths } = req.body || {};
    const kind = targetKind === 'pc' ? 'pc' : 'nas';
    if (!targetPath) return res.status(400).json({ error: '缺少targetPath' });
    const err = await validateTarget(kind, targetPath);
    if (err) return res.status(400).json({ error: err });
    try {
      const db = getDb();
      const row = db.prepare('INSERT INTO backup_profiles (name, target_kind, target_path, source_paths) VALUES (?, ?, ?, ?)')
        .run(name || '', kind, targetPath, JSON.stringify(sourcePaths || []));
      res.json({ ok: true, id: row.lastInsertRowid });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/backup/profiles/:id', express.json(), async (req, res) => {
    const { name, targetKind, targetPath, sourcePaths } = req.body || {};
    const kind = targetKind === 'pc' ? 'pc' : 'nas';
    if (!targetPath) return res.status(400).json({ error: '缺少targetPath' });
    const err = await validateTarget(kind, targetPath);
    if (err) return res.status(400).json({ error: err });
    try {
      const db = getDb();
      const r = db.prepare('UPDATE backup_profiles SET name=?, target_kind=?, target_path=?, source_paths=? WHERE id=?')
        .run(name || '', kind, targetPath, JSON.stringify(sourcePaths || []), req.params.id);
      if (!r.changes) return res.status(404).json({ error: '计划不存在' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/backup/profiles/:id', (req, res) => {
    try {
      const db = getDb();
      db.prepare('DELETE FROM backup_profiles WHERE id = ?').run(req.params.id);
      db.prepare('DELETE FROM backup_missing WHERE profile_id = ?').run(req.params.id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── ①建索引(按目标路径建, 同一块盘只用建一次, 多个计划共用同一个目标路径也不用重复建) ──
  app.post('/api/backup/index/start', express.json(), (req, res) => {
    const db = getDb();
    const profile = getProfile(db, req.body && req.body.profileId);
    if (!profile) return res.status(400).json({ error: '备份计划不存在' });
    const tid = newTaskId();
    res.json({ ok: true, taskId: tid });
    if (profile.target_kind === 'pc') runPcIndex(profile, tid);
    else runInWorker('index', { jobType: 'index', targetPath: profile.target_path }, tid, profile.id);
  });
  app.get('/api/backup/index/progress/:taskId', (req, res) => res.json(progressJson(tasks[req.params.taskId])));

  // ── ②比对差异(某个计划的源目录 vs 它自己目标路径下的索引) ──
  app.post('/api/backup/scan/start', express.json(), (req, res) => {
    const db = getDb();
    const profile = getProfile(db, req.body && req.body.profileId);
    if (!profile) return res.status(400).json({ error: '备份计划不存在' });
    const sourcePaths = JSON.parse(profile.source_paths || '[]');
    if (!sourcePaths.length) return res.status(400).json({ error: '这套计划还没配置源目录' });
    const tid = newTaskId();
    res.json({ ok: true, taskId: tid });
    // 比对差异这一步始终在NAS本地跑(查photos表+backup_index表, 都是NAS自己数据库里的数据),
    // PC目标只是backup_index里target_path用pcTargetKey前缀区分, 逻辑跟NAS目标完全一样,
    // 不需要为PC目标单独写一套比对逻辑。
    const targetKey = profile.target_kind === 'pc' ? pcTargetKey(profile.target_path) : profile.target_path;
    runInWorker('scan', { jobType: 'scan', sourcePaths, targetPath: targetKey, profileId: profile.id }, tid, profile.id);
  });
  app.get('/api/backup/scan/progress/:taskId', (req, res) => res.json(progressJson(tasks[req.params.taskId])));

  // 待复制清单预览(分页, 按profile区分)
  app.get('/api/backup/missing', (req, res) => {
    try {
      const db = getDb();
      const profileId = req.query.profileId;
      if (!profileId) return res.status(400).json({ error: '缺少profileId' });
      const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
      // 2026-09-26改: 用户要求全量显示, 不要分页截断——上限拉到20000(单个备份计划的
      // 缺失清单一般不会超过这个量级, 真超了也就是页面滚动条长一点, 不影响功能)
      const limit = Math.min(20000, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
      const total = db.prepare('SELECT COUNT(*) c FROM backup_missing WHERE copied = 0 AND profile_id = ?').get(profileId).c;
      const sizeRow = db.prepare('SELECT COALESCE(SUM(size),0) s FROM backup_missing WHERE copied = 0 AND profile_id = ?').get(profileId);
      const rows = db.prepare('SELECT path, size FROM backup_missing WHERE copied = 0 AND profile_id = ? ORDER BY path LIMIT ? OFFSET ?')
        .all(profileId, limit, (page - 1) * limit);
      res.json({ items: rows, total, totalSize: sizeRow.s, page, limit });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 复制失败的文件+原因(按错误类型分组计数, 方便一眼看出是不是同一类问题批量出现)——
  // 排查"为什么复制会失败"用这个, 而不是干瞪着一个只有数字的失败计数。
  app.get('/api/backup/copy-errors', (req, res) => {
    try {
      const db = getDb();
      const profileId = req.query.profileId;
      if (!profileId) return res.status(400).json({ error: '缺少profileId' });
      const summary = db.prepare(
        "SELECT error, COUNT(*) c FROM backup_missing WHERE profile_id = ? AND copied = 0 AND error IS NOT NULL GROUP BY error ORDER BY c DESC"
      ).all(profileId);
      const sample = db.prepare(
        "SELECT path, size, error FROM backup_missing WHERE profile_id = ? AND copied = 0 AND error IS NOT NULL ORDER BY path LIMIT 200"
      ).all(profileId);
      res.json({ summary, sample });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── ③复制缺失文件(只复制这套计划自己的待复制清单) ──
  app.post('/api/backup/copy/start', express.json(), (req, res) => {
    const db = getDb();
    const profile = getProfile(db, req.body && req.body.profileId);
    if (!profile) return res.status(400).json({ error: '备份计划不存在' });
    const tid = newTaskId();
    res.json({ ok: true, taskId: tid });
    if (profile.target_kind === 'pc') runPcCopy(profile, tid);
    else runInWorker('copy', { jobType: 'copy', targetPath: profile.target_path, profileId: profile.id }, tid, profile.id);
  });
  app.get('/api/backup/copy/progress/:taskId', (req, res) => res.json(progressJson(tasks[req.params.taskId])));

  // 停止任务(建索引/比对/复制过程中都可能想中途停)
  app.post('/api/backup/stop/:taskId', (req, res) => {
    const t = tasks[req.params.taskId];
    if (!t) return res.json({ ok: false, error: '任务不存在' });
    if (t.worker) { try { t.worker.terminate(); } catch (e) {} }
    t.status = 'stopped';
    syncJobRow(req.params.taskId);
    res.json({ ok: true });
  });

  // 最近任务列表(容器重启后, 页面刷新还能看到之前跑到哪了)
  app.get('/api/backup/jobs', (req, res) => {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM backup_jobs ORDER BY id DESC LIMIT 20').all();
      res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // 某套计划三个步骤(index/scan/copy)各自最近一次跑到哪了——页面刚打开、没有任何
  // 正在跑的任务时(localStorage里也没有taskId可以接着轮询), 用这个把上一次跑完的
  // 结果/进度摆出来, 不然用户刷新一下页面就以为"从来没跑过"。
  app.get('/api/backup/jobs/latest', (req, res) => {
    try {
      const db = getDb();
      const profileId = req.query.profileId;
      if (!profileId) return res.status(400).json({ error: '缺少profileId' });
      const out = {};
      ['index', 'scan', 'copy'].forEach((kind) => {
        const row = db.prepare(
          'SELECT * FROM backup_jobs WHERE type = ? AND profile_id = ? ORDER BY id DESC LIMIT 1'
        ).get(kind, profileId);
        if (row) {
          let extra = {};
          try { extra = JSON.parse(row.extra || '{}'); } catch (e) {}
          out[kind] = Object.assign(progressJson(extra), { status: row.status, updatedAt: row.updated_at });
        }
      });
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  console.log('[backup] 接口挂载完成');
};
