/*
 * db-backup-sync.js — 数据库搬到SSD(/share/ssd001/nas.db)跑之后, 原来/data/nas.db那份
 * 改成"快照备份"角色: 用SQLite自带的backup API(事务/WAL安全, 不会拍到写到一半的脏数据)
 * 把SSD上的活动库整个备份一份回原来的位置, 万一SSD哪天掉了/坏了, 退回来用的这份数据
 * 不会太旧。
 *
 * 2026-09-25改: 从"固定每5分钟跑一次"改成事件驱动+防抖——没人写数据库就完全不跑,
 * 靠fs.watch监听SSD数据库目录下的文件变化(WAL模式下, 写入主要落在.db-wal这个文件上),
 * 每次检测到写入就把"5分钟后执行"这个定时器重新计一遍时——只要还在持续写, 定时器就
 * 一直被推迟, 真正等到"安静了5分钟没人再写"才会触发一次备份。这样闲的时候(没人操作
 * NAS)一次备份都不用跑, 忙的时候(比如批量扫描导入)也不会写一半就被打断去做快照。
 */
const fs = require('fs');
const path = require('path');

const SSD_DB_DIR = '/share/ssd001';
const SNAPSHOT_TARGET = '/data/nas.db';
const SNAPSHOT_TMP = '/data/nas.db.syncing';
const QUIET_MS = 5 * 60 * 1000; // 安静满5分钟才触发

module.exports = function (app, getDb) {
  let running = false;
  let lastResult = { time: null, ok: null, error: null, durationMs: null };
  let debounceTimer = null;
  let pendingSince = null; // 当前这一轮"有写入等着被备份"是从什么时候开始挂起的

  async function doSnapshot() {
    debounceTimer = null;
    pendingSince = null;
    if (running) return; // 上一次还没做完(理论上不会跟防抖定时器重叠, 保险起见还是挡一下)
    running = true;
    const t0 = Date.now();
    try {
      const db = getDb();
      fs.mkdirSync(path.dirname(SNAPSHOT_TMP), { recursive: true });
      await db.backup(SNAPSHOT_TMP);
      // 原子替换: rename在同一个文件系统内是原子操作, 不会有"半个文件"的中间状态
      fs.renameSync(SNAPSHOT_TMP, SNAPSHOT_TARGET);
      lastResult = { time: Date.now(), ok: true, error: null, durationMs: Date.now() - t0 };
      console.log('[db-backup-sync] 快照完成, 耗时' + (Date.now() - t0) + 'ms');
    } catch (e) {
      lastResult = { time: Date.now(), ok: false, error: e.message, durationMs: Date.now() - t0 };
      console.error('[db-backup-sync] 快照失败', e.message);
      try { fs.unlinkSync(SNAPSHOT_TMP); } catch (e2) {}
    } finally {
      running = false;
    }
  }

  // 每次检测到写入活动就把定时器往后推QUIET_MS——典型的防抖(debounce), 持续写的时候
  // 永远不会真正触发, 只有停下来满5分钟才会跑一次。
  function scheduleAfterQuiet() {
    if (!pendingSince) pendingSince = Date.now();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doSnapshot, QUIET_MS);
  }

  // 监听SSD数据库所在目录, 只看跟这个库相关的几个文件名(主文件/WAL/SHM), 别的文件
  // 变化不用管。监听目录而不是单个文件, 是因为部分文件系统操作(比如WAL checkpoint)
  // 可能涉及文件被替换/重建, 直接watch单个文件容易在这种时刻丢失监听。
  const watchNames = new Set(['nas.db', 'nas.db-wal', 'nas.db-shm']);
  try {
    fs.watch(SSD_DB_DIR, (eventType, filename) => {
      if (filename && watchNames.has(filename)) scheduleAfterQuiet();
    });
    console.log('[db-backup-sync] 已开始监听 ' + SSD_DB_DIR + ' 的写入活动(事件驱动, 非定时轮询)');
  } catch (e) {
    console.error('[db-backup-sync] 监听SSD目录失败, 退回定时兜底(每30分钟检查一次): ' + e.message);
    setInterval(doSnapshot, 30 * 60 * 1000);
  }

  app.get('/api/db-backup-sync/status', (req, res) => {
    res.json({
      running, lastResult, quietMs: QUIET_MS, target: SNAPSHOT_TARGET,
      pending: !!debounceTimer, pendingSince,
    });
  });
  app.post('/api/db-backup-sync/run-now', (req, res) => {
    clearTimeout(debounceTimer);
    doSnapshot();
    res.json({ ok: true });
  });

  console.log('[db-backup-sync] 已启动, 事件驱动模式: 写入安静满' + (QUIET_MS / 60000) + '分钟后才会把SSD上的数据库快照备份回' + SNAPSHOT_TARGET);
};
