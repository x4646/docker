// local-cache.js — 通用本地缓存(IndexedDB), 供 viewer/videoer/media-admin 共用
//
// 套路统一: 先读本地缓存秒开渲染, 再后台去服务器校验/修正(服务器端也有自己的缓存,
// 目录没变时同样不用现算), 有差异才更新UI+写回缓存。跨设备: 换一台电脑本地缓存是空的,
// 退回到"问服务器"这一步, 服务器自己也缓存过, 不会比现在慢。
//
// 用法:
//   const key = LocalCache.key('dtw', 'nas', 'tree', path);
//   const cached = await LocalCache.get(key);
//   if (cached) render(cached);           // 秒开
//   const fresh = await fetcher();
//   if (!cached || !LocalCache.equal(cached, fresh)) render(fresh);
//   LocalCache.set(key, fresh);
(function () {
  const DB_NAME = 'nas_local_cache';
  const STORE = 'entries';
  const MAX_ENTRIES = 3000;   // 超过这个数量, 命中率低的先清掉腾地方
  const EVICT_MARGIN = 300;   // 清到 MAX_ENTRIES - EVICT_MARGIN, 不用每次超1条就清一次

  let _dbPromise = null;
  function openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return resolve(null); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'key' });
          os.createIndex('hitCount', 'hitCount');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return _dbPromise;
  }

  // 拼缓存key: 命名空间+source+kind+path, 统一格式方便调试
  function key(ns, source, kind, path) {
    return ns + '|' + (source || '') + '|' + kind + '|' + (path || '');
  }

  async function get(k) {
    const db = await openDb();
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        // 2026-09-20: 原来读也开readwrite事务(为了顺手更新命中计数), 多个get()并发时
        // (比如目录树一次性并行展开很多个目录, 见dir-tree-widget.js的_restoreExpanded)
        // readwrite事务互相排队, 并发读退化成变相串行。改成readonly读, 真正能并发;
        // 命中计数挪到读完之后一个独立的readwrite事务里做, 不卡在返回结果的路径上。
        const tx = db.transaction(STORE, 'readonly');
        const os = tx.objectStore(STORE);
        const req = os.get(k);
        req.onsuccess = () => {
          const row = req.result;
          if (!row) return resolve(undefined);
          resolve(row.value);
          _bumpHit(db, row);
        };
        req.onerror = () => resolve(undefined);
      } catch (e) { resolve(undefined); }
    });
  }

  function _bumpHit(db, row) {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      row.hitCount = (row.hitCount || 0) + 1;
      row.lastAccess = Date.now();
      tx.objectStore(STORE).put(row);
    } catch (e) {}
  }

  async function set(k, value) {
    const db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      const getReq = os.get(k);
      getReq.onsuccess = () => {
        const old = getReq.result;
        os.put({
          key: k,
          value,
          hitCount: old ? (old.hitCount || 0) : 0,
          lastAccess: Date.now(),
          updatedAt: Date.now()
        });
      };
    } catch (e) {}
    _maybeEvict(db);
  }

  // 简单深比较(用JSON化比较就够, 这里存的都是可JSON化的API返回值)
  function equal(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); }
    catch (e) { return false; }
  }

  let _evicting = false;
  function _maybeEvict(db) {
    if (_evicting) return;
    if (Math.random() > 0.03) return;   // 抽样触发,不用每次写入都数一遍总量
    _evicting = true;
    try {
      const tx = db.transaction(STORE, 'readonly');
      const countReq = tx.objectStore(STORE).count();
      countReq.onsuccess = () => {
        const over = countReq.result - (MAX_ENTRIES - EVICT_MARGIN);
        if (over > 0) _evictLowHit(db, over); else _evicting = false;
      };
      countReq.onerror = () => { _evicting = false; };
    } catch (e) { _evicting = false; }
  }

  // 按命中率从低到高删, 删满n条为止(LFU式淘汰)
  function _evictLowHit(db, n) {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const idx = tx.objectStore(STORE).index('hitCount');
      const cursorReq = idx.openCursor();   // hitCount升序 = 命中最低的先来
      let removed = 0;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || removed >= n) { _evicting = false; return; }
        cursor.delete();
        removed++;
        cursor.continue();
      };
      cursorReq.onerror = () => { _evicting = false; };
    } catch (e) { _evicting = false; }
  }

  window.LocalCache = { key, get, set, equal };
})();
