/*
 * diff-worker-thread.js — 两个文件夹的重合度对比, 独立worker线程跑(不卡主服务)。
 * 逻辑: 分别递归扫A、B两个文件夹, 每个文件算md5(内容一样就算重合, 不管文件名/路径
 * 是不是一样——这是这个项目里一贯的比对思路, 跟backup/video-migrate用的是同一套原则)。
 * 扫完按md5配对, 分成三类: 两边都有(重合) / 只有A有 / 只有B有。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parentPort, workerData } = require('worker_threads');

function post(msg) { parentPort.postMessage(msg); }

function md5FileAsync(filePath) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}

// 2026-09-25加: 跟backup-worker-thread.js同一个道理——pc-scripts/write_md5_to_exif.py
// 会把照片"原始"md5写进JPEG的EXIF UserComment(格式"NAS_MD5=<32位hex>"), 这一写会改变
// 文件自身字节, 导致重新流式算出来的md5其实是"写标记之后"的新值。diff工具比对两个文件夹
// 也会踩到同一个坑(比如NAS原图跟外部备份的同一张图, 只有一边被写过EXIF标记的话,
// 重新算md5会得到两个不同的值, 明明内容源头一样却被判定成"不重合")。优先读EXIF标记,
// 没有才退回整个文件流式算, 跟backup那边用一致的身份判定逻辑。
function extractExifMd5(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.jpg' && ext !== '.jpeg') return null;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(65536);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    const idx = buf.slice(0, bytesRead).indexOf('NAS_MD5=');
    if (idx < 0) return null;
    const candidate = buf.slice(idx + 8, idx + 8 + 32).toString('latin1');
    return /^[0-9a-f]{32}$/i.test(candidate) ? candidate.toLowerCase() : null;
  } catch (e) {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e2) {}
  }
}

async function identityMd5(filePath) {
  const exifMd5 = extractExifMd5(filePath);
  if (exifMd5) return exifMd5;
  return md5FileAsync(filePath);
}

function walkFiles(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name.startsWith('@')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, out);
    else if (e.isFile()) out.push(full);
  }
}

async function hashAll(rootPath, sideLabel, progressState) {
  const files = [];
  walkFiles(rootPath, files);
  const result = [];
  for (const f of files) {
    let size = 0;
    try { size = fs.statSync(f).size; } catch (e) {}
    const md5 = await identityMd5(f);
    if (md5) result.push({ path: f, rel: path.relative(rootPath, f).replace(/\\/g, '/'), size, md5 });
    progressState.done++;
    if (progressState.done % 20 === 0 || progressState.done === progressState.total) {
      post({ type: 'progress', task: { phase: 'hash', side: sideLabel, total: progressState.total, done: progressState.done, currentPath: f } });
    }
  }
  return result;
}

// PC侧的文件列表是主线程(diff.js)提前喊PC agent扫描+算好md5拿回来的(见pcListA/pcListB),
// 这里直接用现成结果, 不用再读一遍磁盘——PC agent返回的是{path(相对路径), size, md5}这个
// 形状, 统一成跟NAS侧hashAll()产出的{path,rel,size,md5}一样的结构, 后面比对逻辑不用分情况。
function normalizePcList(pcFiles) {
  return (pcFiles || []).map((f) => ({ path: f.path, rel: f.path, size: f.size, md5: f.md5 })).filter((f) => f.md5);
}

async function run() {
  const { pathA, pathB, kindA, kindB, pcListA, pcListB } = workerData;
  const isA_Pc = kindA === 'pc', isB_Pc = kindB === 'pc';

  post({ type: 'progress', task: { phase: 'listing' } });
  const filesA = isA_Pc ? [] : (() => { const o = []; walkFiles(pathA, o); return o; })();
  const filesB = isB_Pc ? [] : (() => { const o = []; walkFiles(pathB, o); return o; })();

  const progressState = { total: filesA.length + filesB.length, done: 0 };
  const listA = isA_Pc ? normalizePcList(pcListA) : await hashAll(pathA, 'A', progressState);
  const listB = isB_Pc ? normalizePcList(pcListB) : await hashAll(pathB, 'B', progressState);

  const mapA = new Map(); // md5 -> [items]
  for (const f of listA) { if (!mapA.has(f.md5)) mapA.set(f.md5, []); mapA.get(f.md5).push(f); }
  const mapB = new Map();
  for (const f of listB) { if (!mapB.has(f.md5)) mapB.set(f.md5, []); mapB.get(f.md5).push(f); }

  const overlap = [], onlyA = [], onlyB = [];
  let overlapSize = 0, onlyASize = 0, onlyBSize = 0;

  for (const [md5, itemsA] of mapA) {
    if (mapB.has(md5)) {
      const itemsB = mapB.get(md5);
      overlap.push({ md5, size: itemsA[0].size, pathsA: itemsA.map(i => i.rel), pathsB: itemsB.map(i => i.rel) });
      overlapSize += itemsA[0].size;
    } else {
      for (const it of itemsA) { onlyA.push(it); onlyASize += it.size; }
    }
  }
  for (const [md5, itemsB] of mapB) {
    if (!mapA.has(md5)) { for (const it of itemsB) { onlyB.push(it); onlyBSize += it.size; } }
  }

  overlap.sort((a, b) => b.size - a.size);
  onlyA.sort((a, b) => b.size - a.size);
  onlyB.sort((a, b) => b.size - a.size);

  const totalA = listA.length, totalB = listB.length;
  const pctOfA = totalA ? Math.round(overlap.length / totalA * 100) : 0;
  const pctOfB = totalB ? Math.round(overlap.length / totalB * 100) : 0;

  return {
    pathA, pathB, totalA, totalB,
    overlapCount: overlap.length, overlapSize, pctOfA, pctOfB,
    onlyACount: onlyA.length, onlyASize,
    onlyBCount: onlyB.length, onlyBSize,
    overlap, onlyA, onlyB,
  };
}

(async () => {
  try {
    const result = await run();
    post({ type: 'done', result });
  } catch (e) {
    post({ type: 'error', message: e.message });
  }
})();
