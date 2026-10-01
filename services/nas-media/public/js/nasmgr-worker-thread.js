/*
 * nasmgr-worker-thread.js — nasmgr(NAS管理面板)后台耗时任务, 独立worker线程跑(不卡主服务)。
 * 两种任务类型(workerData.jobType):
 *   'bigfiles' — 递归扫一个目录, 找出大小>=minSize的文件, 按大小倒序返回前1000个
 *   'dirsizes' — 只看一个目录"下一层"的每个子项各占多大(子目录递归求和, 子文件就是它自己大小)
 * 进度通过parentPort.postMessage定期上报, 主线程(nasmgr.js)负责转成HTTP轮询接口。
 */
const fs = require('fs');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');

function post(msg) { parentPort.postMessage(msg); }

// ── bigfiles: 递归找大文件 ──────────────────────────────
// 2026-09-25改: 用户要求结果"全部显示", 去掉了之前"匹配太多就只保留前2000个"的裁剪——
// 命中的都是符合大小门槛的文件, 数量级对个人NAS来说撑死几万条, 每条就存path/size/mtime
// 三个字段, 内存压力很小, 没必要为了防一个几乎不会发生的极端场景犧牲"要看全部"这个明确要求。
async function runBigFiles(rootPath, minSize) {
  let scanned = 0, matched = 0;
  let results = [];
  let lastPost = 0;

  function walk(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name.startsWith('@')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        scanned++;
        try {
          const st = fs.statSync(full);
          if (st.size >= minSize) { results.push({ path: full, size: st.size, mtime: Math.floor(st.mtimeMs / 1000) }); matched++; }
        } catch (e2) {}
        if (scanned - lastPost >= 200) {
          lastPost = scanned;
          post({ type: 'progress', task: { scanned, matched, currentPath: full } });
        }
      }
    }
  }
  walk(rootPath);
  results.sort((a, b) => b.size - a.size);
  return { scanned, matched, files: results };
}

// ── dirsizes: 目录下一层, 每个子项各占多大 ────────────────
function dirSize(p) {
  let total = 0, count = 0;
  function walk(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name.startsWith('@')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        try { total += fs.statSync(full).size; count++; } catch (e2) {}
      }
    }
  }
  walk(p);
  return { size: total, count };
}

async function runDirSizes(rootPath) {
  let ents;
  try { ents = fs.readdirSync(rootPath, { withFileTypes: true }); } catch (e) { throw new Error('目录读取失败: ' + e.message); }
  ents = ents.filter(e => !e.name.startsWith('.') && !e.name.startsWith('@'));
  const total = ents.length;
  let done = 0;
  const results = [];
  for (const e of ents) {
    const full = path.join(rootPath, e.name);
    if (e.isDirectory()) {
      const { size, count } = dirSize(full);
      results.push({ name: e.name, path: full, size, fileCount: count, type: 'dir' });
    } else if (e.isFile()) {
      try {
        const st = fs.statSync(full);
        results.push({ name: e.name, path: full, size: st.size, fileCount: 1, type: 'file' });
      } catch (e2) {}
    }
    done++;
    post({ type: 'progress', task: { total, done, currentPath: full } });
  }
  results.sort((a, b) => b.size - a.size);
  return { items: results };
}

(async () => {
  try {
    let result;
    if (workerData.jobType === 'bigfiles') result = await runBigFiles(workerData.path, workerData.minSize);
    else if (workerData.jobType === 'dirsizes') result = await runDirSizes(workerData.path);
    else throw new Error('未知任务类型: ' + workerData.jobType);
    post({ type: 'done', result });
  } catch (e) {
    post({ type: 'error', message: e.message });
  }
})();
