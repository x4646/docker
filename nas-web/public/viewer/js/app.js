/**
 * Photo Viewer 主逻辑
 */

const state = {
  photos:    [],
  page:      1,
  total:     0,
  loading:   false,
  hasMore:   true,
  filter:    { q:'', tags:[], favorite:false, dirPath:'', year:0, month:0 },
  aiFilter:  { tags:[], mode:'or' },
  viewer:    { index:-1, zoom:1, panX:0, panY:0, dragging:false, lastX:0, lastY:0 },
  slideshow: { active:false, timer:null, interval:4000 },
  music:     { audio:null, playlist:[], index:0, playing:false, mode:'shuffle', volume:0.6 },
  playlists: [],
  tags:      [],
};

const dirFilecountCache = new Map();

// 切换目录/年月/收藏这类"跳到别的筛选范围"的操作之前统一调这个,
// 不然上一次搜索框里剩的关键词会一直卡在state.filter.q里,把新范围的结果全部滤没
// (2026-08-21: 目录/年份/月份/收藏切换都各自忘了清q,统一收口成一个函数,不用每处都记得写)
function clearSearchQuery() {
  state.filter.q = '';
  const el = document.querySelector('.nav-search');
  if (el) el.value = '';
}

// ── 浏览位置记忆 ──────────────────────────────────────
let _restoringBrowse = false;
function _saveBrowseState() {
  if (_restoringBrowse) return;
  try {
    localStorage.setItem("browseState", JSON.stringify({
      dirPath: state.filter.dirPath || "",
      tags: state.filter.tags || [],
      aiTags: state.aiFilter.tags || [],
      aiMode: state.aiFilter.mode || "or",
      favorite: !!state.filter.favorite,
      ratings: state.filter.ratings || [],
      q: state.filter.q || "",
      scrollY: window.scrollY || document.documentElement.scrollTop || 0,
      viewerOpen: !!document.getElementById("viewer") && document.getElementById("viewer").classList.contains("show"),
      viewerIdx: state.viewer ? state.viewer.index : 0,
      volume: state.music ? state.music.volume : 0.6,
      count: (state.photos || []).length,
      ts: Date.now()
    }));
  } catch (e) {}
}

async function _restoreBrowseState() {
  let st = null;
  try { st = JSON.parse(localStorage.getItem("browseState") || "null"); } catch (e) {}
  if (!st) { loadPhotos(true); return; }
  if (st.ts && Date.now() - st.ts > 86400000) { loadPhotos(true); return; }
  _restoringBrowse = true;
  state.filter.dirPath = st.dirPath || "";
  state.filter.tags = st.tags || [];
  state.filter.favorite = !!st.favorite;
  state.filter.ratings = Array.isArray(st.ratings) ? st.ratings : [];
  state.filter.q = st.q || "";
  state.aiFilter.tags = st.aiTags || [];
  state.aiFilter.mode = st.aiMode || "or";
  await loadPhotos(true);
  let guard = 0;
  while ((state.photos || []).length < (st.count || 0) && state.hasMore && guard < 20) {
    guard++;
    await loadPhotos();
  }
  if (typeof refreshTagDirs === "function") refreshTagDirs();
  if (typeof renderAiTagBar === "function") renderAiTagBar();
  if (typeof st.volume === "number") {
    state.music.volume = st.volume;
    if (state.music.audio) state.music.audio.volume = st.volume;
    const vs = document.getElementById("volume-slider") || document.getElementById("music-volume");
    if (vs) vs.value = st.volume;
  }
  if (st.dirPath) _waitTreeAndLocate(st.dirPath);
  if (st.dirPath && window.dirTree && typeof window.dirTree.expandTo === "function") {
    try { window.dirTree.expandTo(st.dirPath); } catch (e) {}
  } else if (st.dirPath && window.dirTree && typeof window.dirTree.selectPath === "function") {
    try { window.dirTree.selectPath(st.dirPath); } catch (e) {}
  }
  setTimeout(function () {
    window.scrollTo(0, st.scrollY || 0);
    _restoringBrowse = false;
    if (st.viewerOpen && state.photos && state.photos[st.viewerIdx]) {
      openViewer(st.viewerIdx);
    }
  }, 150);
}

window.addEventListener("scroll", function () {
  clearTimeout(window._bsTimer);
  window._bsTimer = setTimeout(_saveBrowseState, 400);
}, { passive: true });
window.addEventListener("beforeunload", _saveBrowseState);
async function init() {
  _restoreBrowseState();
  setupIntersectionObserver();
  setupKeyboard();
  setupViewer();
  if (typeof renderRoleSwitchButton === 'function') renderRoleSwitchButton();
  loadSidebar().catch(function(e){ console.error('sidebar', e); });
  loadPlaylists()
    .then(function(){ return loadMusicSettings(); })
    .then(function(){ restoreLastPlay(); })
    .catch(function(e){ console.error('music', e); });
  setTimeout(function(){ loadTags().catch(function(e){ console.error('tags', e); }); }, 300);
}

// ── 侧边栏 ────────────────────────────────────────────

async function loadPcPhotos(pcPath) {
  state.pcMode = true;
  pcPath = pcPath.split('\\').join('/');
  const statsBar = document.querySelector(".stats-bar");
  if (statsBar) statsBar.innerHTML = `💻 ${pcPath} <span style="color:#507090;font-size:.8rem">加载中...</span>`;

  const r    = await fetch(`/api/photos?dirPath=${encodeURIComponent(pcPath)}&limit=50&page=1&status=done`);
  const data = await r.json();

  fetch("/api/pc/dir-stats", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pcPath }),
  }).then(r => r.json()).then(stats => {
    if (statsBar && !stats.error) {
      statsBar.innerHTML = `💻 ${pcPath.split("\\").pop() || pcPath.split("/").pop()} &nbsp;`
        + `<span style="color:#3ddc84">✅${stats.cached}</span> &nbsp;`
        + `<span style="color:#ffa500">⏳${stats.pending}</span> &nbsp;`
        + `<span style="color:#507090">总${stats.total}</span>`;
    }
  }).catch(() => {});

  if (data.photos && data.photos.length) {
    state.photos  = data.photos;
    state.total   = data.total;
    state.page    = 2;
    state.hasMore = data.total > 50;
    state.filter.dirPath = pcPath;
    renderGrid(data.photos, true);
    const _st = document.getElementById("stats-total"); if (_st) _st.textContent = data.total;
  } else {
    state.photos  = [];
    state.total   = 0;
    state.hasMore = false;
    state.filter.dirPath = pcPath;
    document.getElementById("photo-grid").innerHTML =
      `<div style="padding:40px;color:#507090;grid-column:1/-1;text-align:center">`
      + `📂 此目录暂无已处理图片<br><small>右键目录→「处理」生成缩略图</small></div>`;
  }
}

function renderDirStatsInline(el, stats, path) {
  const done     = stats.done || 0;
  const fcTotal  = path ? dirFilecountCache.get(path) : null;
  if (fcTotal) {
    if (done < fcTotal) {
      el.innerHTML = `<span style="color:#3ddc84">${done}</span><span style="color:#507090">/</span><span style="color:#ffa500">${fcTotal}</span>`;
    } else {
      el.innerHTML = `<span style="color:#3ddc84">${done}/${fcTotal}</span>`;
    }
  } else {
    el.innerHTML = `<span style="color:#3ddc84">${done}</span>`;
  }
}

async function loadDirStatsLazy(path, el) {
  if (el.dataset.loaded) return;
  el.dataset.loaded = '1';
  try {
    const r     = await fetch(`/api/photos/stats/by-dir?path=${encodeURIComponent(path)}`);
    const stats = await r.json();
    const fcTotal = dirFilecountCache.get(path);
    if (fcTotal) stats.total = fcTotal;
    renderDirStatsInline(el, stats, path);
  } catch(e) {}
}

async function loadSidebar() {
  const sidebar = document.querySelector('.sidebar');
  sidebar.innerHTML = '';

  const secView = document.createElement('div');
  secView.className = 'sidebar-section';
  secView.textContent = '视图';
  sidebar.appendChild(secView);

  const allItem = document.createElement('div');
  allItem.className = 'sidebar-item active';
  allItem.id = 'item-all';
  allItem.innerHTML = '📷 全部';
  allItem.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-item').forEach(e => e.classList.remove('active'));
    allItem.classList.add('active');
    state.filter = { q:'', tags:[], favorite:false, dirPath:'', year:0, month:0 };
    loadPhotos(true);
  });
  sidebar.appendChild(allItem);

  const favItem = document.createElement('div');
  favItem.className = 'sidebar-item';
  favItem.innerHTML = '❤️ 收藏';
  favItem.addEventListener('click', () => setFavFilter(favItem));
  sidebar.appendChild(favItem);

  const secDir = document.createElement('div');
  secDir.className = 'sidebar-section';
  secDir.style.marginTop = '8px';
  secDir.textContent = '目录';
  sidebar.appendChild(secDir);
  const dirTreeWrap = document.createElement('div');
  dirTreeWrap.id = 'nas-dir-tree-wrap';
  sidebar.appendChild(dirTreeWrap);
  const dirContainer = document.createElement('div');
  dirTreeWrap.appendChild(dirContainer);
  const tagDirList = document.createElement('div');
  tagDirList.id = 'tag-dir-list';
  tagDirList.style.display = 'none';
  sidebar.appendChild(tagDirList);

  const secTime = document.createElement('div');
  secTime.className = 'sidebar-section';
  secTime.style.marginTop = '8px';
  secTime.textContent = '时间轴';
  sidebar.appendChild(secTime);
  const timeContainer = document.createElement('div');
  sidebar.appendChild(timeContainer);

  const secPc = document.createElement('div');
  secPc.className = 'sidebar-section';
  secPc.style.marginTop = '8px';
  secPc.textContent = '💻 PC';
  sidebar.appendChild(secPc);
  const pcContainer = document.createElement('div');
  sidebar.appendChild(pcContainer);

  const secTag = document.createElement('div');
  secTag.className = 'sidebar-section';
  secTag.style.marginTop = '8px';
  secTag.textContent = '标签';
  sidebar.appendChild(secTag);
  const tagCloud = document.createElement('div');
  tagCloud.className = 'tag-cloud';
  tagCloud.id = 'tag-cloud';
  sidebar.appendChild(tagCloud);

  const _nasViewRoots = dtaMakeRoots('nas');
  const _currentRole = (function(){ try { const raw = localStorage.getItem('viewer_current_role'); return raw ? JSON.parse(raw) : null; } catch(e){ return null; } })();
  if (_currentRole) {
    _nasViewRoots.fn = async () => {
      const r = await fetch('/api/roles').then(r => r.json());
      const role = r.find(x => x.id === _currentRole.id);
      const roots = (role && role.allowed_roots) || [];
      return roots.map(p => ({ name: p.split('/').filter(Boolean).pop() || p, path: p, hasChildren: true }));
    };
  }
  const _nasView = (path) => {
    clearSearchQuery();
    state.filter.dirPath  = path;
    state.filter.year     = 0;
    state.filter.month    = 0;
    state.filter.favorite = false;
    state.filter.tags = [];
    state.aiFilter.tags = [];
    if (typeof renderActiveTags === 'function') renderActiveTags();
    if (typeof renderAiTagBar === 'function') renderAiTagBar();
    loadPhotos(true);
  };
  window.dirTree = new DirTreeWidget({
    container: dirContainer,
    source: 'nas',
    instanceId: 'viewer_nas',
    mode: 'single',
    showRefresh: true,
    rootsFn: _nasViewRoots.fn,
    childrenFn: async (path) => {
      return await fetch('/api/dir-tree?source=nas&path=' + encodeURIComponent(path)).then(r => r.json());
    },
    statFn: async (path, forceReal) => {
      return await fetch('/api/dir-stat?source=nas&path=' + encodeURIComponent(path) + (forceReal ? '&real=1' : '')).then(r => r.json());
    },
    onSelect: _nasView,
    contextMenu: (path) => buildDirContextMenu(window.dirTree, 'nas', path, {
      onView: _nasView, rootSet: _nasViewRoots.set, rootIdMap: _nasViewRoots.map
    }),
  });
  window.dirTree.bind();
  window.dirTree.init();

  function _renderTimeline(times) {
      timeContainer.innerHTML = '';
      const years = {};
      times.forEach(t => {
        if (!years[t.year]) years[t.year] = [];
        years[t.year].push(t);
      });
      const totalCount = times.reduce((a, b) => a + b.count, 0);
      allItem.innerHTML = `📷 全部 <small style="color:#507090">${totalCount}</small>`;

      const months = ['','1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
      Object.entries(years).sort((a,b) => Number(b[0])-Number(a[0])).forEach(([year, ms]) => {
        const yearCount = ms.reduce((a,b) => a+b.count, 0);
        const yearRow   = document.createElement('div');
        yearRow.className = 'sidebar-item';
        yearRow.innerHTML = `<span class="dir-toggle-icon">▶</span>📅 ${year}年 <small style="color:#507090">${yearCount}</small>`;

        const monthContainer = document.createElement('div');
        monthContainer.style.display = 'none';

        yearRow.addEventListener('click', () => {
          const isOpen = monthContainer.style.display !== 'none';
          monthContainer.style.display = isOpen ? 'none' : 'block';
          yearRow.querySelector('.dir-toggle-icon').textContent = isOpen ? '▶' : '▼';
          if (!isOpen) {
            document.querySelectorAll('.sidebar-item').forEach(e => e.classList.remove('active'));
            yearRow.classList.add('active');
            clearSearchQuery();
            state.filter.dirPath  = '';
            state.filter.year     = parseInt(year);
            state.filter.month    = 0;
            state.filter.favorite = false;
            loadPhotos(true);
          } else if (state.filter.year === parseInt(year)) {
            // 收起的正是当前筛选中的这一年 → 视为取消时间筛选,回到"全部"
            // (以前这里只收起月份列表, state.filter.year没跟着清, 照片一直卡在这一年出不来)
            document.querySelectorAll('.sidebar-item').forEach(e => e.classList.remove('active'));
            allItem.classList.add('active');
            state.filter = { q:'', tags:[], favorite:false, dirPath:'', year:0, month:0 };
            loadPhotos(true);
          }
        });

        ms.forEach(m => {
          const mRow = document.createElement('div');
          mRow.className = 'sidebar-item';
          mRow.style.paddingLeft = '24px';
          mRow.style.fontSize    = '.76rem';
          mRow.innerHTML = `　${months[m.month]} <small style="color:#507090">${m.count}</small>`;
          mRow.addEventListener('click', () => {
            const already = state.filter.year === parseInt(year) && state.filter.month === m.month;
            document.querySelectorAll('.sidebar-item').forEach(e => e.classList.remove('active'));
            clearSearchQuery();
            state.filter.dirPath  = '';
            state.filter.favorite = false;
            if (already) {
              // 再点一次已选中的月份 → 取消月份筛选,退回到只按这一年筛选
              yearRow.classList.add('active');
              state.filter.year  = parseInt(year);
              state.filter.month = 0;
            } else {
              mRow.classList.add('active');
              state.filter.year  = parseInt(year);
              state.filter.month = m.month;
            }
            loadPhotos(true);
          });
          monthContainer.appendChild(mRow);
        });

        timeContainer.appendChild(yearRow);
        timeContainer.appendChild(monthContainer);
      });
  }

  // 缓存优先: 先出缓存的时间轴秒开, 后台去服务器校验(服务器自己也缓存过)修正
  (async () => {
    const cacheKey = window.LocalCache ? LocalCache.key('viewer', 'nas', 'timeline', '') : null;
    let cached = null;
    if (cacheKey) { try { cached = await LocalCache.get(cacheKey); } catch (e) {} }
    if (cached) _renderTimeline(cached);
    try {
      const times = await fetch('/api/photos/groups/time').then(r => r.json());
      if (cacheKey) LocalCache.set(cacheKey, times);
      if (!cached || !(window.LocalCache && LocalCache.equal(cached, times))) _renderTimeline(times);
    } catch (e) {}
  })();

  fetch('/api/pc-roots')
    .then(r => r.json())
    .then(async roots => {
      if (!roots.length) {
        const el = document.createElement('div');
        el.style.cssText = 'padding:8px 16px;font-size:.75rem;color:#507090';
        el.textContent = '未配置PC目录';
        pcContainer.appendChild(el);
        return;
      }
      const _pcViewRoots = dtaMakeRoots('pc');
      window.pcTree = new DirTreeWidget({
        container: pcContainer,
        source: 'pc',
        instanceId: 'viewer_pc',
        mode: 'single',
        showRefresh: true,
        icons: { root: '💻', child: '📁' },
        rootsFn: _pcViewRoots.fn,
        childrenFn: async (path) => {
          return await fetch('/api/dir-tree?source=pc&path=' + encodeURIComponent(path)).then(r => r.json());
        },
        onSelect: (path) => {
          clearSearchQuery();
          state.filter.dirPath  = '';
          state.filter.pcPath   = path;
          state.filter.year     = 0;
          state.filter.month    = 0;
          state.filter.favorite = false;
          loadPcPhotos(path);
        },
        contextMenu: (path) => buildDirContextMenu(window.pcTree, 'pc', path, {
          onView: (p) => loadPcPhotos(p), rootSet: _pcViewRoots.set, rootIdMap: _pcViewRoots.map
        }),
      });
      window.pcTree.bind();
      window.pcTree.init();
    });

  loadTags();
}

function setFavFilter(el) {
  document.querySelectorAll('.sidebar-item').forEach(e => e.classList.remove('active'));
  if (el) el.classList.add('active');
  clearSearchQuery();
  state.filter.favorite = true;
  state.filter.dirPath  = '';
  state.filter.year     = 0;
  state.filter.month    = 0;
  loadPhotos(true);
}

// ── 图片加载 ──────────────────────────────────────────
let _photoLoadGen = 0;
// 粗略估算一屏能放几张缩略图(格子大小不用很精确, 够用就行)
function _screenPhotoCount() {
  const grid = document.getElementById('photo-grid');
  const cellW = 170, cellH = 170;
  const w = (grid && grid.clientWidth) || window.innerWidth || 1200;
  const h = window.innerHeight || 800;
  const cols = Math.max(1, Math.floor(w / cellW));
  const rows = Math.max(2, Math.ceil(h / cellH));
  return Math.max(12, cols * rows);
}

// 连真实照片列表都还没拿到的时候(第一次进这个目录/筛选, 缓存和peek都还没回来那一小段空窗期),
// 之前只有个32px小转圈, 页面看着是空的。先铺一屏"通用骨架"占好位置(不知道真实图片长宽比,
// 用4:3兜底), 真实数据一到(不管是缓存/peek/完整请求哪个先回来)renderGrid会直接替换掉。
function renderSkeletonGrid() {
  const grid = document.getElementById('photo-grid');
  if (!grid || grid.children.length) return;  // 已经有内容(哪怕是骨架/真图)就不重复铺
  const n = _screenPhotoCount();
  let html = '';
  for (let i = 0; i < n; i++) {
    html += '<div class="photo-item photo-skeleton-only" style="aspect-ratio:4/3"></div>';
  }
  grid.innerHTML = html;
}

async function loadPhotos(reset = false) {
  if (!state.pcMode) state.filter.dirPath = state.filter.dirPath;
  if (state.loading || (!reset && !state.hasMore)) return;
  if (reset) { state.page = 1; state.photos = []; state.hasMore = true; _photoLoadGen++; }
  if (reset) {
    state.pcMode = false;
    const _sb = document.querySelector('.stats-bar');
    if (_sb && !document.getElementById('stats-total')) {
      _sb.innerHTML = '共 <span id="stats-total">0</span> 张照片';
    }
    const grid = document.getElementById('photo-grid');
    if (grid) grid.innerHTML = '';   // 切目录/筛选: 先清空旧内容(骨架会立刻补上, 不会露空白)
    renderSkeletonGrid();
  }
  const _myGen = _photoLoadGen;   // 切目录/切筛选很快连点时, 用这个丢弃过期请求的结果, 不要把旧目录的图画到新目录里

  state.loading = true;
  showSpinner(true);

  const { q, tags, favorite, dirPath, year, month } = state.filter;
  let url;
  const ratings = state.filter.ratings || [];
  const _useTagApi = state.aiFilter.tags.length || tags.length || ratings.length ||
                     (favorite && !q && !year && !month);
  if (_useTagApi) {
    const useTags = state.aiFilter.tags.length ? state.aiFilter.tags : tags;
    const useMode = state.aiFilter.tags.length ? state.aiFilter.mode : 'or';
    url = `/api/photo-tags/photos?page=${state.page}&limit=50&mode=${useMode}&threshold=${tagThreshold}&mediaType=photo`;
    if (useTags.length) url += `&tags=${useTags.map(encodeURIComponent).join(',')}`;
    if (ratings.length) url += `&ratings=${ratings.join(',')}`;
    if (dirPath) url += `&dirPath=${encodeURIComponent(dirPath)}`;
    if (favorite) url += `&favorite=1`;
    // 点标签之前如果已经选了年/月,这里要跟着带上,不然点标签会把日期筛选丢掉
    if (year) {
      const from = month ? new Date(year, month - 1, 1) : new Date(year, 0, 1);
      const to   = month ? new Date(year, month, 1)     : new Date(year + 1, 0, 1);
      url += `&minDate=${Math.floor(from.getTime() / 1000)}&maxDate=${Math.floor(to.getTime() / 1000) - 1}`;
    }
  } else {
    url = `/api/photos?page=${state.page}&limit=50&mediaType=photo`;
    if (!state.filter.dirPath) url += `&status=done`;
    if (q)        url += `&q=${encodeURIComponent(q)}`;
    if (tags.length) url += `&tags=${tags.join(',')}`;
    if (favorite) url += `&favorite=true`;
    if (dirPath)  url += `&dirPath=${encodeURIComponent(dirPath)}`;
    if (year)     url += `&year=${year}`;
    if (month)    url += `&month=${month}`;
  }

  // 缓存优先(只对切目录/切筛选这种"进新视图"的第一屏做, 只存一屏的量, 不多存):
  // 有缓存 → 秒开这一屏, 后台照样去请求完整第1页来修正/补全(翻页加载的后续页不缓存)。
  const _cacheKey = (reset && window.LocalCache) ? LocalCache.key('viewer', 'nas', 'photos1', url) : null;
  let _painted = false;
  if (_cacheKey) {
    try {
      const cached = await LocalCache.get(_cacheKey);
      if (_myGen === _photoLoadGen && cached && Array.isArray(cached.photos) && cached.photos.length) {
        state.photos = cached.photos;
        state.total  = cached.total || cached.photos.length;
        renderGrid(cached.photos, true);
        updateStats();
        _painted = true;
      }
    } catch (e) {}
  }

  // 没缓存(第一次进这个目录/筛选): 并行发一个"一屏量"的小请求, 谁先回来先画谁, 不要一直空白等完整那批。
  if (reset && !_painted) {
    const screenN = _screenPhotoCount();
    const peekUrl = url.replace(/([?&])limit=\d+/, `$1limit=${screenN}`);
    fetch(peekUrl).then(r => r.json()).then(d => {
      if (_myGen !== _photoLoadGen) return;                              // 视图已经又切换了,这次结果作废
      if (document.getElementById('photo-grid').querySelector('.photo-item:not(.photo-skeleton-only)')) return; // 完整结果(真实照片, 不是占位骨架)已经先画出来了,不用管
      if (Array.isArray(d.photos) && d.photos.length) {
        state.photos = d.photos;
        state.total  = d.total || d.photos.length;
        renderGrid(d.photos, true);
        updateStats();
      }
    }).catch(() => {});
  }

  try {
    const r = await fetch(url);
    const { photos, total } = await r.json();
    if (_myGen !== _photoLoadGen) return;   // 视图已经又切换了, 这批过期结果不再处理(finally里还是会收尾loading状态)
    state.total   = total;
    // reset: 这次是全新第1页, 不跟(可能来自缓存/peek渲染的)旧state.photos.length叠加; 翻页仍按原逻辑累加
    state.hasMore = reset ? (photos.length < total) : (state.photos.length + photos.length < total);
    state.page++;
    if (reset) {
      state.photos = photos; renderGrid(photos, true);
      if (_cacheKey) LocalCache.set(_cacheKey, { photos: photos.slice(0, _screenPhotoCount()), total });
    } else { state.photos.push(...photos); renderGrid(photos, false); }
    updateStats();
  } catch(e) { console.error('加载失败', e); }
  finally    { if (_myGen === _photoLoadGen) { state.loading = false; showSpinner(false); } }
}

function _parseTags(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  return [];
}
function _dirFull(p) {
  if (p.dir) return String(p.dir).replace(/\\/g, '/');
  if (p.path) return String(p.path).replace(/\\/g, '/').replace(/\/[^/]+$/, '');
  return '';
}
function _dirName(p) {
  const d = _dirFull(p);
  if (!d) return '';
  return d.split('/').filter(Boolean).slice(-2).join('/');
}
function jumpToDir(e, dir) {
  e.stopPropagation();
  if (!dir) return;
  clearSearchQuery();
  state.filter.dirPath = dir;
  loadPhotos(true);
}

// 缩略图提前预取: 比原生loading="lazy"更激进(rootMargin提前800px开始加载),
// 快速滚动时缩略图基本已经在到达视口前就加载好了。
const _thumbObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const img = entry.target;
    if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute('data-src'); }
    _thumbObserver.unobserve(img);
  });
}, { rootMargin: '800px 0px' });

function renderGrid(photos, clear) {
  const grid = document.getElementById('photo-grid');
  if (clear) grid.innerHTML = '';

  photos.forEach((p, i) => {
    const idx      = clear ? i : state.photos.length - photos.length + i;
    const item     = document.createElement('div');
    item.className = 'photo-item';
    item.dataset.idx = idx;
    // 鼠标移到其他图片时自动关闭右键菜单
    item.onmouseenter = function() { ctxMenu.hide(); };
    const tags     = [..._parseTags(p.user_tags), ..._parseTags(p.ai_tags)].slice(0,3);
    const favClass = p.favorite ? 'active' : '';

    // 占位框用真实宽高提前撑开(数据库本来就存了), 没加载出来之前就是一个跟最终图片
    // 差不多大小的骨架框, 不会"缩成一条缝、图片一起炸出来"; 拿不到宽高就退回4:3兜底比例。
    const ratio = (p.width && p.height) ? `${p.width}/${p.height}` : '4/3';
    item.innerHTML = `
      <img data-src="${p.thumb_path ? '/thumbs2/' + _relUnder(p.thumb_path, 'thumbs') : ''}"
          class="loading" alt="" style="aspect-ratio:${ratio}"
          onload="this.classList.remove('loading');this.classList.add('loaded')"
          onerror="this.src=''">
      <div class="photo-overlay">
        <div class="photo-info">${formatDate(p.exif_time || p.mtime)}</div>
        ${(function(){var dn=_dirName(p);return dn?'<div class="photo-dir" onclick="jumpToDir(event,\''+escJs(_dirFull(p))+'\')">📁 '+escHtml(dn)+'</div>':'';})()}
        ${tags.length ? `<div class="photo-tags">${tags.map(t=>`<span class="photo-tag">${escHtml(t)}</span>`).join('')}</div>` : ''}
      </div>
      <button class="fav-btn ${favClass}" onclick="toggleFav(event,${p.id})">${p.favorite?'❤️':'🤍'}</button>`;

    item.addEventListener('click', () => openViewer(idx));
    item.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const photo = state.photos[idx];
      ctxMenu.show(e.clientX, e.clientY, [
        { icon: "👁",  text: "预览",         action: () => openViewer(idx) },
        { icon: "▶",  text: "重新处理",       action: () => reprocessPhoto(photo.id) },
        { sep: true },
        { icon: "🏷",  text: "编辑标签",      action: () => addTagModal(photo.md5) },
        { icon: "❤️", text: photo.favorite ? "取消收藏" : "收藏", action: () => toggleFav(e, photo.id) },
        { sep: true },
        { icon: "🗑",  text: "彻底删除（含原文件）",    action: () => deletePhoto(photo.id), danger: true },
      ]);
    });
    grid.appendChild(item);
    const img = item.querySelector('img[data-src]');
    if (img) _thumbObserver.observe(img);
  });
}

// ── 无限滚动 ──────────────────────────────────────────
function setupIntersectionObserver() {
  const ob = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && state.hasMore) loadPhotos();
  }, { rootMargin: '200px' });
  ob.observe(document.getElementById('sentinel'));
}

// ── 预览器 ────────────────────────────────────────────
function openViewer(idx) {
  state.viewer.index = idx;
  resetViewerTransform();
  showViewerPhoto();
  document.getElementById('viewer').classList.add('show');
  document.body.style.overflow = 'hidden';
  if (state.music.mode === 'auto' && !state.music.playing) playMusic();
}

function closeViewer() {
  setTimeout(_saveBrowseState, 100);
  document.getElementById('viewer').classList.remove('show');
  document.body.style.overflow = '';
  stopSlideshow();
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
}

const _preloadCache = new Map();
let _loadToken = 0;
// thumb_path/preview_path存的是"thumbs/preview"这层往下的相对路径(可能带分片子目录,
// 也可能是老数据还没分片、直接就是文件名),这里统一只去掉最外层那个固定前缀,不要用
// split('/').pop()只取文件名——那样会把分片子目录(md5前2位)也一起丢掉,分片后的图会404。
function _relUnder(p, prefix) {
  return p.replace(new RegExp('^' + prefix + '[\\\\/]'), '');
}
function photoSrc(photo) {
  if (!photo) return "";
  const isPc = /^[A-Za-z]:/.test(photo.path);
  return photo.preview_path
    ? "/preview/" + _relUnder(photo.preview_path, 'preview')
    : (isPc ? "/api/pc/file/" + encodeURIComponent(photo.path) : "/original" + photo.path);
}
function preloadNeighbors(idx) {
  [idx - 1, idx + 1, idx + 2].forEach(function (i) {
    const ph = state.photos[i];
    if (!ph) return;
    const src = photoSrc(ph);
    if (!src || _preloadCache.has(src)) return;
    const im = new Image();
    im.src = src;
    _preloadCache.set(src, im);
    if (_preloadCache.size > 30) _preloadCache.delete(_preloadCache.keys().next().value);
  });
}

// ── 幻灯片转场 ────────────────────────────────────────
let _transMode = localStorage.getItem("transMode") || "fade";
const TRANS_MODES = [["none","无"],["fade","淡入淡出"],["slide","滑动"],["zoom","缩放"],["kenburns","Ken Burns"]];
function setTransMode(m) {
  _transMode = m;
  localStorage.setItem("transMode", m);
  const sel = document.getElementById("trans-mode-sel");
  if (sel) sel.value = m;
}
const TRANS_OUT = {
  fade:      { o:0 },
  slide:     { o:0, t:"translateX(-320px)" },
  slideup:   { o:0, t:"translateY(-260px)" },
  slidedown: { o:0, t:"translateY(260px)" },
  zoom:      { o:0, t:"scale(.6)" },
  zoomout:   { o:0, t:"scale(1.5)" },
  rotate:    { o:0, t:"rotate(-12deg) scale(.75)" },
  flip:      { o:0, t:"perspective(1200px) rotateY(75deg)" },
  flipx:     { o:0, t:"perspective(1200px) rotateX(75deg)" },
  blur:      { o:0, f:"blur(18px)" },
  kenburns:  { o:0 },
  swing:     { o:0, t:"rotate(8deg) translateX(-200px)" }
};
const TRANS_IN = {
  fade:      { t:"none" },
  slide:     { t:"translateX(320px)" },
  slideup:   { t:"translateY(260px)" },
  slidedown: { t:"translateY(-260px)" },
  zoom:      { t:"scale(1.45)" },
  zoomout:   { t:"scale(.65)" },
  rotate:    { t:"rotate(12deg) scale(1.3)" },
  flip:      { t:"perspective(1200px) rotateY(-75deg)" },
  flipx:     { t:"perspective(1200px) rotateX(-75deg)" },
  blur:      { t:"none", f:"blur(18px)" },
  kenburns:  { t:"none" },
  swing:     { t:"rotate(-8deg) translateX(200px)" }
};
const DUAL_MODES = ["dissolve", "mosaic", "tv", "wipe", "circle", "blinds"];
function swapPhoto(img, src) {
  let mode = _transMode;
  const wrap = document.getElementById("viewer-img-wrap");
  if (mode === "none" || !img || !wrap) { img.src = src; return; }

  if (!state.slideshow.active) {
    img.src = src;
    img.classList.remove("kb-anim");
    wrap.style.transition = "none";
    wrap.style.opacity   = "1";
    wrap.style.transform = "none";
    wrap.style.filter    = "none";
    var _oi = document.getElementById("viewer-img-old");
    if (_oi) {
      _oi.style.animation = "none";
      _oi.style.opacity   = "0";
      _oi.removeAttribute("src");
    }
    return;
  }
  if (mode === "random") {
    const keys = Object.keys(TRANS_OUT).concat(DUAL_MODES);
    mode = keys[Math.floor(Math.random() * keys.length)];
  }

  const run = function () {
    if (DUAL_MODES.indexOf(mode) >= 0) { runDualTrans(img, src, mode); return; }
    runSingleTrans(img, src, mode, wrap);
  };

  const pre = _preloadCache.get(src);
  if (pre && pre.complete && pre.naturalWidth) { run(); }
  else {
    const tmp = new Image();
    tmp.onload = run; tmp.onerror = run; tmp.src = src;
    _preloadCache.set(src, tmp);
  }
}

function runSingleTrans(img, src, mode, wrap) {
  const OUT = 400, IN = 750;
  const co = TRANS_OUT[mode] || TRANS_OUT.fade;
  const ci = TRANS_IN[mode] || TRANS_IN.fade;
  wrap.style.transition = "opacity .4s ease, transform .4s ease, filter .4s ease";
  wrap.style.opacity = "0";
  if (co.t) wrap.style.transform = co.t;
  if (co.f) wrap.style.filter = co.f;
  setTimeout(function () {
    img.src = src;
    img.classList.remove("kb-anim");
    if (mode === "kenburns") { void img.offsetWidth; img.classList.add("kb-anim"); }
    wrap.style.transition = "none";
    wrap.style.transform = ci.t || "none";
    if (ci.f) wrap.style.filter = ci.f;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        wrap.style.transition = "opacity " + (IN/1000) + "s ease, transform " + (IN/1000) + "s cubic-bezier(.22,.61,.36,1), filter " + (IN/1000) + "s ease";
        wrap.style.opacity = "1";
        wrap.style.transform = "none";
        wrap.style.filter = "none";
      });
    });
  }, OUT);
}

function runDualTrans(img, src, mode) {
  const oldImg = document.getElementById("viewer-img-old");
  if (!oldImg) { img.src = src; return; }
  const wrapEl = img.parentElement;
  const wrapR = wrapEl.getBoundingClientRect();
  const r = img.getBoundingClientRect();

  oldImg.src = img.src;
  oldImg.className = "";
  oldImg.style.cssText = "position:absolute;pointer-events:none;z-index:2;object-fit:contain;opacity:1;" +
    "left:" + (r.left - wrapR.left) + "px;top:" + (r.top - wrapR.top) + "px;" +
    "width:" + r.width + "px;height:" + r.height + "px;margin:0;max-width:none;max-height:none;";
  void oldImg.offsetWidth;

  img.style.transition = "none";
  img.src = src;
  const settle = function () {
    img.style.transition = "width .75s cubic-bezier(.22,.61,.36,1), height .75s cubic-bezier(.22,.61,.36,1)";
    img.style.width = ""; img.style.height = ""; img.style.maxWidth = ""; img.style.maxHeight = "";
    setTimeout(function () { img.style.transition = ""; }, 800);
  };
  requestAnimationFrame(function () { requestAnimationFrame(settle); });

  const done = function () {
    oldImg.style.cssText = "position:absolute;top:0;left:0;right:0;bottom:0;margin:auto;pointer-events:none;opacity:0;z-index:2";
    oldImg.style.animation = "none";
    oldImg.removeAttribute("src");
  };
  const anim = {
    dissolve: ["", 900],
    mosaic:   ["trMosaic 1s steps(12) forwards", 1050],
    tv:       ["trTv .55s ease-in forwards", 600],
    wipe:     ["trWipe .8s ease-in-out forwards", 850],
    circle:   ["trCircle .9s ease-in-out forwards", 950],
    blinds:   ["trBlinds .9s ease-in-out forwards", 950]
  }[mode] || ["", 900];

  if (mode === "dissolve") {
    oldImg.style.transition = "opacity .9s ease";
    requestAnimationFrame(function () { oldImg.style.opacity = "0"; });
  } else {
    oldImg.style.animation = anim[0];
  }
  setTimeout(done, anim[1] + 60);
}

function showViewerPhoto() {
  clearTimeout(window._vwTimer);
  window._vwTimer = setTimeout(_saveBrowseState, 400);
  const photo = state.photos[state.viewer.index];
  if (!photo) return;

  const img = document.getElementById('viewer-img');
  img.dataset.mode = 'preview';
  const _src = photoSrc(photo);
  const _token = ++_loadToken;
  preloadNeighbors(state.viewer.index);
  const spinner = document.getElementById('viewer-spinner');
  const _cached = _preloadCache.get(_src);
  if (_cached && _cached.complete && _cached.naturalWidth) {
    if (spinner) spinner.classList.remove('show');
    swapPhoto(img, _src);
  } else {
    // 没被预加载过, 真的要等下载: 之前这段时间里viewer-img还是上一张/空白, 完全没有反馈,
    // 补个转圈, 图下载完(或失败)了就收起来。
    if (spinner) spinner.classList.add('show');
    const _tmp = new Image();
    _tmp.onload = function () { if (_token === _loadToken) { if (spinner) spinner.classList.remove('show'); swapPhoto(img, _src); } };
    _tmp.onerror = function () { if (_token === _loadToken) { if (spinner) spinner.classList.remove('show'); swapPhoto(img, _src); } };
    _tmp.src = _src;
    _preloadCache.set(_src, _tmp);
  }

  document.getElementById('viewer-filename').textContent = photo.path.split('/').pop();
  document.getElementById('viewer-dims').textContent     = photo.width && photo.height ? `${photo.width}×${photo.height}` : '-';
  document.getElementById('viewer-size').textContent     = formatSize(photo.size);
  document.getElementById('viewer-camera').textContent   = photo.exif_camera || '-';
  document.getElementById('viewer-date').textContent     = photo.exif_time ? formatDate(photo.exif_time) : '-';
  document.getElementById('viewer-ai').textContent       = photo.ai_desc || '暂无AI描述';
  const gpsEl = document.getElementById('viewer-gps');
  if (gpsEl) gpsEl.textContent = photo.exif_gps ? photo.exif_gps : '-';
  const pathEl = document.getElementById('viewer-path');
  if (pathEl) { pathEl.textContent = photo.path; _viPathSetup(pathEl, photo.path); }

  renderViewerTags(photo);
  renderViewerRating(photo);
  updateViewerNav();
}

let tagThreshold = parseFloat(localStorage.getItem('tagThreshold') || '0');
document.addEventListener('DOMContentLoaded', () => {
  const sl = document.getElementById('tag-threshold-slider');
  const lab = document.getElementById('tag-threshold-val');
  if (sl) sl.value = tagThreshold;
  if (lab) lab.textContent = Math.round(tagThreshold * 100) + '%';
});
function setTagThreshold(v) {
  tagThreshold = parseFloat(v) || 0;
  localStorage.setItem('tagThreshold', String(tagThreshold));
  const lab = document.getElementById('tag-threshold-val');
  if (lab) lab.textContent = Math.round(tagThreshold * 100) + '%';
  document.querySelectorAll('.photo-tags[data-md5]').forEach(el => { delete el.dataset.loaded; });
  if (typeof refreshGridTags === 'function') refreshGridTags();
  const cur = state.photos[state.viewer.index];
  if (cur && document.getElementById('viewer').classList.contains('show')) renderViewerTags(cur);
  loadTags();
  if (aiTagsLoaded) loadAiTagBar();
}
function filterTagsByThreshold(tags) {
  return (tags || []).filter(t => t.source === 'manual' || (t.nscore ?? 1) >= tagThreshold);
}

async function loadPhotoTags(md5) {
  try {
    const r = await fetch('/api/photo-tags?md5=' + md5).then(r => r.json());
    return filterTagsByThreshold(r.tags);
  } catch (e) { return []; }
}

const TAG_COLORS = { clip: '#40d0ff', vlm: '#3ddc84', 'vlm-open': '#3ddc84', manual: '#ffa500' };

// ── 图片滤镜(仅预览) ──────────────────────────────────
let _imgFilter = { brightness: 100, contrast: 100, saturate: 100, sepia: 0, grayscale: 0, blur: 0, hueRotate: 0, invert: 0 };
const FILTER_PRESETS = {
  '原图':   { brightness:100, contrast:100, saturate:100, sepia:0, grayscale:0, blur:0, hueRotate:0, invert:0 },
  '黑白':   { brightness:100, contrast:110, saturate:0,   sepia:0, grayscale:100, blur:0, hueRotate:0, invert:0 },
  '复古':   { brightness:105, contrast:95,  saturate:80,  sepia:45, grayscale:0, blur:0, hueRotate:0, invert:0 },
  '冷调':   { brightness:100, contrast:105, saturate:110, sepia:0, grayscale:0, blur:0, hueRotate:180, invert:0 },
  '暖调':   { brightness:105, contrast:100, saturate:120, sepia:25, grayscale:0, blur:0, hueRotate:0, invert:0 },
  '高对比': { brightness:100, contrast:150, saturate:115, sepia:0, grayscale:0, blur:0, hueRotate:0, invert:0 },
  '柔和':   { brightness:105, contrast:90,  saturate:95,  sepia:10, grayscale:0, blur:0.5, hueRotate:0, invert:0 },
  '夜间':   { brightness:70,  contrast:95,  saturate:85,  sepia:15, grayscale:0, blur:0, hueRotate:0, invert:0 },
  '鲜艳':   { brightness:105, contrast:115, saturate:175, sepia:0, grayscale:0, blur:0, hueRotate:0, invert:0 },
  '浓郁':   { brightness:95,  contrast:130, saturate:150, sepia:5,  grayscale:0, blur:0, hueRotate:0, invert:0 },
  '冷淡':   { brightness:103, contrast:92,  saturate:55,  sepia:8,  grayscale:0, blur:0, hueRotate:200, invert:0 },
  '清透':   { brightness:112, contrast:88,  saturate:90,  sepia:0,  grayscale:0, blur:0, hueRotate:190, invert:0 },
  '肤色':   { brightness:107, contrast:96,  saturate:115, sepia:18, grayscale:0, blur:0, hueRotate:355, invert:0 },
  '奶油':   { brightness:110, contrast:90,  saturate:105, sepia:28, grayscale:0, blur:0.3, hueRotate:5, invert:0 },
  '感性':   { brightness:96,  contrast:118, saturate:88,  sepia:32, grayscale:0, blur:0.4, hueRotate:350, invert:0 },
  '胶片':   { brightness:98,  contrast:112, saturate:92,  sepia:22, grayscale:0, blur:0, hueRotate:8, invert:0 },
  '青橙':   { brightness:102, contrast:120, saturate:130, sepia:12, grayscale:0, blur:0, hueRotate:15, invert:0 },
  '日系':   { brightness:115, contrast:85,  saturate:85,  sepia:12, grayscale:0, blur:0, hueRotate:0, invert:0 },
  '暗调':   { brightness:82,  contrast:125, saturate:95,  sepia:10, grayscale:0, blur:0, hueRotate:0, invert:0 },
  '梦幻':   { brightness:108, contrast:88,  saturate:120, sepia:5,  grayscale:0, blur:0.8, hueRotate:320, invert:0 },
  '反色':   { brightness:100, contrast:100, saturate:100, sepia:0, grayscale:0, blur:0, hueRotate:0, invert:100 }
};

function filterCss(f) {
  return 'brightness(' + f.brightness + '%) contrast(' + f.contrast + '%) saturate(' + f.saturate + '%) sepia(' + f.sepia + '%) grayscale(' + f.grayscale + '%) blur(' + f.blur + 'px) hue-rotate(' + f.hueRotate + 'deg) invert(' + f.invert + '%)';
}

let _lastFilterCss = null;
function applyImgFilter() {
  const css = filterCss(_imgFilter);
  const img = document.getElementById('viewer-img');
  if (img && _lastFilterCss !== css) {
    img.style.filter = css;
    _lastFilterCss = css;
    try { localStorage.setItem('imgFilter', JSON.stringify(_imgFilter)); } catch (e) {}
  }
}

function applyFilterPreset(name) {
  const pre = FILTER_PRESETS[name];
  if (!pre) return;
  _imgFilter = Object.assign({}, pre);
  _imgFilter._preset = name;
  applyImgFilter();
  renderFilterPanel();
}

function setFilterVal(key, v) {
  _imgFilter[key] = parseFloat(v);
  _imgFilter._preset = '自定义';
  const lab = document.getElementById('flt-val-' + key);
  if (lab) lab.textContent = v + (key === 'blur' ? 'px' : (key === 'hueRotate' ? '°' : '%'));
  applyImgFilter();
}

function toggleFilterPanel() {
  let panel = document.getElementById('filter-panel');
  if (panel) { panel.remove(); return; }
  panel = document.createElement('div');
  panel.id = 'filter-panel';
  panel.style.cssText = 'position:fixed;right:20px;top:80px;z-index:3000;background:#161d28;border:1px solid #2a3d55;border-radius:12px;padding:16px 18px;width:290px;box-shadow:0 8px 32px rgba(0,0,0,.5);max-height:76vh;overflow:auto';
  document.body.appendChild(panel);
  renderFilterPanel();
}

function renderFilterPanel() {
  const panel = document.getElementById('filter-panel');
  if (!panel) return;
  const cur = _imgFilter._preset || '自定义';
  const presets = Object.keys(FILTER_PRESETS).map(function (n) {
    const on = n === cur;
    return '<button onclick="applyFilterPreset(\'' + n + '\')" style="padding:4px 9px;border-radius:5px;font-size:.72rem;cursor:pointer;' +
      (on ? 'background:#40d0ff;color:#000;border:none;font-weight:700' : 'background:transparent;color:#8aa8c8;border:1px solid #2a3d55') + '">' + n + '</button>';
  }).join('');
  const sliders = [
    ['brightness', '亮度', 0, 200, 1, '%'],
    ['contrast', '对比度', 0, 200, 1, '%'],
    ['saturate', '饱和度', 0, 200, 1, '%'],
    ['sepia', '怀旧', 0, 100, 1, '%'],
    ['grayscale', '去色', 0, 100, 1, '%'],
    ['hueRotate', '色相', 0, 360, 1, '°'],
    ['blur', '模糊', 0, 5, 0.1, 'px'],
    ['invert', '反色', 0, 100, 1, '%']
  ].map(function (b) {
    return '<div style="margin-bottom:9px">' +
      '<div style="display:flex;justify-content:space-between;font-size:.7rem;color:#8aa8c8;margin-bottom:2px">' +
      '<span>' + b[1] + '</span><span id="flt-val-' + b[0] + '" style="color:#40d0ff">' + _imgFilter[b[0]] + b[5] + '</span></div>' +
      '<input type="range" min="' + b[2] + '" max="' + b[3] + '" step="' + b[4] + '" value="' + _imgFilter[b[0]] + '" ' +
      'oninput="setFilterVal(\'' + b[0] + '\', this.value)" style="width:100%;accent-color:#40d0ff">' +
      '</div>';
  }).join('');
  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
      '<span style="font-size:.86rem;font-weight:700;color:#f0f6ff">🎨 滤镜</span>' +
      '<span onclick="document.getElementById(\'filter-panel\').remove()" style="cursor:pointer;color:#8aa8c8">✕</span>' +
    '</div>' +
    '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:14px">' + presets + '</div>' +
    sliders +
    '<button onclick="applyFilterPreset(\'原图\')" style="width:100%;margin-top:6px;padding:7px;border-radius:6px;background:transparent;border:1px solid #2a3d55;color:#8aa8c8;cursor:pointer;font-size:.76rem">重置</button>';
}

try {
  const _sf = JSON.parse(localStorage.getItem('imgFilter') || 'null');
  if (_sf) _imgFilter = _sf;
} catch (e) {}

function renderViewerTags(photo) {
  const container = document.getElementById('viewer-tags');
  if (!photo.md5) {
    container.innerHTML = '<span class="viewer-tag vt-placeholder" style="border-color:#2a3d55;color:#507090">(无md5, 不支持标签)</span>';
    return;
  }
  container.innerHTML = '<span class="viewer-tag vt-placeholder" style="visibility:hidden">加载标签</span>';
  loadPhotoTags(photo.md5).then(tags => {
    const cur = state.photos[state.viewer.index];
    if (!cur || cur.md5 !== photo.md5) return;
    const html = tags.map(t => {
      const c = TAG_COLORS[t.source] || '#8aa8c8';
      const title = t.source + (t.source !== 'manual' ? (' ' + (t.score||0).toFixed(3)) : '');
      return `<span class="viewer-tag" style="border-color:${c};color:${c}" title="${title}">` +
        `<span onclick="filterByTag('${escJs(t.tag)}')" style="cursor:pointer">${escHtml(t.tag)}</span>` +
        `<span onclick="removePhotoTag('${photo.md5}','${escJs(t.tag)}','${t.source}')" style="cursor:pointer;margin-left:5px;opacity:.6">×</span>` +
      `</span>`;
    }).join('');
    container.innerHTML = html + `<span class="viewer-tag add-tag" onclick="addTagModal('${photo.md5}')">＋ 标签</span>`;
  });
}

async function removePhotoTag(md5, tag, source) {
  try {
    await fetch('/api/photo-tags/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ md5, tag, source })
    });
    const cur = state.photos[state.viewer.index];
    if (cur && cur.md5 === md5) renderViewerTags(cur);
    showToast('已删除标签: ' + tag);
  } catch (e) { showToast('删除失败: ' + e.message); }
}

function makeDraggable(box, handle) {
  let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
  handle.style.cursor = 'move';
  handle.addEventListener('mousedown', e => {
    dragging = true;
    sx = e.clientX; sy = e.clientY;
    const r = box.getBoundingClientRect();
    ox = r.left; oy = r.top;
    box.style.position = 'fixed';
    box.style.margin = '0';
    box.style.left = ox + 'px';
    box.style.top = oy + 'px';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    box.style.left = (ox + e.clientX - sx) + 'px';
    box.style.top = (oy + e.clientY - sy) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; });
}

function addTagModal(md5) {
  document.getElementById('add-tag-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'add-tag-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2000;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `<div style="background:#161d28;border:1px solid #2a3d55;border-radius:12px;padding:20px 24px;min-width:340px;max-width:440px">
    <div id="tag-panel-title" style="font-size:.9rem;font-weight:700;color:#f0f6ff;margin-bottom:12px;user-select:none">🏷 标签管理 <span style="font-size:.68rem;color:#507090;font-weight:400">(可拖动)</span></div>
    <div id="tag-panel-list" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;min-height:28px">
      <span style="font-size:.72rem;color:#507090">加载中...</span>
    </div>
    <input id="add-tag-input" style="width:100%;background:#0f1620;border:1px solid #263548;border-radius:6px;color:#f0f6ff;padding:8px 10px;font-size:.85rem" placeholder="输入新标签, 回车添加">
    <div style="display:flex;gap:8px;margin-top:14px">
      <button onclick="submitAddTag('${md5}')" style="flex:1;padding:8px;border-radius:6px;background:#40d0ff;color:#000;border:none;cursor:pointer;font-weight:700">添加</button>
      <button onclick="document.getElementById('add-tag-modal').remove()" style="flex:1;padding:8px;border-radius:6px;background:transparent;color:#8aa8c8;border:1px solid #2a3d55;cursor:pointer">关闭</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  const panelBox = modal.firstElementChild;
  makeDraggable(panelBox, document.getElementById('tag-panel-title'));
  renderTagPanel(md5);
  const inp = document.getElementById('add-tag-input');
  inp.focus();
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') submitAddTag(md5); });
}

async function renderTagPanel(md5) {
  const list = document.getElementById('tag-panel-list');
  if (!list) return;
  let tags = [];
  try { const r = await fetch('/api/photo-tags?md5=' + md5).then(r => r.json()); tags = r.tags || []; } catch (e) {}
  if (!tags.length) { list.innerHTML = '<span style="font-size:.72rem;color:#507090">(暂无标签)</span>'; return; }
  list.innerHTML = tags.map(t => {
    const c = TAG_COLORS[t.source] || '#8aa8c8';
    return `<span class="viewer-tag" title="${t.source} n=${(t.nscore??1).toFixed(2)}" style="border-color:${c};color:${c};opacity:${t.source!=='manual'&&(t.nscore??1)<tagThreshold?.35:1}">${escHtml(t.tag)}` +
      `<span onclick="panelRemoveTag('${md5}','${escJs(t.tag)}','${t.source}')" style="cursor:pointer;margin-left:5px;opacity:.6">×</span></span>`;
  }).join('');
}

async function panelRemoveTag(md5, tag, source) {
  await fetch('/api/photo-tags/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ md5, tag, source })
  });
  renderTagPanel(md5);
  const cur = state.photos[state.viewer.index];
  if (cur && cur.md5 === md5) renderViewerTags(cur);
  if (typeof refreshGridTags === 'function') refreshGridTags([md5]);
}

async function submitAddTag(md5) {
  const inp = document.getElementById('add-tag-input');
  const tag = (inp?.value || '').trim();
  if (!tag) return;
  try {
    await fetch('/api/photo-tags/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ md5, tag })
    });
    const inp2 = document.getElementById('add-tag-input');
    if (inp2) inp2.value = '';
    renderTagPanel(md5);
    const cur = state.photos[state.viewer.index];
    if (cur && cur.md5 === md5) renderViewerTags(cur);
    if (typeof refreshGridTags === 'function') refreshGridTags([md5]);
    showToast('已添加标签: ' + tag);
  } catch (e) { showToast('添加失败: ' + e.message); }
}

function updateViewerNav() {
  const idx   = state.viewer.index;
  const total = state.photos.length;
  document.getElementById('viewer-counter').textContent = `${idx+1} / ${state.total}`;
  document.getElementById('btn-prev').style.opacity = idx > 0 ? '1' : '0.3';
  document.getElementById('btn-next').style.opacity = idx < total-1 || state.hasMore ? '1' : '0.3';
}

function viewerPrev() {
  if (state.viewer.index > 0) { state.viewer.index--; resetViewerTransform(); showViewerPhoto(); }
}

function viewerNext() {
  if (state.viewer.index < state.photos.length - 1) {
    state.viewer.index++;
    resetViewerTransform();
    showViewerPhoto();
    if (state.viewer.index > state.photos.length - 10) loadPhotos();
  }
}

// ── 缩放拖拽 ──────────────────────────────────────────
function setupViewer() {
  const wrap = document.getElementById('viewer-img-wrap');
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const oldZoom = state.viewer.zoom;
    const newZoom = Math.max(0.5, Math.min(10, oldZoom * delta));
    if (newZoom === oldZoom) return;
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - (rect.left + rect.width / 2);
    const my = e.clientY - (rect.top + rect.height / 2);
    const ratio = newZoom / oldZoom;
    state.viewer.panX = mx - (mx - state.viewer.panX) * ratio;
    state.viewer.panY = my - (my - state.viewer.panY) * ratio;
    state.viewer.zoom = newZoom;
    applyTransform();
    showZoomIndicator();
  }, { passive: false });
  wrap.addEventListener('dblclick', (e) => {
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - (rect.left + rect.width / 2);
    const my = e.clientY - (rect.top + rect.height / 2);
    const oldZoom = state.viewer.zoom;
    const newZoom = Math.min(10, oldZoom * 1.8);
    if (newZoom === oldZoom) return;
    const ratio = newZoom / oldZoom;
    state.viewer.panX = mx - (mx - state.viewer.panX) * ratio;
    state.viewer.panY = my - (my - state.viewer.panY) * ratio;
    state.viewer.zoom = newZoom;
    applyTransform();
    showZoomIndicator();
  });
  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (state.viewer.zoom <= 1.01) return;
    e.preventDefault();
    state.viewer.dragging = true;
    state.viewer.lastX    = e.clientX;
    state.viewer.lastY    = e.clientY;
    wrap.classList.add('dragging');
  });
  window.addEventListener('mousemove', (e) => {
    if (!state.viewer.dragging) return;
    state.viewer.panX += e.clientX - state.viewer.lastX;
    state.viewer.panY += e.clientY - state.viewer.lastY;
    state.viewer.lastX = e.clientX;
    state.viewer.lastY = e.clientY;
    applyTransform();
  });
  window.addEventListener('mouseup', () => {
    state.viewer.dragging = false;
    wrap.classList.remove('dragging');
  });

  let lastDist = 0, pinchCX = 0, pinchCY = 0, oneX = 0, oneY = 0, touchMode = 0;
  function centerOf(t0, t1, rect) {
    return {
      x: (t0.clientX + t1.clientX) / 2 - (rect.left + rect.width / 2),
      y: (t0.clientY + t1.clientY) / 2 - (rect.top + rect.height / 2)
    };
  }
  wrap.addEventListener('touchstart', (e) => {
    const rect = wrap.getBoundingClientRect();
    if (e.touches.length === 2) {
      touchMode = 2;
      lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const c = centerOf(e.touches[0], e.touches[1], rect);
      pinchCX = c.x; pinchCY = c.y;
    } else if (e.touches.length === 1) {
      touchMode = 1;
      oneX = e.touches[0].clientX; oneY = e.touches[0].clientY;
    }
  }, { passive: true });
  wrap.addEventListener('touchmove', (e) => {
    const rect = wrap.getBoundingClientRect();
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const c = centerOf(e.touches[0], e.touches[1], rect);
      const oldZoom = state.viewer.zoom;
      const newZoom = Math.max(0.5, Math.min(10, oldZoom * (dist / (lastDist || dist))));
      const ratio = newZoom / oldZoom;
      state.viewer.panX = c.x - (pinchCX - state.viewer.panX) * ratio;
      state.viewer.panY = c.y - (pinchCY - state.viewer.panY) * ratio;
      state.viewer.zoom = newZoom;
      lastDist = dist; pinchCX = c.x; pinchCY = c.y;
      applyTransform(); showZoomIndicator();
    } else if (e.touches.length === 1 && touchMode === 1 && state.viewer.zoom > 1.01) {
      e.preventDefault();
      state.viewer.panX += e.touches[0].clientX - oneX;
      state.viewer.panY += e.touches[0].clientY - oneY;
      oneX = e.touches[0].clientX; oneY = e.touches[0].clientY;
      applyTransform();
    }
  }, { passive: false });
  wrap.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) touchMode = 0;
    else if (e.touches.length === 1) {
      touchMode = 1;
      oneX = e.touches[0].clientX; oneY = e.touches[0].clientY;
    }
  }, { passive: true });
}

function applyTransform() {
  const img   = document.getElementById('viewer-img');
  const photo = state.photos[state.viewer.index];
  img.style.transition = 'none';
  img.style.transform  = `translate(${state.viewer.panX}px, ${state.viewer.panY}px) scale(${state.viewer.zoom})`;

  const isPcPath = photo && /^[A-Za-z]:/.test(photo.path);
  const getOrigSrc = (ph) => isPcPath ? `/api/pc/file/${encodeURIComponent(ph.path)}` : `/original${ph.path}`;
  if (state.viewer.zoom > 2 && photo && img.dataset.mode !== 'original') {
    img.dataset.mode = 'original';
    const src = getOrigSrc(photo);
    const currentId = photo.id;
    const tmp = new Image();
    tmp.onload = () => {
      const curPhoto = state.photos[state.viewer.index];
      if (curPhoto && curPhoto.id === currentId) { img.src = src; img.dataset.mode = 'original'; }
    };
    tmp.src = src;
  } else if (state.viewer.zoom <= 2 && img.dataset.mode === 'original') {
    img.dataset.mode = 'preview';
    if (photo) img.src = photo.preview_path ? `/preview/${_relUnder(photo.preview_path, 'preview')}` : getOrigSrc(photo);
  }
}

function resetViewerTransform() {
  state.viewer.zoom = 1; state.viewer.panX = 0; state.viewer.panY = 0;
  const img = document.getElementById('viewer-img');
  if (img) { img.style.transition = 'none'; applyTransform(); }
}

function showZoomIndicator() {
  const el = document.getElementById('zoom-indicator');
  el.textContent = Math.round(state.viewer.zoom * 100) + '%';
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 1500);
}

// ── 幻灯片 ────────────────────────────────────────────
let _wakeLock = null;
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) { console.log('浏览器不支持Wake Lock'); return; }
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
    console.log('已阻止息屏');
  } catch (e) { console.log('Wake Lock失败:', e.message); }
}
async function releaseWakeLock() {
  try { if (_wakeLock) { await _wakeLock.release(); _wakeLock = null; console.log('已恢复息屏'); } } catch (e) {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.slideshow.active && !_wakeLock) acquireWakeLock();
});

function toggleSlideshow() {
  state.slideshow.active ? stopSlideshow() : startSlideshow();
}

function startSlideshow() {
  state.slideshow.active = true;
  acquireWakeLock();
  document.getElementById('btn-slideshow').textContent = '⏸ 幻灯片';
  document.getElementById('btn-slideshow').classList.add('active');
  state.slideshow.timer = setInterval(() => viewerNext(), state.slideshow.interval);
  if (!state.music.playing) playMusic();
  const chk = document.getElementById('slideshow-fullscreen');
  if (chk && chk.checked) {
    const el = document.getElementById('viewer');
    if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  }
}

function stopSlideshow() {
  state.slideshow.active = false;
  releaseWakeLock();
  document.getElementById('btn-slideshow').textContent = '▶ 幻灯片';
  document.getElementById('btn-slideshow').classList.remove('active');
  clearInterval(state.slideshow.timer);
}

document.addEventListener('fullscreenchange', () => {
  const header = document.querySelector('.viewer-header');
  const footer = document.querySelector('.viewer-footer');
  const isFs   = !!document.fullscreenElement;
  if (header) header.style.display = isFs ? 'none' : '';
  if (footer) footer.style.display = isFs ? 'none' : '';
  if (!isFs && state.slideshow.active) {
    clearInterval(state.slideshow.timer);
    state.slideshow.active = false;
    document.getElementById('btn-slideshow').textContent = '▶ 幻灯片';
    document.getElementById('btn-slideshow').classList.remove('active');
  }
});

// ── 键盘 ──────────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('viewer').classList.contains('show')) return;
    switch(e.key) {
      case 'ArrowLeft':  viewerPrev(); break;
      case 'ArrowRight': viewerNext(); break;
      case 'Escape':
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          if (document.exitFullscreen) document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } else {
          closeViewer();
        }
        break;
      case ' ':          e.preventDefault(); toggleSlideshow(); break;
      case 'f':          toggleFavCurrent(); break;
      case '+': case '=': state.viewer.zoom = Math.min(10, state.viewer.zoom*1.2); applyTransform(); showZoomIndicator(); break;
      case '-':           state.viewer.zoom = Math.max(0.5, state.viewer.zoom*0.8); applyTransform(); showZoomIndicator(); break;
      case '0':           resetViewerTransform(); break;
    }
  });
}

// ── 收藏 ──────────────────────────────────────────────
async function toggleFav(e, id) {
  if (e && e.stopPropagation) e.stopPropagation();
  const photo = state.photos.find(p => p.id === id);
  if (!photo) return;
  let fav;
  try {
    if (photo.md5) {
      const d = await fetch('/api/marks/toggle-fav', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ md5: photo.md5 })
      }).then(r => r.json());
      if (d.error) { showToast('收藏失败: ' + d.error); return; }
      fav = d.favorite === 1;
    } else {
      const d = await fetch(`/api/photos/${id}/favorite`, { method:'POST' }).then(r => r.json());
      fav = !!d.favorite;
    }
  } catch (err) { showToast('收藏失败'); return; }

  photo.favorite = fav;
  const idx = state.photos.findIndex(p => p.id === id);
  const btn = document.querySelector(`.photo-item[data-idx="${idx}"] .fav-btn`);
  if (btn) { btn.textContent = fav ? '❤️' : '🤍'; btn.classList.toggle('active', fav); }

  const vw = document.getElementById('viewer');
  if (vw && vw.classList.contains('show')) {
    const cur = state.photos[state.viewer.index];
    if (cur && cur.id === id) renderViewerRating(cur);
  }
}

function toggleFavCurrent() {
  const photo = state.photos[state.viewer.index];
  if (photo) toggleFav({ stopPropagation:()=>{} }, photo.id);
}

// ── 标签 ──────────────────────────────────────────────
async function addTagPrompt(id) {
  const tag = prompt('输入标签名：');
  if (!tag) return;
  const photo = state.photos.find(p => p.id === id);
  if (!photo) return;
  const tags = [...(photo.user_tags||[])];
  if (!tags.includes(tag)) {
    tags.push(tag);
    await fetch(`/api/photos/${id}/tags`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ tags }),
    });
    photo.user_tags = tags;
    renderViewerTags(photo);
    showToast(`已添加标签：${tag}`);
  }
}

function filterByTag(tag) {
  closeViewer();
  if (!state.filter.tags.includes(tag)) {
    state.filter.tags.push(tag);
    renderActiveTags();
    loadPhotos(true);
  }
}

function renderActiveTags() {
  const container = document.getElementById('active-tags');
  container.innerHTML = state.filter.tags.map(t =>
    `<span class="tag-chip active" onclick="removeTagFilter('${escJs(t)}')">${escHtml(t)} ✕</span>`
  ).join('');
}

function removeTagFilter(tag) {
  state.filter.tags = state.filter.tags.filter(t => t !== tag);
  renderActiveTags();
  loadPhotos(true);
}

// ── 搜索 ──────────────────────────────────────────────
let searchTimer = null;
function onSearch(val) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.filter.q = val; loadPhotos(true); }, 400);
}

function setFilter(type) {
  state.filter.favorite = type === 'favorite';
  state.filter.tags     = [];
  loadPhotos(true);
}

async function loadTags() {
  const r    = await fetch('/api/photo-tags/cloud?threshold=' + tagThreshold);
  state.tags = await r.json();
  const cloud = document.getElementById('tag-cloud');
  if (!cloud) return;
  cloud.innerHTML = state.tags.slice(0,30).map(t =>
    `<span class="tag-chip" onclick="filterByTag('${escJs(t.tag)}')">${escHtml(t.tag)}<small style="color:#507090;margin-left:3px">${t.cnt}</small></span>`
  ).join('');
}

// ── AI标签栏 ──────────────────────────────────────────
let aiTagList = [];
let aiTagsLoaded = false;
let aiBarExpanded = false;

function toggleAiBar() {
  aiBarExpanded = !aiBarExpanded;
  const panel = document.getElementById('ai-tag-panel');
  const btn = document.getElementById('ai-bar-toggle');
  if (panel) panel.style.display = aiBarExpanded ? 'block' : 'none';
  if (btn) btn.classList.toggle('active', aiBarExpanded);
  if (aiBarExpanded && !aiTagsLoaded) loadAiTagBar();
  if (aiBarExpanded) loadRatingBar();
}

async function loadAiTagBar() {
  const bar = document.getElementById('ai-tag-bar');
  if (bar) bar.innerHTML = '<span style=\"color:#507090;font-size:.8rem\">加载中…</span>';
  try {
    const r = await fetch('/api/photo-tags/cloud?threshold=' + tagThreshold);
    const raw = await r.json();
    aiTagList = raw.map(t => ({ name: t.tag, count: t.cnt }));
    aiTagsLoaded = true;
  } catch (e) {
    if (bar) bar.innerHTML = '<span style=\"color:#c66;font-size:.8rem\">标签加载失败</span>';
    console.error('aitag', e);
    return;
  }
  renderAiTagBar();
}

function renderAiTagBar() {
  const bar = document.getElementById('ai-tag-bar');
  if (!bar) return;
  bar.innerHTML = aiTagList.map(function(t) {
    const active = state.aiFilter.tags.includes(t.name);
    return '<span class=\"tag-chip' + (active ? ' active' : '') + '\" onclick=\"toggleAiTag(\'' + escJs(t.name) + '\')\">' + escHtml(t.name) + '<small style=\"color:#507090;margin-left:3px\">' + t.count + '</small></span>';
  }).join('');
  const rOr = document.getElementById('ai-mode-or');
  const rAnd = document.getElementById('ai-mode-and');
  if (rOr) rOr.checked = state.aiFilter.mode === 'or';
  if (rAnd) rAnd.checked = state.aiFilter.mode === 'and';
  const rSg = document.getElementById('ai-mode-single');
  if (rSg) rSg.checked = state.aiFilter.mode === 'single';
}

function toggleAiTag(name) {
  if (state.aiFilter.mode === 'single') {
    state.aiFilter.tags = state.aiFilter.tags.includes(name) ? [] : [name];
  } else {
    const idx = state.aiFilter.tags.indexOf(name);
    if (idx >= 0) state.aiFilter.tags.splice(idx, 1);
    else state.aiFilter.tags.push(name);
  }
  renderAiTagBar();
  refreshTagDirs();
  loadPhotos(true);
}

function setAiMode(mode) {
  state.aiFilter.mode = ['and','or','single'].includes(mode) ? mode : 'or';
  if (state.aiFilter.mode === 'single' && state.aiFilter.tags.length > 1) {
    state.aiFilter.tags = [state.aiFilter.tags[0]];
  }
  renderAiTagBar();
  if (state.aiFilter.tags.length) { refreshTagDirs(); loadPhotos(true); }
}

function clearAiFilter() {
  state.aiFilter.tags = [];
  renderAiTagBar();
  refreshTagDirs();
  loadPhotos(true);
}

// ── 标签模式: 目录区切换 ──
async function refreshTagDirs() {
  const treeWrap = document.getElementById('nas-dir-tree-wrap');
  const listWrap = document.getElementById('tag-dir-list');
  if (!treeWrap || !listWrap) return;
  if (!state.aiFilter.tags.length) {
    treeWrap.style.display = '';
    listWrap.style.display = 'none';
    listWrap.innerHTML = '';
    return;
  }
  treeWrap.style.display = 'none';
  listWrap.style.display = '';
  listWrap.innerHTML = '<div style=\"padding:8px 16px;font-size:.75rem;color:#507090\">目录加载中…</div>';
  try {
    const url = '/api/ai/tag-dirs?threshold=' + tagThreshold + '&mode=' + state.aiFilter.mode + '&tags=' + state.aiFilter.tags.map(encodeURIComponent).join(',');
    const dirs = await fetch(url).then(r => r.json());
    if (!dirs.length) {
      listWrap.innerHTML = '<div style=\"padding:8px 16px;font-size:.75rem;color:#507090\">无匹配目录</div>';
      return;
    }
    const cur = state.filter.dirPath || '';
    listWrap.innerHTML = dirs.map(function(d) {
      const name = d.path.split('/').filter(Boolean).slice(-2).join('/');
      const active = (cur === d.path) ? ' active' : '';
      return '<div class=\"sidebar-item' + active + '\" title=\"' + escHtml(d.path) + '\" onclick=\"selectTagDir(\'' + escJs(d.path) + '\')\" style=\"font-size:.76rem\">📁 ' + escHtml(name) + ' <small style=\"color:#507090\">' + d.count + '</small></div>';
    }).join('');
  } catch (e) {
    listWrap.innerHTML = '<div style=\"padding:8px 16px;font-size:.75rem;color:#c66\">目录加载失败</div>';
    console.error('tag-dirs', e);
  }
}

function selectTagDir(path) {
  const same = state.filter.dirPath === path;
  state.filter.dirPath = same ? '' : path;
  refreshTagDirs();
  loadPhotos(true);
}

// ── 音乐 ──────────────────────────────────────────────
async function loadPlaylists() {
  const r        = await fetch('/api/playlists');
  state.playlists = await r.json();
  const pp = document.getElementById('playlist-panel');
  if (pp && pp.classList.contains('show')) renderPlaylistPanel();
  return state.playlists;
}

async function loadMusicSettings() {
  const r   = await fetch('/api/music-settings');
  const cfg = await r.json();
  if (!cfg) return;
  state.music.mode   = cfg.mode   || 'shuffle';
  state.music.volume = cfg.volume || 0.6;
  if (cfg.playlist_id && !state.music.playlist.length) {
    const pl = state.playlists.find(p => p.id === cfg.playlist_id);
    if (pl) setPlaylist(pl);
  }
}

function setPlaylist(playlist) {
  state.music.playlist = playlist.songs || [];
  if (state.music.mode === 'shuffle') {
    state.music.playlist = [...state.music.playlist].sort(() => Math.random() - 0.5);
  }
  state.music.index = 0;
}

function toggleEQPanel() {
  let panel = document.getElementById('eq-panel');
  if (panel) { panel.remove(); return; }
  initEQ();
  panel = document.createElement('div');
  panel.id = 'eq-panel';
  panel.style.cssText = 'position:fixed;right:20px;bottom:70px;z-index:3000;background:#161d28;border:1px solid #2a3d55;border-radius:12px;padding:16px 18px;min-width:320px;box-shadow:0 8px 32px rgba(0,0,0,.5)';
  document.body.appendChild(panel);
  renderEQPanel();
}

function renderEQPanel() {
  const panel = document.getElementById('eq-panel');
  if (!panel) return;
  const cur = state.music.eqPreset || localStorage.getItem('eqPreset') || '原声';
  const presets = Object.keys(EQ_PRESETS).map(function (n) {
    const on = n === cur;
    return '<button onclick="applyEQPreset(\'' + n + '\')" style="padding:4px 9px;border-radius:5px;font-size:.72rem;cursor:pointer;' +
      (on ? 'background:#40d0ff;color:#000;border:none;font-weight:700' : 'background:transparent;color:#8aa8c8;border:1px solid #2a3d55') + '">' + n + '</button>';
  }).join('');
  const labels = ['60Hz', '230Hz', '910Hz', '3.6k', '14k'];
  const bands = EQ_BANDS.map(function (f, i) {
    const v = _eqFilters[i] ? _eqFilters[i].gain.value : 0;
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:4px">' +
      '<span id="eq-band-val-' + i + '" style="font-size:.66rem;color:#40d0ff;height:12px">' + (v > 0 ? '+' : '') + Math.round(v) + '</span>' +
      '<input type="range" min="-12" max="12" step="1" value="' + v + '" oninput="setEQBand(' + i + ', this.value)" ' +
      'style="writing-mode:vertical-lr;direction:rtl;width:20px;height:90px;accent-color:#40d0ff">' +
      '<span style="font-size:.62rem;color:#507090">' + labels[i] + '</span></div>';
  }).join('');
  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
      '<span style="font-size:.86rem;font-weight:700;color:#f0f6ff">🎛 均衡器</span>' +
      '<span onclick="document.getElementById(\'eq-panel\').remove()" style="cursor:pointer;color:#8aa8c8">✕</span>' +
    '</div>' +
    '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:14px">' + presets + '</div>' +
    '<div style="display:flex;justify-content:space-around;align-items:flex-end">' + bands + '</div>';
}

// ── 均衡器 ────────────────────────────────────────────
let _eqCtx = null, _eqSource = null, _eqFilters = [], _eqGain = null;
const EQ_BANDS = [60, 230, 910, 3600, 14000];
const EQ_PRESETS = {
  '原声':     [0, 0, 0, 0, 0],
  '流行':     [-1, 2, 4, 2, -1],
  '摇滚':     [4, 2, -1, 2, 4],
  '爵士':     [3, 1, 1, 2, 3],
  '古典':     [3, 1, 0, 1, 3],
  '人声':     [-2, 1, 4, 3, 0],
  '低音增强': [6, 4, 0, 0, 0],
  '高音增强': [0, 0, 0, 4, 6]
};

function initEQ() {
  if (_eqCtx || !state.music.audio) return;
  try {
    _eqCtx = new (window.AudioContext || window.webkitAudioContext)();
    _eqSource = _eqCtx.createMediaElementSource(state.music.audio);
    _eqFilters = EQ_BANDS.map(function (f, i) {
      const flt = _eqCtx.createBiquadFilter();
      flt.type = i === 0 ? 'lowshelf' : (i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking');
      flt.frequency.value = f;
      flt.Q.value = 1;
      flt.gain.value = 0;
      return flt;
    });
    _eqGain = _eqCtx.createGain();
    let node = _eqSource;
    _eqFilters.forEach(function (f) { node.connect(f); node = f; });
    node.connect(_eqGain);
    _eqGain.connect(_eqCtx.destination);
    const saved = localStorage.getItem('eqPreset');
    if (saved && EQ_PRESETS[saved]) applyEQPreset(saved);
    console.log('均衡器已就绪');
  } catch (e) { console.log('均衡器初始化失败:', e.message); _eqCtx = null; }
}

function applyEQPreset(name) {
  const vals = EQ_PRESETS[name];
  if (!vals || !_eqFilters.length) return;
  vals.forEach(function (v, i) { if (_eqFilters[i]) _eqFilters[i].gain.value = v; });
  localStorage.setItem('eqPreset', name);
  state.music.eqPreset = name;
  if (typeof renderEQPanel === 'function') renderEQPanel();
}

function setEQBand(i, v) {
  if (_eqFilters[i]) _eqFilters[i].gain.value = parseFloat(v);
  state.music.eqPreset = '自定义';
  const lab = document.getElementById('eq-band-val-' + i);
  if (lab) lab.textContent = (v > 0 ? '+' : '') + v;
}

let _resumeAt = 0;
function saveLastPlay() {
  try {
    localStorage.setItem('lastPlay', JSON.stringify({
      pl: state.music.currentPl,
      index: state.music.index,
      path: (state.music.playlist[state.music.index] || {}).path || '',
      time: state.music.audio ? Math.floor(state.music.audio.currentTime) : 0,
      mode: state.music.mode
    }));
  } catch (e) {}
}

async function restoreLastPlay() {
  let last = null;
  try { last = JSON.parse(localStorage.getItem('lastPlay') || 'null'); } catch (e) {}
  if (!last || !last.pl) return;
  const pl = (state.playlists || []).find(function (x) { return x.id === last.pl; });
  if (!pl) return;
  if (last.mode) state.music.mode = last.mode;
  state.music.playlist = pl.songs || [];
  state.music.currentPl = pl.id;
  if (state.music.mode === 'shuffle') {
    state.music.playlist = [...state.music.playlist].sort(function () { return Math.random() - 0.5; });
  }
  let idx = state.music.playlist.findIndex(function (x) { return x.path === last.path; });
  state.music.index = idx >= 0 ? idx : 0;
  _resumeAt = last.time || 0;
  const song = state.music.playlist[state.music.index];
  if (song) {
    const nm = song.name || song.path.split('/').pop();
    const n1 = document.getElementById('music-name'); if (n1) n1.textContent = nm;
    const n2 = document.getElementById('main-music-name'); if (n2) n2.textContent = nm;
  }
  const btn = document.getElementById('btn-mode');
  if (btn) btn.textContent = state.music.mode === 'shuffle' ? '🔀' : (state.music.mode === 'repeat' ? '🔁' : '➡');
}

function playMusic() {
  if (!state.music.playlist.length) return;
  const song = state.music.playlist[state.music.index];
  if (!song) return;
  if (!state.music.audio) {
    state.music.audio = new Audio();
    state.music.audio.volume = state.music.volume;
    state.music.audio.addEventListener('ended', nextSong);
    state.music.audio.addEventListener('timeupdate', updateProgress);
  }
  const path = song.path.replace('/share', '').replace(/\\/g, '/');
  state.music.audio.src = `/music${path}`;
  initEQ();
  if (_eqCtx && _eqCtx.state === 'suspended') _eqCtx.resume();
  if (_resumeAt > 0) {
    const _rt = _resumeAt; _resumeAt = 0;
    state.music.audio.addEventListener('loadedmetadata', function once() {
      state.music.audio.removeEventListener('loadedmetadata', once);
      if (_rt < state.music.audio.duration - 1) state.music.audio.currentTime = _rt;
    });
  }
  state.music.audio.play();
  state.music.playing = true;
  const _nm = song.name || song.path.split('/').pop();
  const _n1 = document.getElementById('music-name'); if (_n1) _n1.textContent = _nm;
  const _n2 = document.getElementById('main-music-name'); if (_n2) _n2.textContent = _nm;
  saveLastPlay();
  document.getElementById('btn-play').textContent = '⏸';
  const mainPlay = document.getElementById('main-btn-play');
  if (mainPlay) mainPlay.textContent = '⏸';
  const pp = document.getElementById('playlist-panel');
  if (pp && pp.classList.contains('show')) renderPlaylistPanel();
}

function togglePlay() {
  if (!state.music.audio || !state.music.audio.src || _resumeAt > 0) { playMusic(); return; }
  if (state.music.playing) {
    state.music.audio.pause(); state.music.playing = false;
    document.getElementById('btn-play').textContent = '▶';
    const mp1 = document.getElementById('main-btn-play'); if(mp1) mp1.textContent='▶';
  } else {
    state.music.audio.play(); state.music.playing = true;
    document.getElementById('btn-play').textContent = '⏸';
    const mp2 = document.getElementById('main-btn-play'); if(mp2) mp2.textContent='⏸';
  }
}

function nextSong() {
  if (!state.music.playlist.length) return;
  if (state.music.mode === 'repeat') { playMusic(); return; }
  state.music.index = (state.music.index + 1) % state.music.playlist.length;
  playMusic();
}

function prevSong() {
  state.music.index = (state.music.index - 1 + state.music.playlist.length) % state.music.playlist.length;
  playMusic();
}

function toggleMode() {
  const modes = ['shuffle', 'order', 'repeat'];
  const icons = { shuffle: '🔀', order: '▶', repeat: '🔁' };
  const names = { shuffle: '随机', order: '顺序', repeat: '单曲循环' };
  const cur = modes.indexOf(state.music.mode);
  state.music.mode = modes[(cur + 1) % modes.length];
  const btn = document.getElementById('btn-mode');
  if (btn) { btn.textContent = icons[state.music.mode]; btn.title = names[state.music.mode]; }
  if (state.music.mode === 'shuffle') {
    const curSong = state.music.playlist[state.music.index];
    state.music.playlist = [...state.music.playlist].sort(() => Math.random() - 0.5);
    const ni = state.music.playlist.findIndex(x => curSong && x.path === curSong.path);
    state.music.index = ni >= 0 ? ni : 0;
  }
  showToast('播放模式: ' + names[state.music.mode]);
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60), s2 = Math.floor(sec % 60);
  return m + ':' + (s2 < 10 ? '0' : '') + s2;
}

let _lastSaveT = 0;
function updateProgress() {
  const audio = state.music.audio;
  if (!audio || !audio.duration) return;
  if (Date.now() - _lastSaveT > 5000) { _lastSaveT = Date.now(); saveLastPlay(); }
  const ratio = audio.currentTime / audio.duration;
  const pct = (ratio * 100) + '%';
  const f1 = document.getElementById('music-progress-fill'); if (f1) f1.style.width = pct;
  const mainFill = document.getElementById('main-music-progress-fill'); if (mainFill) mainFill.style.width = pct;
  const knob1 = document.getElementById('music-progress-knob'); if (knob1) knob1.style.left = pct;
  const knob2 = document.getElementById('main-progress-knob'); if (knob2) knob2.style.left = pct;
  const t = fmtTime(audio.currentTime) + ' / ' + fmtTime(audio.duration) + '  -' + fmtTime(audio.duration - audio.currentTime);
  const t1 = document.getElementById('music-time'); if (t1) t1.textContent = t;
  const tip = '已播 ' + fmtTime(audio.currentTime) + ' / 总长 ' + fmtTime(audio.duration) + ' / 剩余 ' + fmtTime(audio.duration - audio.currentTime);
  document.querySelectorAll('.music-progress, #main-music-progress-fill').forEach(function (el) { if (el.parentElement) el.parentElement.title = tip; el.title = tip; });
  const t2 = document.getElementById('main-music-time'); if (t2) t2.textContent = t;
}

function startSeekDrag(e) {
  const bar = e.currentTarget;
  const audio = state.music.audio;
  if (!audio || !audio.duration) return;
  const move = function (ev) {
    const rect = bar.getBoundingClientRect();
    let r = (ev.clientX - rect.left) / rect.width;
    r = Math.max(0, Math.min(1, r));
    audio.currentTime = r * audio.duration;
    updateProgress();
  };
  const up = function () {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  move(e);
}

function seekMusic(e) {
  const audio = state.music.audio;
  if (!audio || !audio.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
}

function setVolume(val) {
  clearTimeout(window._volTimer);
  window._volTimer = setTimeout(_saveBrowseState, 500);
  state.music.volume = parseFloat(val);
  if (state.music.audio) state.music.audio.volume = state.music.volume;
}

function togglePlaylistPanel() {
  const panel = document.getElementById('playlist-panel');
  panel.classList.toggle('show');
  if (!panel.classList.contains('show')) return;
  if (!state.playlists || !state.playlists.length) {
    const tb = document.getElementById('playlist-toolbar');
    if (tb) tb.innerHTML = '<span style="font-size:.76rem;color:#507090">歌单加载中…</span>';
    loadPlaylists().then(function () { renderPlaylistPanel(); })
      .catch(function () {
        const tb2 = document.getElementById('playlist-toolbar');
        if (tb2) tb2.innerHTML = '<span style="font-size:.76rem;color:#c66">歌单加载失败</span>';
      });
    return;
  }
  renderPlaylistPanel();
  loadPlaylists().then(function () { renderPlaylistPanel(); }).catch(function () {});
}

function renderPlaylistPanel() {
  renderPlaylistToolbar();
  const body = document.getElementById('playlist-body');
  if (!body) return;
  const songs = state.music.playlist || [];
  if (!songs.length) {
    body.innerHTML = '<div style="padding:16px;color:#507090;font-size:.8rem">当前歌单没有歌曲，请在上方选择歌单</div>';
    return;
  }
  body.innerHTML = songs.map(function (s2, i) {
    const cur = i === state.music.index;
    return '<div onclick="playSongAt(' + i + ')" style="display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;font-size:.78rem;' +
      (cur ? 'background:rgba(64,208,255,.12);color:#40d0ff' : 'color:#c8dff5') + '">' +
      '<span style="width:16px;text-align:center">' + (cur ? '▶' : (i + 1)) + '</span>' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(s2.name || s2.path.split('/').pop()) + '</span>' +
      '</div>';
  }).join('');
}

function renderPlaylistToolbar() {
  const tb = document.getElementById('playlist-toolbar');
  if (!tb) return;
  const modes = [['shuffle','🔀','随机'],['order','➡','顺序'],['repeat','🔁','单曲']];
  const opts = (state.playlists || []).map(function (pl) {
    return '<option value="' + pl.id + '"' + (state.music.currentPl === pl.id ? ' selected' : '') + '>' +
      escHtml(pl.name) + ' (' + (pl.songs || []).length + ')</option>';
  }).join('');
  tb.innerHTML =
    '<select onchange="selectPlaylist(parseInt(this.value))" style="background:#182535;border:1px solid #2a3d55;border-radius:5px;color:#f0f6ff;padding:4px 8px;font-size:.76rem;flex:1;min-width:120px">' +
      '<option value="">选择歌单…</option>' + opts +
    '</select>' +
    modes.map(function (m) {
      const on = state.music.mode === m[0];
      return '<button onclick="setMusicMode(\'' + m[0] + '\')" title="' + m[2] + '" style="padding:4px 9px;border-radius:5px;font-size:.74rem;cursor:pointer;' +
        (on ? 'background:#40d0ff;color:#000;border:none;font-weight:700' : 'background:transparent;color:#8aa8c8;border:1px solid #2a3d55') + '">' +
        m[1] + '</button>';
    }).join('') +
    _plToolbarExtra();
}

function setMusicMode(mode) {
  state.music.mode = mode;
  if (mode === 'shuffle') {
    const curSong = state.music.playlist[state.music.index];
    state.music.playlist = [...state.music.playlist].sort(function () { return Math.random() - 0.5; });
    const ni = state.music.playlist.findIndex(function (x) { return curSong && x.path === curSong.path; });
    state.music.index = ni >= 0 ? ni : 0;
  }
  const btn = document.getElementById('btn-mode');
  if (btn) btn.textContent = mode === 'shuffle' ? '🔀' : (mode === 'repeat' ? '🔁' : '▶');
  renderPlaylistPanel();
}

function playSongAt(i) {
  if (i < 0 || i >= (state.music.playlist || []).length) return;
  state.music.index = i;
  playMusic();
  renderPlaylistPanel();
}

function selectPlaylist(id) {
  const pl = state.playlists.find(p => p.id === id);
  if (pl) { setPlaylist(pl); state.music.currentPl = id; playMusic(); saveLastPlay(); renderPlaylistPanel(); }
}

function toggleMusicBar() {
  const bar = document.getElementById("main-music-bar");
  bar.style.display = bar.style.display === "none" ? "flex" : "none";
}

// ── 工具 ──────────────────────────────────────────────
function updateStats() { const el = document.getElementById('stats-total'); if(el) el.textContent = state.total; }
function showSpinner(show) { document.getElementById('spinner').style.display = show ? 'block' : 'none'; }
function formatDate(ts) { if (!ts) return ''; return new Date(ts * 1000).toLocaleDateString('ja-JP'); }
function formatSize(bytes) {
  if (!bytes) return '-';
  if (bytes > 1024*1024) return (bytes/1024/1024).toFixed(1) + ' MB';
  return (bytes/1024).toFixed(0) + ' KB';
}
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escJs(s)   { return String(s).replace(/'/g,"\\'"); }
function showToast(msg) {
  const t = document.createElement('div'); t.className='toast'; t.textContent=msg;
  document.body.appendChild(t); setTimeout(()=>t.remove(),2500);
}

document.addEventListener('DOMContentLoaded', init);

// ── 目录状态加载 ──────────────────────────────────────
const dirStatsCache     = new Map();

async function loadDirStats(path, statsEl) {
  const el = typeof statsEl === "string" ? document.getElementById(statsEl) : statsEl;
  if (!el) return;

  if (dirStatsCache.has(path)) {
    renderDirStats(el, dirStatsCache.get(path));
    return;
  }

  try {
    const r     = await fetch(`/api/photos/stats/by-dir?path=${encodeURIComponent(path)}`);
    const stats = await r.json();
    dirStatsCache.set(path, stats);
    renderDirStats(el, stats);
  } catch(e) {
    el.innerHTML = '';
  }
}

function renderDirStats(el, stats) {
  if (!el) return;
  const parts = [];
  if (stats.done)       parts.push(`<span class="dir-stat-done">✅${stats.done}</span>`);
  if (stats.pending)    parts.push(`<span class="dir-stat-pending">⏳${stats.pending}</span>`);
  if (stats.processing) parts.push(`<span class="dir-stat-pending">🔄${stats.processing}</span>`);
  if (stats.error)      parts.push(`<span class="dir-stat-error">❌${stats.error}</span>`);
  el.innerHTML = parts.join(' ') || '<span style="color:#507090;font-size:.68rem">无图片</span>';
}

async function reprocessPhoto(id) {
  showToast('重新处理中...');
  try {
    await fetch(`/api/photos/${id}/reprocess`, { method: 'POST' });
    showToast('已加入处理队列');
  } catch(e) {
    showToast('失败: ' + e.message, 'error');
  }
}

async function deletePhoto(id) {
  if (!confirm('确认彻底删除？（原文件、缩略图、数据库记录全部删除，不可恢复）')) return;
  try {
    const _dr = await fetch('/api/photos/delete-full', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({id}) });
    if (!_dr.ok) throw new Error('删除失败');
    state.photos = state.photos.filter(p => p.id !== id);
    loadPhotos(true);
    showToast('已删除');
  } catch(e) {
    showToast('失败', 'error');
  }
}


// ── 幻灯片配置 ────────────────────────────────────────
function toggleSlideshowCfg() {
  const panel = document.getElementById('slideshow-cfg-panel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function updateSlideshowInterval(val) {
  state.slideshow.interval = parseInt(val) * 1000;
  document.getElementById('slideshow-interval-val').textContent = val + '秒';
  if (state.slideshow.active) {
    clearInterval(state.slideshow.timer);
    state.slideshow.timer = setInterval(() => viewerNext(), state.slideshow.interval);
  }
}

document.addEventListener('click', (e) => {
  const panel = document.getElementById('slideshow-cfg-panel');
  const btn   = document.getElementById('btn-slideshow-cfg');
  if (panel && btn && !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.style.display = 'none';
  }
});

function openGpsMap() {
  const photo = state.photos[state.viewer.index];
  if (!photo || !photo.exif_gps) return;
  const [lat, lng] = photo.exif_gps.split(',');
  window.open(`https://maps.google.com/maps?q=${lat},${lng}`, '_blank');
}

// ── 侧边栏折叠/拖拽 ──────────────────────────────────
(function() {
  let collapsed = false;
  let sidebar, toggle, resizer;
  function applyState() {

    if (!sidebar) return;
    const w = collapsed ? 0 : (parseInt(localStorage.getItem("sidebar-width")) || 260);
    sidebar.classList.toggle('collapsed', collapsed);
    if (toggle) { toggle.textContent = collapsed ? '▶' : '◀'; toggle.style.left = (collapsed ? 0 : w) + 'px'; }
    if (resizer) resizer.style.left = (collapsed ? 0 : w) + 'px';
    localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
  }

  window.toggleSidebar = function() {
    collapsed = !collapsed;
    applyState();
  };

  document.addEventListener('DOMContentLoaded', () => {
    sidebar = document.getElementById('sidebar');
    toggle  = document.getElementById('sidebar-toggle');
    resizer = document.getElementById('sidebar-resizer');
    if (localStorage.getItem('sidebar-collapsed') === '1') {
      collapsed = true;
    }
    applyState();

    const savedW = localStorage.getItem('sidebar-width');
    if (savedW && sidebar) {
      sidebar.style.width = savedW + 'px';
      if (resizer) resizer.style.left = savedW + 'px';
      if (toggle) toggle.style.left = savedW + 'px';
    }

    if (!resizer || !sidebar) return;

    resizer.addEventListener('mouseenter', () => resizer.style.background = 'rgba(64,208,255,.4)');
    resizer.addEventListener('mouseleave', () => resizer.style.background = 'transparent');

    let startX = 0, startW = 0;
    resizer.addEventListener('mousedown', (e) => {
      if (collapsed) return;
      startX = e.clientX;
      startW = sidebar.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const onMove = (e) => {
        const newW = Math.max(160, Math.min(480, startW + e.clientX - startX));
        sidebar.style.width = newW + 'px';
        if (resizer) resizer.style.left = newW + 'px';
        if (toggle) toggle.style.left = newW + 'px';
      };
      const onUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('sidebar-width', sidebar.offsetWidth);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });
})();


// ── 身份切换(角色) ──────────────────────────────────────
const ROLE_STORAGE_KEY = 'viewer_current_role';

function getCurrentRole() {
  try {
    const raw = localStorage.getItem(ROLE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function setCurrentRole(role) {
  if (role) localStorage.setItem(ROLE_STORAGE_KEY, JSON.stringify(role));
  else localStorage.removeItem(ROLE_STORAGE_KEY);
}

async function openRoleSwitcher() {
  let roles = [];
  try {
    roles = await fetch('/api/roles').then(r => r.json());
  } catch (e) { if (typeof showToast === 'function') showToast('加载角色列表失败', 'error'); return; }

  const current = getCurrentRole();
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center';

  const allItem = `<div class="role-switch-item" data-id="" style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:8px;cursor:pointer;${!current ? 'background:#182535;border:1px solid #40d0ff' : 'border:1px solid transparent'}">
    <span style="font-size:1.4rem">🌐</span><span>全部(无限制)</span>
  </div>`;
  const roleItems = roles.map(r => `<div class="role-switch-item" data-id="${r.id}" data-name="${String(r.name).replace(/"/g,'&quot;')}" data-icon="${String(r.icon||'👤').replace(/"/g,'&quot;')}" style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:8px;cursor:pointer;${current && current.id === r.id ? 'background:#182535;border:1px solid #40d0ff' : 'border:1px solid transparent'}">
    <span style="font-size:1.4rem">${r.icon || '👤'}</span><span>${r.name}</span>
  </div>`).join('');

  overlay.innerHTML = `
    <div style="background:#101820;border:1px solid #263548;border-radius:10px;padding:20px;width:320px">
      <div style="font-size:1rem;font-weight:700;margin-bottom:14px;color:#f0f6ff">切换身份</div>
      <div id="role-switch-list">${allItem}${roleItems}</div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) { overlay.remove(); return; }
    const item = e.target.closest('.role-switch-item');
    if (!item) return;
    const id = item.dataset.id;
    if (!id) {
      setCurrentRole(null);
    } else {
      setCurrentRole({ id: id, name: item.dataset.name, icon: item.dataset.icon });
    }
    overlay.remove();
    location.reload();
  });
}

function renderRoleSwitchButton() {
  const current = getCurrentRole();
  const label = current ? (current.icon + ' ' + current.name) : '🌐 全部';
  const btn = document.getElementById('role-switch-btn');
  if (btn) btn.textContent = label;
}

async function _waitTreeAndLocate(dirPath, tries) {
  tries = tries || 0;
  const t = window.dirTree;
  if (!t || !t.container || !t.container.querySelector(".pc-toggle")) {
    if (tries < 40) return setTimeout(function () { _waitTreeAndLocate(dirPath, tries + 1); }, 250);
    console.log("目录树未就绪, 放弃定位");
    return;
  }
  const fwd = dirPath.replace(/\\/g, "/");
  const roots = [...t.container.querySelectorAll(":scope > .dtw-node")].map(function (n) { return n.dataset.path; });
  const root = roots.find(function (r) { return fwd === r || fwd.startsWith(r + "/"); });
  if (!root) { console.log("目录不在当前根列表:", fwd); return; }
  const rest = fwd.slice(root.length).split("/").filter(Boolean);
  let cur = root;
  const levels = [root];
  rest.forEach(function (seg) { cur += "/" + seg; levels.push(cur); });
  for (let i = 0; i < levels.length; i++) {
    const path = levels[i];
    const tg = t.container.querySelector('.pc-toggle[data-toggle="' + path.replace(/"/g, '\\"') + '"]');
    if (!tg) { console.log("找不到节点:", path); break; }
    const isLast = i === levels.length - 1;
    if (!isLast) {
      const nid = t._nid(path);
      const ch = document.getElementById(nid + "_ch");
      if (!ch || ch.style.display === "none") { await t._toggle(tg); }
    } else {
      const nm = tg.parentElement.querySelector(".dtw-name");
      if (nm) {
        t.selected = path;
        t.container.querySelectorAll(".dtw-name").forEach(function (el) { el.style.background = "transparent"; });
        nm.style.background = "rgba(64,208,255,.18)";
        nm.scrollIntoView({ block: "center" });
      }
    }
  }
}

// ══ 评分系统 ──────────────────────────────────────────
const RATING_LABELS_SYS = [null, '不好', '普通', '不错', '喜欢', '最爱'];

function _ensureRatingBar() {
  let bar = document.getElementById('viewer-rating');
  if (bar) return bar;
  const tags = document.getElementById('viewer-tags');
  if (!tags || !tags.parentNode) return null;
  bar = document.createElement('div');
  bar.id = 'viewer-rating';
  bar.className = 'viewer-rating';
  tags.parentNode.insertBefore(bar, tags);
  return bar;
}

function renderViewerRating(photo) {
  const bar = _ensureRatingBar();
  if (!bar) return;
  if (!photo || !photo.md5) {
    bar.innerHTML = '<span class="vr-label">评分</span><span class="vr-none">(无md5, 不支持评分)</span>';
    return;
  }
  if (photo.rating === undefined) {
    fetch('/api/marks?md5=' + photo.md5).then(r => r.json()).then(m => {
      photo.rating   = m.rating || 0;
      photo.favorite = m.favorite === 1;
      const cur = state.photos[state.viewer.index];
      if (cur && cur.md5 === photo.md5) renderViewerRating(photo);
    }).catch(() => { photo.rating = 0; });
  }
  const r = photo.rating || 0;
  let h = '<span class="vr-label">评分</span>';
  for (let i = 1; i <= 5; i++) {
    h += '<span class="vr-cell' + (i === r ? ' on' : '') + '"' +
         ' onclick="setRating(' + i + ')">' + RATING_LABELS_SYS[i] + '</span>';
  }
  h += '<span class="vr-clear" onclick="setRating(0)" title="清除评分">✕</span>';
  h += '<span class="vr-fav' + (photo.favorite ? ' on' : '') + '" onclick="toggleFavCurrent()" title="收藏 (f)">' + (photo.favorite ? '❤' : '♡') + '</span>';
  bar.innerHTML = h;
}

async function setRating(n) {
  const photo = state.photos[state.viewer.index];
  if (!photo) return;
  if (!photo.md5) { showToast('该图无md5, 不支持评分'); return; }
  n = parseInt(n, 10);
  if (!(n >= 0 && n <= 5)) return;
  if (n === (photo.rating || 0)) n = 0;
  try {
    const d = await fetch('/api/marks/set', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ md5: photo.md5, rating: n })
    }).then(r => r.json());
    if (d.error) { showToast('评分失败: ' + d.error); return; }
    photo.rating   = d.rating;
    photo.favorite = d.favorite === 1;
    renderViewerRating(photo);
    if (typeof refreshGridMarks === 'function') refreshGridMarks([photo.md5]);
    if (typeof loadRatingBar === 'function') loadRatingBar();
    showToast(n ? RATING_LABELS_SYS[n] : '已清除评分');
  } catch (e) { showToast('评分失败'); }
}

let _markStats = null;

function _ensureRatingRow() {
  let row = document.getElementById('rating-filter-row');
  if (row) return row;
  row = document.createElement('div');
  row.id = 'rating-filter-row';
  row.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 16px';
  const btn  = document.getElementById('ai-bar-toggle');
  const grid = document.getElementById('photo-grid');
  if (btn && btn.parentElement) {
    btn.parentElement.insertAdjacentElement('afterend', row);
  } else if (grid && grid.parentElement) {
    grid.parentElement.insertBefore(row, grid);
  } else {
    return null;
  }
  return row;
}

async function loadRatingBar() {
  try {
    _markStats = await fetch('/api/marks/stats?mediaType=photo').then(r => r.json());
  } catch (e) {
    _markStats = { favorite: 0, ratings: {} };
  }
  renderRatingBar();
}

function renderRatingBar() {
  const row = _ensureRatingRow();
  if (!row) return;
  if (!state.filter.ratings) state.filter.ratings = [];
  const sel = state.filter.ratings;
  const st  = _markStats || { favorite: 0, ratings: {} };

  let h = '<span class="tag-chip' + (state.filter.favorite ? ' active' : '') + '"' +
          ' onclick="toggleFavChip()">❤ 收藏<small style="color:#507090;margin-left:4px">' +
          (st.favorite || 0) + '</small></span>';
  h += '<span style="width:1px;height:18px;background:#2a3d55;margin:0 4px"></span>';
  for (let i = 1; i <= 5; i++) {
    const cnt = (st.ratings && st.ratings[i]) || 0;
    const on  = sel.indexOf(i) >= 0;
    h += '<span class="tag-chip' + (on ? ' active' : '') + '"' +
         ((cnt || on) ? '' : ' style="opacity:.4"') +
         ' onclick="toggleRatingChip(' + i + ')">' + RATING_LABELS_SYS[i] +
         '<small style="color:#507090;margin-left:4px">' + cnt + '</small></span>';
  }
  if (sel.length || state.filter.favorite) {
    h += '<span class="tag-chip" style="border-style:dashed" onclick="clearRatingFilter()">清除</span>';
  }
  row.innerHTML = h;
}

function toggleRatingChip(n) {
  if (!state.filter.ratings) state.filter.ratings = [];
  const sel = state.filter.ratings;
  const i = sel.indexOf(n);
  if (i >= 0) sel.splice(i, 1); else sel.push(n);
  sel.sort(function (a, b) { return a - b; });
  renderRatingBar();
  loadPhotos(true);
}

function toggleFavChip() {
  state.filter.favorite = !state.filter.favorite;
  renderRatingBar();
  loadPhotos(true);
}

function clearRatingFilter() {
  state.filter.ratings = [];
  state.filter.favorite = false;
  renderRatingBar();
  loadPhotos(true);
}

document.addEventListener('DOMContentLoaded', function () {
  setTimeout(loadRatingBar, 300);
  if (document.getElementById('vr-style')) return;
  const st = document.createElement('style');
  st.id = 'vr-style';
  st.textContent = [
    '.viewer-rating{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:6px 0 8px;padding:0 16px}',
    '.viewer-rating .vr-label{font-size:.72rem;color:#507090;margin-right:5px}',
    '.viewer-rating .vr-none{font-size:.72rem;color:#507090}',
    '.viewer-rating .vr-cell{padding:4px 12px;font-size:.72rem;color:#8aa8c8;',
    'background:#16202c;border:1px solid #2a3d55;border-radius:12px;',
    'cursor:pointer;user-select:none;transition:background .12s,color .12s}',
    '.viewer-rating .vr-cell:hover{border-color:#40d0ff;color:#40d0ff}',
    '.viewer-rating .vr-cell.on{background:#40d0ff;color:#04121c;border-color:#40d0ff;font-weight:700}',
    '.viewer-rating .vr-clear{padding:4px 8px;margin-left:4px;font-size:.72rem;',
    'color:#8aa8c8;cursor:pointer;border-radius:12px}',
    '.viewer-rating .vr-clear:hover{color:#ff5567}',
    '.viewer-rating .vr-fav{margin-left:8px;font-size:1rem;cursor:pointer;user-select:none;color:#ff5567}',
    '@media(max-width:700px){.viewer-rating .vr-cell{padding:6px 12px}}'
  ].join('');
  document.head.appendChild(st);
});

// ══ 选歌面板 + 歌单改名 ──────────────────────────────
let _spSel   = {};
let _spItems = [];
let _spTab   = "browse";
let _spDir   = null;
let _spTimer = null;
let _spDirs  = [];
let _spUp    = null;

function _plToolbarExtra() {
  const bs = "padding:4px 9px;border-radius:5px;font-size:.74rem;cursor:pointer;" +
             "background:transparent;color:#8aa8c8;border:1px solid #2a3d55";
  return '<button onclick="openSongPicker()" title="添加歌曲" style="' + bs + '">＋</button>' +
         '<button onclick="renamePlaylist()" title="重命名歌单" style="' + bs + '">✎</button>';
}

function _curPlaylist() {
  const id = state.music.currentPl;
  if (!id) return null;
  return (state.playlists || []).find(function (p) { return p.id === id; }) || null;
}

function _spEl() {
  let m = document.getElementById("song-picker");
  if (m) return m;
  m = document.createElement("div");
  m.id = "song-picker";
  m.innerHTML =
    '<div class="sp-mask" onclick="closeSongPicker()"></div>' +
    '<div class="sp-box">' +
      '<div class="sp-head"><span id="sp-title">添加歌曲</span>' +
        '<span class="sp-x" onclick="closeSongPicker()">✕</span></div>' +
      '<div class="sp-tabs">' +
        '<span id="sp-tab-browse" class="sp-tab on" onclick="spSwitchTab(&quot;browse&quot;)">浏览目录</span>' +
        '<span id="sp-tab-search" class="sp-tab" onclick="spSwitchTab(&quot;search&quot;)">搜索</span>' +
      '</div>' +
      '<div id="sp-search-row" style="display:none">' +
        '<input id="sp-q" class="sp-input" placeholder="歌名或路径关键词…" oninput="spSearchDebounced()">' +
      '</div>' +
      '<div id="sp-body" class="sp-body"></div>' +
      '<div class="sp-foot"><span id="sp-count">已选 0 首</span>' +
        '<button class="sp-btn" onclick="spConfirm()">加入歌单</button></div>' +
    '</div>';
  document.body.appendChild(m);
  return m;
}

function openSongPicker() {
  const pl = _curPlaylist();
  if (!pl) { showToast("请先在上方选择一个歌单"); return; }
  _spSel = {};
  _spEl().classList.add("show");
  const t = document.getElementById("sp-title");
  if (t) t.textContent = "添加歌曲 → " + pl.name;
  spSwitchTab("browse");
  _spUpdateCount();
}

function closeSongPicker() {
  const m = document.getElementById("song-picker");
  if (m) m.classList.remove("show");
}

function spSwitchTab(tab) {
  _spTab = tab;
  const tb = document.getElementById("sp-tab-browse");
  const ts = document.getElementById("sp-tab-search");
  const sr = document.getElementById("sp-search-row");
  if (tb) tb.className = "sp-tab" + (tab === "browse" ? " on" : "");
  if (ts) ts.className = "sp-tab" + (tab === "search" ? " on" : "");
  if (sr) sr.style.display = tab === "search" ? "block" : "none";
  if (tab === "browse") spBrowse(_spDir);
  else {
    const q = document.getElementById("sp-q");
    if (q) q.focus();
    _spItems = [];
    _spRender("<div class=\"sp-tip\">输入关键词开始搜索</div>");
  }
}

function _spRender(html) {
  const b = document.getElementById("sp-body");
  if (b) b.innerHTML = html;
}

function _spUpdateCount() {
  const c = document.getElementById("sp-count");
  if (c) c.textContent = "已选 " + Object.keys(_spSel).length + " 首";
}

async function spBrowse(dir) {
  _spRender('<div class="sp-tip">加载中…</div>');
  let d;
  try {
    const url = "/api/music/browse" + (dir ? ("?path=" + encodeURIComponent(dir)) : "");
    d = await fetch(url).then(function (r) { return r.json(); });
  } catch (e) { _spRender('<div class="sp-tip">加载失败</div>'); return; }
  if (d.error) { _spRender('<div class="sp-tip">' + escHtml(d.error) + '</div>'); return; }

  _spDir   = d.dir;
  _spItems = d.files || [];
  _spDirs  = d.dirs || [];
  _spUp    = (d.dir !== d.root) ? d.dir.split("/").slice(0, -1).join("/") : null;
  let h = '<div class="sp-path">' + escHtml(d.dir) + '</div>';
  if (_spUp) {
    h += '<div class="sp-row sp-dir" onclick="spGoUp()">📁 .. 返回上级</div>';
  }
  (d.dirs || []).forEach(function (x, i) {
    h += '<div class="sp-row sp-dir" onclick="spEnterDir(' + i + ')">📁 ' + escHtml(x.name) + '</div>';
  });
  if ((d.files || []).length) {
    h += '<div class="sp-row sp-act" onclick="spImportDir()">⤓ 把本目录整个导入(含子目录)</div>';
  }
  (d.files || []).forEach(function (f, i) {
    const on = !!_spSel[f.path];
    h += '<div id="sp-row-' + i + '" class="sp-row' + (on ? " on" : "") + '" onclick="spToggle(' + i + ')">' +
         '<span class="sp-ck">' + (on ? "✓" : "") + '</span>' + escHtml(f.name) + '</div>';
  });
  if (!(d.dirs || []).length && !(d.files || []).length) h += '<div class="sp-tip">空目录</div>';
  _spRender(h);
}

function spEnterDir(i) {
  const x = _spDirs[i];
  if (x) spBrowse(x.path);
}

function spGoUp() {
  if (_spUp !== null) spBrowse(_spUp);
}

function spSearchDebounced() {
  clearTimeout(_spTimer);
  _spTimer = setTimeout(spSearch, 300);
}

async function spSearch() {
  const el = document.getElementById("sp-q");
  const q = el ? el.value.trim() : "";
  if (!q) { _spItems = []; _spRender('<div class="sp-tip">输入关键词开始搜索</div>'); return; }
  _spRender('<div class="sp-tip">搜索中…</div>');
  let d;
  try {
    d = await fetch("/api/music/search?q=" + encodeURIComponent(q)).then(function (r) { return r.json(); });
  } catch (e) { _spRender('<div class="sp-tip">搜索失败</div>'); return; }
  _spItems = d.songs || [];
  if (!_spItems.length) { _spRender('<div class="sp-tip">没有匹配的歌曲</div>'); return; }
  let h = '<div class="sp-path">命中 ' + _spItems.length + ' 首 / 库内 ' + (d.total || 0) + ' 首</div>';
  _spItems.forEach(function (f, i) {
    const on = !!_spSel[f.path];
    h += '<div id="sp-row-' + i + '" class="sp-row' + (on ? " on" : "") + '" onclick="spToggle(' + i + ')">' +
         '<span class="sp-ck">' + (on ? "✓" : "") + '</span>' +
         '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(f.name) + '</span>' +
         '</div>';
  });
  _spRender(h);
}

function spToggle(i) {
  const f = _spItems[i];
  if (!f) return;
  const on = !_spSel[f.path];
  if (on) _spSel[f.path] = { path: f.path, name: f.name };
  else delete _spSel[f.path];
  const el = document.getElementById("sp-row-" + i);
  if (el) {
    if (on) el.classList.add("on"); else el.classList.remove("on");
    const ck = el.querySelector(".sp-ck");
    if (ck) ck.textContent = on ? "✓" : "";
  }
  _spUpdateCount();
}

async function spConfirm() {
  const pl = _curPlaylist();
  if (!pl) { showToast("歌单已失效, 请重新选择"); return; }
  const songs = Object.keys(_spSel).map(function (k) { return _spSel[k]; });
  if (!songs.length) { showToast("还没有选歌"); return; }
  try {
    const d = await fetch("/api/playlists/" + pl.id + "/add-songs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ songs: songs })
    }).then(function (r) { return r.json(); });
    if (d.error) { showToast("添加失败: " + d.error); return; }
    showToast("已添加 " + d.added + " 首, 歌单共 " + d.total + " 首");
    _spSel = {};
    closeSongPicker();
    await _spRefreshPlaying(pl.id);
  } catch (e) { showToast("添加失败"); }
}

async function spImportDir() {
  const pl = _curPlaylist();
  if (!pl || !_spDir) return;
  if (!confirm("把 " + _spDir + " 及其子目录的全部歌曲导入《" + pl.name + "》?")) return;
  try {
    const d = await fetch("/api/playlists/" + pl.id + "/import-dir", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: _spDir, recursive: true })
    }).then(function (r) { return r.json(); });
    if (d.error) { showToast("导入失败: " + d.error); return; }
    showToast("已导入 " + d.added + " 首, 歌单共 " + d.total + " 首");
    closeSongPicker();
    await _spRefreshPlaying(pl.id);
  } catch (e) { showToast("导入失败"); }
}

async function _spRefreshPlaying(id) {
  await loadPlaylists();
  const pl = (state.playlists || []).find(function (p) { return p.id === id; });
  if (!pl) { renderPlaylistPanel(); return; }
  if (state.music.currentPl === id) {
    const have = {};
    (state.music.playlist || []).forEach(function (s) { have[s.path] = 1; });
    (pl.songs || []).forEach(function (s) {
      if (!have[s.path]) state.music.playlist.push({ path: s.path, name: s.name });
    });
  }
  renderPlaylistPanel();
}

async function renamePlaylist() {
  const pl = _curPlaylist();
  if (!pl) { showToast("请先在上方选择一个歌单"); return; }
  const name = prompt("歌单新名称", pl.name);
  if (name === null) return;
  const nm = String(name).trim();
  if (!nm) { showToast("名称不能为空"); return; }
  if (nm === pl.name) return;
  try {
    await loadPlaylists();
    const fresh = (state.playlists || []).find(function (p) { return p.id === pl.id; });
    if (!fresh) { showToast("歌单已不存在"); return; }
    const d = await fetch("/api/playlists/" + pl.id, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nm, songs: fresh.songs || [] })
    }).then(function (r) { return r.json(); });
    if (d && d.error) { showToast("改名失败: " + d.error); return; }
    showToast("已改名为 " + nm);
    await loadPlaylists();
    renderPlaylistPanel();
  } catch (e) { showToast("改名失败"); }
}

document.addEventListener("DOMContentLoaded", function () {
  if (document.getElementById("sp-style")) return;
  const st = document.createElement("style");
  st.id = "sp-style";
  st.textContent = [
    "#song-picker{display:none;position:fixed;inset:0;z-index:99000}",
    "#song-picker.show{display:block}",
    "#song-picker .sp-mask{position:absolute;inset:0;background:rgba(0,0,0,.6)}",
    "#song-picker .sp-box{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);",
    "width:min(520px,92vw);max-height:80vh;display:flex;flex-direction:column;",
    "background:#141d29;border:1px solid #2a3d55;border-radius:10px;overflow:hidden;",
    "box-shadow:0 12px 40px rgba(0,0,0,.6)}",
    "#song-picker .sp-head{display:flex;align-items:center;justify-content:space-between;",
    "padding:12px 14px;border-bottom:1px solid #2a3d55;font-size:.85rem;color:#f0f6ff}",
    "#song-picker .sp-x{cursor:pointer;color:#8aa8c8;padding:0 4px}",
    "#song-picker .sp-x:hover{color:#ff5567}",
    "#song-picker .sp-tabs{display:flex;gap:4px;padding:8px 12px 0}",
    "#song-picker .sp-tab{padding:5px 14px;font-size:.76rem;color:#8aa8c8;cursor:pointer;",
    "border:1px solid #2a3d55;border-radius:6px 6px 0 0}",
    "#song-picker .sp-tab.on{background:#1e2a3a;color:#40d0ff;border-color:#40d0ff}",
    "#song-picker .sp-input{width:calc(100% - 24px);margin:8px 12px;padding:7px 10px;",
    "background:#0e1620;border:1px solid #2a3d55;border-radius:6px;color:#f0f6ff;font-size:.78rem}",
    "#song-picker .sp-body{flex:1;overflow-y:auto;min-height:200px;padding:4px 0}",
    "#song-picker .sp-path{padding:6px 14px;font-size:.68rem;color:#507090;",
    "word-break:break-all;border-bottom:1px solid #1e2a3a}",
    "#song-picker .sp-row{display:flex;align-items:center;gap:8px;padding:8px 14px;",
    "font-size:.78rem;color:#c8dff5;cursor:pointer}",
    "#song-picker .sp-row:hover{background:rgba(64,208,255,.08)}",
    "#song-picker .sp-row.on{background:rgba(64,208,255,.14);color:#40d0ff}",
    "#song-picker .sp-dir{color:#8aa8c8}",
    "#song-picker .sp-act{color:#40d0ff;border-top:1px solid #1e2a3a;border-bottom:1px solid #1e2a3a}",
    "#song-picker .sp-ck{width:16px;height:16px;line-height:16px;text-align:center;",
    "border:1px solid #2a3d55;border-radius:3px;font-size:.7rem;color:#40d0ff;flex-shrink:0}",
    "#song-picker .sp-tip{padding:24px 14px;text-align:center;color:#507090;font-size:.78rem}",
    "#song-picker .sp-foot{display:flex;align-items:center;justify-content:space-between;",
    "padding:10px 14px;border-top:1px solid #2a3d55;font-size:.76rem;color:#8aa8c8}",
    "#song-picker .sp-btn{padding:6px 18px;background:#40d0ff;color:#04121c;border:none;",
    "border-radius:6px;font-size:.78rem;font-weight:700;cursor:pointer}",
    "#song-picker .sp-btn:hover{background:#5fdcff}"
  ].join("");
  document.head.appendChild(st);
});

// ══ 歌单面板: 拖拽 / 折叠 / 置顶 ──────────────────────
const PL_POS_KEY = "plPanelPos";

function _plPanel() { return document.getElementById("playlist-panel"); }

function _plState() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(PL_POS_KEY) || "null"); } catch (e) {}
  return s || {};
}

function _plSave(patch) {
  const s = _plState();
  for (const k in patch) s[k] = patch[k];
  try { localStorage.setItem(PL_POS_KEY, JSON.stringify(s)); } catch (e) {}
  return s;
}

function _plApplyState() {
  const p = _plPanel();
  if (!p) return;
  const s = _plState();
  if (typeof s.left === "number" && typeof s.top === "number") {
    p.style.left = _plClampX(s.left) + "px";
    p.style.top  = _plClampY(s.top) + "px";
    p.style.right = "auto";
    p.style.bottom = "auto";
  }
  p.style.zIndex = s.pinned ? "99998" : "200";
  const pin = document.getElementById("pl-pin");
  if (pin) pin.style.color = s.pinned ? "#40d0ff" : "#909090";
  if (s.collapsed) _plCollapse(true); else _plExpand(true);
}

function _plClampX(x) {
  const p = _plPanel();
  const w = p ? p.getBoundingClientRect().width : 320;
  return Math.max(0, Math.min(window.innerWidth - Math.min(w, window.innerWidth), x));
}
function _plClampY(y) {
  return Math.max(0, Math.min(window.innerHeight - 44, y));
}

function _plEnsureChrome() {
  const p = _plPanel();
  if (!p) return;
  const head = p.querySelector(".playlist-header");
  if (!head || document.getElementById("pl-pin")) return;

  const mkBtn = function (id, txt, title, fn) {
    const b = document.createElement("button");
    b.id = id;
    b.textContent = txt;
    b.title = title;
    b.style.cssText = "background:none;border:none;color:#909090;cursor:pointer;" +
                      "font-size:1rem;padding:0 5px;line-height:1";
    b.onclick = function (e) { e.stopPropagation(); fn(); };
    return b;
  };

  const closeBtn = head.querySelector("button");
  const pin = mkBtn("pl-pin", "📌", "置顶显示", plTogglePin);
  const col = mkBtn("pl-collapse", "─", "折叠成图标", function () { _plCollapse(); });
  if (closeBtn) { head.insertBefore(pin, closeBtn); head.insertBefore(col, closeBtn); }
  else { head.appendChild(pin); head.appendChild(col); }

  head.style.cursor = "move";
  head.style.userSelect = "none";
  head.addEventListener("mousedown", _plStartDrag);
  head.addEventListener("touchstart", _plStartDrag, { passive: false });
}

function _plStartDrag(e) {
  const p = _plPanel();
  if (!p) return;
  if (e.target && e.target.tagName === "BUTTON") return;
  const t = e.touches ? e.touches[0] : e;
  const r = p.getBoundingClientRect();
  const ox = t.clientX - r.left;
  const oy = t.clientY - r.top;
  p.style.right = "auto";
  p.style.bottom = "auto";
  p.style.left = r.left + "px";
  p.style.top  = r.top + "px";

  const move = function (ev) {
    const q = ev.touches ? ev.touches[0] : ev;
    p.style.left = _plClampX(q.clientX - ox) + "px";
    p.style.top  = _plClampY(q.clientY - oy) + "px";
    if (ev.cancelable) ev.preventDefault();
  };
  const up = function () {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    document.removeEventListener("touchmove", move);
    document.removeEventListener("touchend", up);
    _plSave({ left: parseInt(p.style.left, 10) || 0, top: parseInt(p.style.top, 10) || 0 });
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  document.addEventListener("touchmove", move, { passive: false });
  document.addEventListener("touchend", up);
  if (e.cancelable) e.preventDefault();
}

function plTogglePin() {
  const s = _plState();
  const on = !s.pinned;
  _plSave({ pinned: on });
  const p = _plPanel();
  if (p) p.style.zIndex = on ? "99998" : "200";
  const pin = document.getElementById("pl-pin");
  if (pin) pin.style.color = on ? "#40d0ff" : "#909090";
  if (typeof showToast === "function") showToast(on ? "面板已置顶" : "已取消置顶");
}

function _plFloatIcon() {
  let ic = document.getElementById("pl-float-icon");
  if (ic) return ic;
  ic = document.createElement("div");
  ic.id = "pl-float-icon";
  ic.textContent = "🎵";
  ic.title = "展开播放列表";
  ic.style.cssText = "position:fixed;display:none;width:42px;height:42px;line-height:42px;" +
    "text-align:center;font-size:1.15rem;border-radius:50%;cursor:pointer;user-select:none;" +
    "background:#141d29;border:1px solid #2a3d55;box-shadow:0 4px 14px rgba(0,0,0,.5);z-index:2147483647";
  ic.addEventListener("mousedown", _plIconDrag);
  ic.addEventListener("touchstart", _plIconDrag, { passive: false });
  document.body.appendChild(ic);
  return ic;
}

function _plIconDrag(e) {
  const ic = _plFloatIcon();
  const t = e.touches ? e.touches[0] : e;
  const r = ic.getBoundingClientRect();
  const ox = t.clientX - r.left;
  const oy = t.clientY - r.top;
  let moved = false;
  const move = function (ev) {
    const q = ev.touches ? ev.touches[0] : ev;
    moved = true;
    ic.style.left = Math.max(0, Math.min(window.innerWidth - 42, q.clientX - ox)) + "px";
    ic.style.top  = Math.max(0, Math.min(window.innerHeight - 42, q.clientY - oy)) + "px";
    if (ev.cancelable) ev.preventDefault();
  };
  const up = function () {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    document.removeEventListener("touchmove", move);
    document.removeEventListener("touchend", up);
    if (moved) _plSave({ left: parseInt(ic.style.left, 10) || 0, top: parseInt(ic.style.top, 10) || 0 });
    else _plExpand();
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  document.addEventListener("touchmove", move, { passive: false });
  document.addEventListener("touchend", up);
  if (e.cancelable) e.preventDefault();
}

function _plCollapse(silent) {
  const p = _plPanel();
  const ic = _plFloatIcon();
  if (p) {
    const r = p.getBoundingClientRect();
    if (!silent) _plSave({ left: Math.round(r.left), top: Math.round(r.top) });
    p.style.display = "none";
  }
  const s = _plState();
  ic.style.left = _plClampX(typeof s.left === "number" ? s.left : window.innerWidth - 60) + "px";
  ic.style.top  = _plClampY(typeof s.top === "number" ? s.top : 70) + "px";
  try { document.body.appendChild(ic); } catch (e) {}
  ic.style.display = "block";
  if (!silent) _plSave({ collapsed: true });
}

function _plExpand(silent) {
  const p = _plPanel();
  const ic = document.getElementById("pl-float-icon");
  if (ic) ic.style.display = "none";
  if (p) {
    p.style.display = "";
    const s = _plState();
    if (typeof s.left === "number") {
      p.style.left = _plClampX(s.left) + "px";
      p.style.top  = _plClampY(s.top) + "px";
      p.style.right = "auto";
      p.style.bottom = "auto";
    }
  }
  if (!silent) _plSave({ collapsed: false });
}

document.addEventListener("DOMContentLoaded", function () {
  setTimeout(function () { _plEnsureChrome(); _plApplyState(); }, 400);
});

window.addEventListener("resize", function () {
  const p = _plPanel();
  if (p && p.style.left) {
    p.style.left = _plClampX(parseInt(p.style.left, 10) || 0) + "px";
    p.style.top  = _plClampY(parseInt(p.style.top, 10) || 0) + "px";
  }
  const ic = document.getElementById("pl-float-icon");
  if (ic && ic.style.display === "block") {
    ic.style.left = _plClampX(parseInt(ic.style.left, 10) || 0) + "px";
    ic.style.top  = _plClampY(parseInt(ic.style.top, 10) || 0) + "px";
  }
});

// ══ 详细信息悬浮层 ═══════════════════════════════════
const VI_KEY = "viewerInfoMode";
let _viTimer = null;

function _viMode() {
  try { return localStorage.getItem(VI_KEY) || "auto"; } catch (e) { return "auto"; }
}

function _viInfo() { return document.querySelector(".viewer-info"); }

function _viSetup() {
  const info = _viInfo();
  const body = document.querySelector(".viewer-body");
  if (!info || !body) return;
  if (info.classList.contains("vi-float")) return;

  body.appendChild(info);
  info.classList.add("vi-float");
  if (_viMode() === "off") info.classList.add("vi-off");

  try {
    const vw = document.getElementById("viewer");
    const head = (vw || document).querySelector(".viewer-header");
    if (head && !document.getElementById("vi-toggle")) {
      const b = document.createElement("button");
      b.id = "vi-toggle";
      b.textContent = "ℹ";
      b.title = "详细信息 显示/隐藏";
      b.style.cssText = "background:none;border:none;color:#909090;cursor:pointer;" +
                        "font-size:1.05rem;padding:0 6px;line-height:1";
      b.onclick = function (e) { e.stopPropagation(); viToggleInfo(); };
      head.appendChild(b);
      if (_viMode() === "off") b.style.color = "#4a5a6a";
    }
  } catch (e) { console.log("_viSetup 按钮注入失败(不影响信息层):", e.message); }

  body.addEventListener("mousemove", viFlash);
  body.addEventListener("touchstart", viFlash, { passive: true });
  viFlash();
}

function viFlash() {
  const info = _viInfo();
  if (!info || !info.classList.contains("vi-float")) return;
  if (_viMode() === "off") return;
  info.classList.remove("vi-hide");
  clearTimeout(_viTimer);
  _viTimer = setTimeout(function () {
    const el = _viInfo();
    if (el) el.classList.add("vi-hide");
  }, 2500);
}

function viToggleInfo() {
  const info = _viInfo();
  if (!info) return;
  const off = _viMode() !== "off";
  try { localStorage.setItem(VI_KEY, off ? "off" : "auto"); } catch (e) {}
  const btn = document.getElementById("vi-toggle");
  if (off) {
    info.classList.add("vi-off");
    if (btn) btn.style.color = "#4a5a6a";
    if (typeof showToast === "function") showToast("已隐藏详细信息");
  } else {
    info.classList.remove("vi-off");
    if (btn) btn.style.color = "#909090";
    viFlash();
    if (typeof showToast === "function") showToast("详细信息: 移动鼠标显示");
  }
}

document.addEventListener("keydown", function () {
  const vw = document.getElementById("viewer");
  if (vw && vw.classList.contains("show")) viFlash();
});

document.addEventListener("DOMContentLoaded", function () {
  setTimeout(_viSetup, 400);

  if (document.getElementById("vi-style")) return;
  const st = document.createElement("style");
  st.id = "vi-style";
  st.textContent = [
    ".viewer-info.vi-float{position:absolute;left:0;right:0;bottom:0;z-index:12;",
    "padding:10px 16px 12px;margin:0;",
    "background:linear-gradient(to top,rgba(0,0,0,.88),rgba(0,0,0,.55) 55%,transparent);",
    "opacity:1;transition:opacity .25s ease;pointer-events:none}",
    ".viewer-info.vi-float.vi-hide{opacity:0}",
    ".viewer-info.vi-float.vi-off{display:none}",
    ".viewer-info.vi-float .info-item{font-size:.72rem;text-shadow:0 1px 3px rgba(0,0,0,.9)}",
    "@media(max-width:700px){.viewer-info.vi-float{padding:8px 12px 10px;gap:10px}",
    ".viewer-info.vi-float .info-item{font-size:.68rem}}"
  ].join("");
  document.head.appendChild(st);
});

// ══ 信息层路径: 可选中 / 点击复制 / 跳转目录 ──────────
let _viCurPath = "";

function _viPathSetup(el, fullPath) {
  _viCurPath = fullPath || "";
  el.style.pointerEvents = "auto";
  el.style.userSelect    = "text";
  el.style.cursor        = "pointer";
  el.title               = "点击复制完整路径";
  if (!el._viBound) {
    el._viBound = true;
    el.addEventListener("click", function (e) {
      var sel = window.getSelection && window.getSelection().toString();
      if (sel && sel.length > 2) return;
      e.stopPropagation();
      viCopyPath();
    });
  }
  _viEnsurePathBtn(el);
}

function _viEnsurePathBtn(pathEl) {
  if (document.getElementById("vi-opendir")) return;
  var host = pathEl.parentElement || pathEl;
  var b = document.createElement("span");
  b.id = "vi-opendir";
  b.textContent = "📂";
  b.title = "跳转到所在目录";
  b.style.cssText = "margin-left:8px;cursor:pointer;pointer-events:auto;" +
                    "font-size:.85rem;opacity:.75;user-select:none";
  b.onclick = function (e) { e.stopPropagation(); viOpenDir(); };
  try { host.appendChild(b); } catch (err) {}
}

function viCopyPath() {
  if (!_viCurPath) return;
  var done = function () {
    if (typeof showToast === "function") showToast("路径已复制");
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(_viCurPath).then(done, _viCopyFallback);
      return;
    }
  } catch (e) {}
  _viCopyFallback();
}

function _viCopyFallback() {
  try {
    var ta = document.createElement("textarea");
    ta.value = _viCurPath;
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (typeof showToast === "function") showToast(ok ? "路径已复制" : "复制失败, 请手动选中");
  } catch (e) {
    if (typeof showToast === "function") showToast("复制失败, 请手动选中");
  }
}

function viOpenDir() {
  if (!_viCurPath) return;
  var dir = _viCurPath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  if (!dir) { if (typeof showToast === "function") showToast("无法解析目录"); return; }
  try {
    clearSearchQuery();
    state.filter.dirPath = dir;
    if (typeof closeViewer === "function") closeViewer();
    loadPhotos(true);
    if (typeof refreshTagDirs === "function") { try { refreshTagDirs(); } catch (e) {} }
    if (typeof showToast === "function") showToast("已跳转: " + dir.split("/").slice(-2).join("/"));
  } catch (e) {
    if (typeof showToast === "function") showToast("跳转失败");
  }
}

// ══ 视频库入口 ──────────────────────────────────────────
document.addEventListener("DOMContentLoaded", function () {
  setTimeout(function () {
    if (document.getElementById("vlink-btn")) return;

    var a = document.createElement("a");
    a.id = "vlink-btn";
    a.href = "/videoer/";
    a.textContent = "\u{1F3AC} 视频";
    a.title = "视频库";
    a.style.cssText = "display:inline-flex;align-items:center;gap:4px;" +
      "padding:5px 12px;margin-left:8px;border-radius:6px;cursor:pointer;" +
      "background:transparent;border:1px solid #2a3d55;color:#8aa8c8;" +
      "font-size:.76rem;text-decoration:none;white-space:nowrap";
    a.onmouseenter = function () { a.style.borderColor = "#40d0ff"; a.style.color = "#40d0ff"; };
    a.onmouseleave = function () { a.style.borderColor = "#2a3d55"; a.style.color = "#8aa8c8"; };

    var host = document.querySelector(".topbar") ||
               document.querySelector(".header") ||
               document.querySelector("header") ||
               (document.getElementById("ai-bar-toggle") || {}).parentElement;
    if (host) {
      try { host.appendChild(a); return; } catch (e) {}
    }
    a.style.cssText += ";position:fixed;top:10px;right:14px;z-index:120;background:#141d29";
    document.body.appendChild(a);
  }, 500);
});