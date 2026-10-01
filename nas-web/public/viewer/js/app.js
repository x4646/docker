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
  viewer:    { index:-1, zoom:1, panX:0, panY:0, rotate:0, dragging:false, lastX:0, lastY:0 },
  slideshow: { active:false, timer:null, interval:4000 },
  music:     { audio:null, playlist:[], index:0, playing:false, mode:'shuffle', volume:0.6 },
  playlists: [],
  tags:      [],
  selectMode: false,
  selectedIds: new Set(),
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
  // 2026-09-20加: 必须在_restoreBrowseState()(会立刻触发loadPhotos)之前就把
  // _familyGateActive算好并await完——否则首次打开页面时loadPhotos可能会在家庭限制
  // 状态确定之前就先发出去一次不受限制的请求, 泄露一瞬间的完整内容。
  try {
    const _roles = await fetch('/api/roles').then(r => r.json());
    _familyGateActive = _isFamilyRole(getEffectiveRole(_roles));
  } catch (e) { /* 拉角色列表失败: 保持_familyGateActive默认false, 不影响后续正常使用 */ }
  _restoreBrowseState();
  setupIntersectionObserver();
  setupKeyboard();
  setupViewer();
  _applyColCount(_loadColCount());
  if (typeof renderRoleSwitchButton === 'function') renderRoleSwitchButton();
  loadSidebar().catch(function(e){ console.error('sidebar', e); });
  loadPlaylists()
    .then(function(){ return loadMusicSettings(); })
    .then(function(){ restoreLastPlay(); })
    .catch(function(e){ console.error('music', e); });
  _loadTagsLast();
}

// ── 侧边栏 ────────────────────────────────────────────

async function loadPcPhotos(pcPath) {
  closeSidebarDrawer();
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
  // 2026-09-20改: 不再直接信localStorage里存的角色——先拉角色列表算出"本次实际生效"的
  // 角色(默认家庭, 没解锁密码就不能用"全部"或其他角色), 再决定侧边栏目录树给哪些根目录。
  let _allRoles = [];
  try { _allRoles = await fetch('/api/roles').then(r => r.json()); } catch (e) {}
  const _effectiveRole = getEffectiveRole(_allRoles);
  _familyGateActive = _isFamilyRole(_effectiveRole);
  if (_effectiveRole) {
    _nasViewRoots.fn = async () => {
      const roots = _effectiveRole.allowed_roots || [];
      return roots.map(p => ({ name: p.split('/').filter(Boolean).pop() || p, path: p, hasChildren: true }));
    };
  }
  const _roleBtn = document.getElementById('role-switch-btn');
  if (_roleBtn) _roleBtn.textContent = _effectiveRole ? (_effectiveRole.icon + ' ' + _effectiveRole.name) : '🌐 全部';
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
    // 2026-09-23修复: instanceId跟着当前生效角色变, 不同角色(家庭/admin/全部)各自的
    // 根目录列表不一样, 之前用固定的'viewer_nas'会导致切角色后缓存里存的还是上一个角色
    // 的根目录列表, 比如切到admin后目录树该出现的/share/Person短暂/持续显示不出来。
    instanceId: 'viewer_nas_' + (_effectiveRole ? _effectiveRole.id : 'all') + (_familyGateActive ? '_fam' : ''),
    mode: 'single',
    showRefresh: true,
    rootsFn: _nasViewRoots.fn,
    childrenFn: async (path) => {
      // 2026-10-01: viewer 的目录树只显示"库里有照片"的目录(media=photo, 走数据库, 不扫盘; 与 videoer 共用同一个接口)。
      // 不带这个参数时后端会把磁盘上所有子目录(含没有图片的)先放行再慢慢判定, 缓存一失效(目录改过/服务重启/5分钟过期)就变成"全部显示"。
      return await fetch('/api/dir-tree?source=nas&media=photo&path=' + encodeURIComponent(path) + (_familyGateActive ? '&category=family' : '')).then(r => r.json());
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
  if (reset) _undoClear();
  if (!state.pcMode) state.filter.dirPath = state.filter.dirPath;
  if (state.loading || (!reset && !state.hasMore)) return;
  if (reset) { closeSidebarDrawer(); state.page = 1; state.photos = []; state.hasMore = true; _photoLoadGen++; }
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
  // 2026-09-23加: "全部"默认浏览(不带任何筛选条件)之前一直是按时间倒序, 每次打开
  // 都是同一批最新照片排在最前面, 翻页也总是那个顺序。改成"文件夹随机排序, 文件夹内
  // 部顺序不变"(见/api/photo-tags/photos的dirSeed参数), 种子存在sessionStorage,
  // 同一次会话内翻页顺序保持稳定(不重不漏), 重新打开浏览器/新标签页才会换一批顺序。
  const _advOn = _advActive();
  const _wantDirRandom = !dirPath && !q && !tags.length && !favorite && !year && !month &&
                         !ratings.length && !state.aiFilter.tags.length && !_advOn;
  // 2026-09-20修复: 家庭模式下之前只在"按目录浏览"时通过dirPath间接限制能看到的内容,
  // 点"收藏"/"全部"/年月/搜索这些不带dirPath的入口时限制直接失效, 什么都能看到。
  // /api/photos(全部/年月浏览走的接口)是TS编译产物冻结区, 不能碰; /api/photo-tags/photos
  // 这条JS热加载的接口本来就支持category=family|adult(dir_category表驱动, videoer已经在用),
  // 所以家庭模式下强制全部走这条接口, 统一用category=family兜底, 不依赖dirPath。
  const _sortMode = _getSortMode();
  const _nameSort = _sortMode === 'name' || (_sortMode === 'folder' && !!dirPath);   // 选了目录默认按文件名顺序
  // 随机/正序只有 /api/photo-tags/photos 支持, 所以选了这两种排序时一律走它; 文件夹乱序只在"全部"(没有任何筛选)时有意义
  const _useTagApi = _familyGateActive || state.aiFilter.tags.length || tags.length || ratings.length ||
                     (favorite && !q && !year && !month) || _wantDirRandom || ['random', 'name', 'asc', 'res_desc', 'res_asc', 'ratio'].includes(_sortMode) || _nameSort || _advOn;
  if (_useTagApi) {
    const useTags = state.aiFilter.tags.length ? state.aiFilter.tags : tags;
    const useMode = state.aiFilter.tags.length ? state.aiFilter.mode : 'or';
    url = `/api/photo-tags/photos?page=${state.page}&limit=50&mode=${useMode}&threshold=${tagThreshold}&mediaType=photo`;
    if (useTags.length) url += `&tags=${useTags.map(encodeURIComponent).join(',')}`;
    if (ratings.length) url += `&ratings=${ratings.join(',')}`;
    if (dirPath) url += `&dirPath=${encodeURIComponent(dirPath)}`;
    if (favorite) url += `&favorite=1`;
    if (q) url += `&q=${encodeURIComponent(q)}`;
    if (_familyGateActive) url += `&category=family`;
    if (_wantDirRandom && _sortMode === 'folder') url += `&dirSeed=${_getDirSeed()}`;
    else if (_sortMode === 'random') url += `&seed=${_getSeed()}`;
    else if (_nameSort) url += `&sortFields=name:asc`;
    else if (_sortMode === 'asc') url += `&order=asc`;
    else if (_sortMode === 'res_desc') url += `&sortFields=resolution:desc`;
    else if (_sortMode === 'res_asc') url += `&sortFields=resolution:asc`;
    else if (_sortMode === 'ratio') url += `&sortFields=ratio:asc`;
    if (_advOn) url += _advParams(!!year);   // 年/月筛选已经带了 minDate/maxDate 时, 筛选面板里的日期不再重复追加
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
  setTimeout(() => { if (typeof _applyLayout === 'function') _applyLayout(); }, 0);   // 等这批卡片入 DOM 后按平均宽高比重算行高

  photos.forEach((p, i) => {
    const idx      = clear ? i : state.photos.length - photos.length + i;
    const item     = document.createElement('div');
    item.className = 'photo-item';
    item.dataset.idx = idx;
    item.dataset.id  = p.id;
    item.style.setProperty('--r', _ratioOf(p));   // 等高行排布用: 宽高比
    // 鼠标移到其他图片时自动关闭右键菜单
    item.onmouseenter = function() { ctxMenu.hide(); };
    const tags     = [..._parseTags(p.user_tags), ..._parseTags(p.ai_tags)].slice(0,3);
    const favClass = p.favorite ? 'active' : '';

    // 占位框用真实宽高提前撑开(数据库本来就存了), 没加载出来之前就是一个跟最终图片
    // 差不多大小的骨架框, 不会"缩成一条缝、图片一起炸出来"; 拿不到宽高就退回4:3兜底比例。
    const ratio = (p.width && p.height) ? `${p.width}/${p.height}` : '4/3';
    item.innerHTML = `
      <input type="checkbox" class="sel-check" onclick="event.stopPropagation(); onSelCheckChange(this, ${p.id})">
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

    item.addEventListener('click', () => {
      if (state.selectMode) {
        const cb = item.querySelector('.sel-check');
        cb.checked = !cb.checked;
        onSelCheckChange(cb, p.id);
        return;
      }
      openViewer(idx);
    });
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
        { icon: "🗑",  text: "放入回收站",    action: () => softDeleteGridPhoto(photo) },
      ]);
    });
    grid.appendChild(item);
    const img = item.querySelector('img[data-src]');
    if (img) _thumbObserver.observe(img);
    if (state.selectMode && state.selectedIds.has(p.id)) {
      item.classList.add('selected');
      const cb = item.querySelector('.sel-check');
      if (cb) cb.checked = true;
    }
  });
}

// ── 列数调节(2~5列, 默认3, 记到localStorage) ────────────
const COL_MIN = 1, COL_MAX = 20, COL_DEFAULT = 3;   // 2026-10-01: 列数 1~20(原来 2~5)
function _loadColCount() {
  const v = parseInt(localStorage.getItem('viewerColCount') || '3', 10);
  return (v >= COL_MIN && v <= COL_MAX) ? v : COL_DEFAULT;
}
function _applyColCount(n) {
  const grid = document.getElementById('photo-grid');
  if (grid) { grid.style.setProperty('--col-count', n); grid.dataset.cols = String(n); }
  if (typeof _applyLayout === 'function') _applyLayout(true);
  const _sl = document.getElementById('col-count-slider'); if (_sl) _sl.value = n;
  const val = document.getElementById('col-count-val');
  if (val) val.textContent = n;
  const minusBtn = document.getElementById('col-count-minus');
  const plusBtn  = document.getElementById('col-count-plus');
  if (minusBtn) minusBtn.disabled = n <= COL_MIN;
  if (plusBtn)  plusBtn.disabled  = n >= COL_MAX;
  localStorage.setItem('viewerColCount', String(n));
}
function adjustColCount(delta) {
  const n = Math.max(COL_MIN, Math.min(COL_MAX, _loadColCount() + delta));
  _applyColCount(n);
}

// ── 批量选择/软删除(逻辑删除: 只打标记, 不碰文件, 去"回收站"页面才会真的删) ──
function toggleSelectMode() {
  if (state.selectMode) exitSelectMode();
  else enterSelectMode();
}
function enterSelectMode() {
  state.selectMode = true;
  const grid = document.getElementById('photo-grid');
  if (grid) grid.classList.add('select-mode');
  const btn = document.getElementById('btn-select-mode');
  if (btn) btn.classList.add('active');
  const ft = document.getElementById('floating-toolbar');
  if (ft) ft.classList.add('hide');  // 选择模式下用batch-bar顶替这个位置, 两个不同时显示
  updateBatchBar();
}
function exitSelectMode() {
  state.selectMode = false;
  state.selectedIds.clear();
  const grid = document.getElementById('photo-grid');
  if (grid) grid.classList.remove('select-mode');
  const btn = document.getElementById('btn-select-mode');
  if (btn) btn.classList.remove('active');
  const ft = document.getElementById('floating-toolbar');
  if (ft) ft.classList.remove('hide');
  document.querySelectorAll('#photo-grid .photo-item.selected').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('#photo-grid .sel-check').forEach(cb => cb.checked = false);
  updateBatchBar();
}
function onSelCheckChange(cb, id) {
  if (cb.checked) state.selectedIds.add(id); else state.selectedIds.delete(id);
  const item = cb.closest('.photo-item');
  if (item) item.classList.toggle('selected', cb.checked);
  updateBatchBar();
}
function selectAllVisible() {
  document.querySelectorAll('#photo-grid .photo-item').forEach(item => {
    const idx = parseInt(item.dataset.idx, 10);
    const photo = state.photos[idx];
    if (!photo) return;
    const cb = item.querySelector('.sel-check');
    if (cb) cb.checked = true;
    state.selectedIds.add(photo.id);
    item.classList.add('selected');
  });
  updateBatchBar();
}
function updateBatchBar() {
  const bar = document.getElementById('batch-bar');
  if (!bar) return;
  const cnt = document.getElementById('batch-count');
  if (cnt) cnt.textContent = state.selectedIds.size;
  bar.classList.toggle('show', state.selectMode);
}
async function batchSoftDelete() {
  const ids = [...state.selectedIds];
  if (!ids.length) { showToast('还没选择任何照片', 'error'); return; }
  if (!confirm(`确认把选中的${ids.length}张放入回收站？\n(不会立即删除文件, 只是从这里隐藏; 去"回收站"页面确认之后才会真正删除原文件)`)) return;
  try {
    const r = await fetch('/api/photos/soft-delete', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ ids }) });
    if (!r.ok) throw new Error('请求失败');
    state.photos = state.photos.filter(p => !state.selectedIds.has(p.id));
    state.total  = Math.max(0, state.total - ids.length);
    exitSelectMode();
    renderGrid(state.photos, true);
    updateStats();
    showToast(`已放入回收站 ${ids.length} 张`);
  } catch (e) {
    showToast('操作失败', 'error');
  }
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
  _undoClear();
  state.viewer.index = idx;
  resetViewerTransform();
  showViewerPhoto();
  document.getElementById('viewer').classList.add('show');
  document.body.style.overflow = 'hidden';
  if (state.music.mode === 'auto' && !state.music.playing) playMusic();
}

function closeViewer() {
  _undoClear();
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
  // 之前是[-1,+1,+2](前面只预加载1张), 连续往回滑几张时后面几张会等网络卡一下,
  // 改成前后对称各2张
  [idx - 2, idx - 1, idx + 1, idx + 2].forEach(function (i) {
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
  state.viewer.rotate = 0;  // 旋转只对当前这张生效, 切到下一张自动清零
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
  { const _t = Math.max(state.total || 0, state.photos.length), _left = Math.max(0, _t - (idx + 1));
    document.getElementById('viewer-counter').textContent = `${idx+1} / ${_t}` + (_left ? ` · 还剩 ${_left} 张` : ' · 最后一张');
    const _pb = document.getElementById('viewer-progress-bar'); if (_pb) _pb.style.width = (_t ? (idx + 1) / _t * 100 : 0) + '%'; }
  document.getElementById('btn-prev').style.opacity = idx > 0 ? '1' : '0.3';
  document.getElementById('btn-next').style.opacity = idx < total-1 || state.hasMore ? '1' : '0.3';
}

function viewerPrev() {
  _undoClear();
  if (state.viewer.index > 0) { state.viewer.index--; resetViewerTransform(); showViewerPhoto(); }
}

function viewerNext() {
  _undoClear();
  if (state.viewer.index < state.photos.length - 1) {
    state.viewer.index++;
    resetViewerTransform();
    showViewerPhoto();
    if (state.viewer.index > state.photos.length - 10) loadPhotos();
  } else if (!state.hasMore) {
    _viewerNextDir();   // 当前目录播完了: 接着播离它最近的下一个目录
  }
}

// 当前列表播完后, 自动切到"离当前目录最近的下一个有照片的目录"并从第一张开始(幻灯片/手动翻页都适用)
let _edgeBusy = false;
async function _viewerNextDir() {
  if (_edgeBusy || state.loading || state.pcMode) return;
  _edgeBusy = true;
  try {
    const cur = state.photos[state.viewer.index];
    let scope = state.filter.dirPath || (cur ? _dirFull(cur) : '');
    for (let i = 0; i < 15 && scope; i++) {
      const u = '/api/photo-tags/dir-neighbor?media=photo&dir=next&path=' + encodeURIComponent(scope) + (_familyGateActive ? '&category=family' : '');
      const r = await fetch(u).then(x => x.json());
      if (!r.dir) { if (typeof showToast === 'function') showToast('已经是最后一个目录了', 'info'); return; }
      state.filter.dirPath = r.dir;
      await loadPhotos(true);
      if (state.photos.length) {
        state.viewer.index = 0;
        resetViewerTransform();
        showViewerPhoto();
        if (typeof showToast === 'function') showToast('下一个目录: ' + r.dir.split('/').slice(-2).join('/'), 'info');
        return;
      }
      scope = r.dir;   // 这个目录在当前筛选下没有内容, 继续找下一个
    }
  } catch (e) { console.error('下一个目录失败', e); }
  finally { _edgeBusy = false; }
}

// ── 缩放拖拽 ──────────────────────────────────────────
function setupViewer() {
  const wrap = document.getElementById('viewer-img-wrap');
  // iOS Safari双指捏合会额外触发一套独立的gesture*事件(非标准, 只有WebKit有),
  // 这套事件不受touch-action/touchmove里的preventDefault约束, 会绕过下面的
  // touchstart/touchmove自己实现的缩放逻辑, 直接触发系统级整页缩放(缩放的是已经
  // 显示出来的小图, 越放越糊, 而且state.viewer.zoom完全没变, 换原图的判断也就
  // 永远不会触发)。这里专门拦一下gesture*事件, 强制走自己这套跟手缩放。
  wrap.addEventListener('gesturestart',  (e) => e.preventDefault());
  wrap.addEventListener('gesturechange', (e) => e.preventDefault());
  wrap.addEventListener('gestureend',    (e) => e.preventDefault());
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
  // 滑动切换上一张/下一张: 只在没缩放(zoom<=1.01)、单指移动时才判定, 跟双指缩放/
  // 放大后单指平移互不干扰。swipeAxis为null时先看移动方向再"锁定"横滑还是竖滑,
  // 竖滑直接忽略(灯箱里没有竖向可滚动的内容, 忽略掉是安全的空操作)。
  let swipeStartX = 0, swipeStartY = 0, swipeStartT = 0, swipeAxis = null;
  function centerOf(t0, t1, rect) {
    return {
      x: (t0.clientX + t1.clientX) / 2 - (rect.left + rect.width / 2),
      y: (t0.clientY + t1.clientY) / 2 - (rect.top + rect.height / 2)
    };
  }
  wrap.addEventListener('touchstart', (e) => {
    const rect = wrap.getBoundingClientRect();
    swipeAxis = null;
    if (e.touches.length === 2) {
      touchMode = 2;
      lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const c = centerOf(e.touches[0], e.touches[1], rect);
      pinchCX = c.x; pinchCY = c.y;
    } else if (e.touches.length === 1) {
      touchMode = 1;
      oneX = e.touches[0].clientX; oneY = e.touches[0].clientY;
      swipeStartX = oneX; swipeStartY = oneY; swipeStartT = Date.now();
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
    } else if (e.touches.length === 1 && touchMode === 1) {
      const dx = e.touches[0].clientX - swipeStartX;
      const dy = e.touches[0].clientY - swipeStartY;
      if (swipeAxis === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        swipeAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (swipeAxis === 'x') {
        e.preventDefault();
        // 2026-09-20: 之前松手才判定, 手指划的过程画面完全不跟手, 体感生硬——
        // 改成跟手实时位移, 松手后再补一段短渡场(下面slideCommitNext/slideSnapBack)
        wrap.style.transition = 'none';
        wrap.style.transform = 'translateX(' + dx + 'px)';
      }
    }
  }, { passive: false });

  // 滑动松手后的收尾动画: 达到阈值就顺势滑完整程切到下一张/上一张, 没到阈值就弹回原位。
  // 幻灯片自动播放时wrap的transform/transition归state.slideshow那套转场系统管,
  // 这里让位, 不跟它抢——避免两套动画同时改同一个元素打架。
  function slideCommitNext(dir) {
    if (state.slideshow.active) { if (dir > 0) viewerNext(); else viewerPrev(); return; }
    const w = wrap.getBoundingClientRect().width || window.innerWidth;
    wrap.style.transition = 'transform .14s ease-in';
    wrap.style.transform = 'translateX(' + (dir > 0 ? -w : w) + 'px)';
    setTimeout(function () {
      if (dir > 0) viewerNext(); else viewerPrev();
      // viewerNext/viewerPrev最终会走到swapPhoto, 非幻灯片分支里会把wrap的
      // transform/opacity/transition同步重置成默认值——这里要在同一个事件循环内
      // 紧接着覆盖回"从对侧进入"的起始位置才能接上滑入动画(浏览器不会画出中间那一帧)
      wrap.style.transition = 'none';
      wrap.style.transform = 'translateX(' + (dir > 0 ? w : -w) + 'px)';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          wrap.style.transition = 'transform .22s cubic-bezier(.22,.61,.36,1)';
          wrap.style.transform = 'translateX(0)';
        });
      });
    }, 140);
  }
  function slideSnapBack() {
    if (state.slideshow.active) return;
    wrap.style.transition = 'transform .2s ease-out';
    wrap.style.transform = 'translateX(0)';
  }

  wrap.addEventListener('touchend', (e) => {
    if (touchMode === 1 && swipeAxis === 'x') {
      if (state.viewer.zoom <= 1.01) {
        // touchend时e.touches已经空了, 手指最终位置要从changedTouches拿
        const endX = e.changedTouches[0].clientX;
        const dx = endX - swipeStartX;
        const dt = Date.now() - swipeStartT;
        const velocity = Math.abs(dx) / Math.max(dt, 1);
        if (Math.abs(dx) > 50 || (Math.abs(dx) > 24 && velocity > 0.5)) {
          slideCommitNext(dx < 0 ? 1 : -1);
        } else {
          slideSnapBack();
        }
      } else {
        slideSnapBack();
      }
    }
    swipeAxis = null;
    if (e.touches.length === 0) {
      touchMode = 0;
    } else if (e.touches.length === 1) {
      // 双指缩放松开一根手指变成单指: 重新记录起点, 避免残留坐标触发一次误判的滑动切换
      touchMode = 1;
      oneX = e.touches[0].clientX; oneY = e.touches[0].clientY;
      swipeStartX = oneX; swipeStartY = oneY; swipeStartT = Date.now();
    }
  }, { passive: true });
  wrap.addEventListener('touchcancel', () => {
    if (swipeAxis === 'x') { wrap.style.transition = 'none'; wrap.style.transform = 'translateX(0)'; }
    swipeAxis = null; touchMode = 0;
  });
}

function applyTransform() {
  const img   = document.getElementById('viewer-img');
  const photo = state.photos[state.viewer.index];
  img.style.transition = 'none';
  img.style.transform  = `translate(${state.viewer.panX}px, ${state.viewer.panY}px) scale(${state.viewer.zoom}) rotate(${state.viewer.rotate}deg)`;

  const isPcPath = photo && /^[A-Za-z]:/.test(photo.path);
  const getOrigSrc = (ph) => isPcPath ? `/api/pc/file/${encodeURIComponent(ph.path)}` : `/original${ph.path}`;
  // preview固定按1920px长边生成, 但手机屏幕devicePixelRatio普遍是2~3(高分屏),
  // 同样的CSS缩放倍数在手机上实际占用的物理像素比桌面(DPR通常=1)多得多——原来固定
  // "zoom>2"才换原图是按桌面DPR=1估的, 手机上放大到2倍以内预览图物理像素就已经不够
  // 用了(被浏览器拉伸糊掉), 看起来"怎么放大都是糊的缩略图"。改成按DPR动态算阈值:
  // DPR越高, 越早换原图; 桌面(DPR=1)保持原来的2倍不变。
  const _dpr = window.devicePixelRatio || 1;
  const ZOOM_SWAP = Math.max(1.15, 2 / _dpr);
  if (state.viewer.zoom > ZOOM_SWAP && photo && img.dataset.mode !== 'original') {
    img.dataset.mode = 'original';
    const src = getOrigSrc(photo);
    const currentId = photo.id;
    const tmp = new Image();
    tmp.onload = () => {
      const curPhoto = state.photos[state.viewer.index];
      if (curPhoto && curPhoto.id === currentId) { img.src = src; img.dataset.mode = 'original'; }
    };
    tmp.src = src;
  } else if (state.viewer.zoom <= ZOOM_SWAP && img.dataset.mode === 'original') {
    img.dataset.mode = 'preview';
    if (photo) img.src = photo.preview_path ? `/preview/${_relUnder(photo.preview_path, 'preview')}` : getOrigSrc(photo);
  }
}

function resetViewerTransform() {
  state.viewer.zoom = 1; state.viewer.panX = 0; state.viewer.panY = 0; state.viewer.rotate = 0;
  const img = document.getElementById('viewer-img');
  if (img) { img.style.transition = 'none'; applyTransform(); }
}

// 2026-09-23改回手动按钮: 原计划用CSS的orientation媒体查询跟随手机横竖屏自动转,
// 但那个只在系统"自动旋转"开着、屏幕真的跟着物理转向变化时才生效——用户关掉了系统的
// 自动旋转锁定, 屏幕不会跟着转, 检测直接失效。改用accelerometer(DeviceOrientationEvent)
// 的话又要求页面跑在HTTPS上(这里是局域网http, 传感器API会被浏览器直接屏蔽), 不现实。
// 所以改回最简单可靠的方案: 手动点按钮转90°, 不依赖系统设置/协议, 稳定能用。
function rotateViewer() {
  state.viewer.rotate = (state.viewer.rotate + 90) % 360;
  applyTransform();
}

// 全屏: 让图片撑满整个屏幕(object-fit:contain保比例, 见CSS, 不裁剪不拉伸)。
// Android/桌面浏览器支持元素级Fullscreen API, 直接调用, 隐藏浏览器地址栏等系统UI,
// 已有的fullscreenchange监听会自动隐藏header/footer腾出空间。iOS Safari完全不支持
// 这个API(webkit前缀也没有), 退化成手动隐藏header/footer(见CSS里.manual-fs规则),
// 拿不到"真全屏"(地址栏还在), 但图片本身能占满除地址栏外的所有空间。
function toggleFullscreen() {
  const el = document.getElementById('viewer');
  const supportsFs = !!(el.requestFullscreen || el.webkitRequestFullscreen);
  if (supportsFs) {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (isFs) {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } else {
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
  } else {
    el.classList.toggle('manual-fs');
  }
}

// 下载当前大图原图。iOS Safari不支持<a download>强制下载(点了会直接在新标签页打开图片),
// 这是iOS系统限制, 不是bug——检测到iOS就换成"新标签页打开+提示长按保存"这条路径;
// Android/桌面浏览器都支持download属性, 直接触发下载, 文件名用原始文件名。
function downloadCurrentPhoto() {
  const photo = state.photos[state.viewer.index];
  if (!photo) return;
  const isPcPath = /^[A-Za-z]:/.test(photo.path);
  const url = isPcPath ? `/api/pc/file/${encodeURIComponent(photo.path)}` : `/original${photo.path}`;
  const filename = photo.path.split(/[\\/]/).pop() || 'photo.jpg';
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) {
    window.open(url, '_blank');
    if (typeof showToast === 'function') showToast('苹果浏览器不支持直接下载, 长按图片选择"存储图像"即可保存');
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
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
let _delArmed = false;
function setupKeyboard() {
  document.addEventListener('keyup', (e) => {
    if (e.key !== 'Delete' || !_delArmed) return;
    _delArmed = false;
    if (!document.getElementById('viewer').classList.contains('show')) return;
    softDeleteCurrentPhoto();
  });
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
      case 'Delete': {
        // 2026-10-01: Del 键: 按下只是"待命", 抬起(keyup)时才执行, 和右键菜单的"放入回收站"是同一个动作; 按多久都无所谓, 只会删一次
        const t = e.target; if ((t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) || (t && t.isContentEditable)) break;
        e.preventDefault(); _delArmed = true; break;
      }
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

// 2026-09-30: 标签云放到最后加载——页面(照片/缩略图)全部加载完、浏览器空闲后再取, 不抢首屏。
// 标签云查询在后端冷启动要5秒多(同步查询会卡住整个 nas-media), 所以宁可晚一点。
let _tagsLastDone = false;
function _loadTagsLast() {
  if (_tagsLastDone) return;
  _tagsLastDone = true;
  const go = function () {
    const idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1); };
    idle(function () { loadTags().catch(function (e) { console.error('tags', e); }); }, { timeout: 15000 });
  };
  if (document.readyState === 'complete') setTimeout(go, 6000);
  else window.addEventListener('load', function () { setTimeout(go, 6000); });
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
    const t = ev.touches ? ev.touches[0] : ev;
    const rect = bar.getBoundingClientRect();
    let r = (t.clientX - rect.left) / rect.width;
    r = Math.max(0, Math.min(1, r));
    audio.currentTime = r * audio.duration;
    updateProgress();
    if (ev.cancelable) ev.preventDefault();
  };
  const up = function () {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', up);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  document.addEventListener('touchmove', move, { passive: false });
  document.addEventListener('touchend', up);
  if (e.cancelable) e.preventDefault();
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
function updateStats() {
  const el = document.getElementById('stats-total'); if (el) el.textContent = state.total;
  const el2 = document.getElementById('float-stats-total'); if (el2) el2.textContent = state.total;
}
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

// 2026-09-20: 间隔范围从1~30秒线性拉宽到0.3~60秒后, 滑块如果还是线性映射,
// 拖动1像素在高端(60秒附近)就能跳好几秒, 低端(0.3~3秒)又挤在一起根本调不精细。
// 改成对数刻度: 滑块本身还是0~100这个普通range, 但换算成秒数时按指数插值,
// 前半段(滑块靠左)专门覆盖0.3~5秒左右的精细档位, 后半段覆盖到60秒的粗调档位,
// 跟人手实际想要的"低端精细/高端粗放"直觉一致。另外数字本身可以点击手动输入精确值,
// 兼顾"想要正好5秒"这种滑块很难精准停住的场景。
const SLIDESHOW_MIN = 0.3, SLIDESHOW_MAX = 60;
function _slideshowPosToSec(pos) {
  const p = Math.max(0, Math.min(100, parseFloat(pos) || 0));
  return SLIDESHOW_MIN * Math.pow(SLIDESHOW_MAX / SLIDESHOW_MIN, p / 100);
}
function _slideshowSecToPos(sec) {
  const s = Math.max(SLIDESHOW_MIN, Math.min(SLIDESHOW_MAX, sec));
  return 100 * Math.log(s / SLIDESHOW_MIN) / Math.log(SLIDESHOW_MAX / SLIDESHOW_MIN);
}
function _fmtSlideshowSec(sec) {
  return (sec < 10 ? Math.round(sec * 10) / 10 : Math.round(sec)) + '秒';
}
function _applySlideshowInterval(sec) {
  state.slideshow.interval = Math.round(sec * 1000);
  document.getElementById('slideshow-interval-val').textContent = _fmtSlideshowSec(sec);
  if (state.slideshow.active) {
    clearInterval(state.slideshow.timer);
    state.slideshow.timer = setInterval(() => viewerNext(), state.slideshow.interval);
  }
}
function updateSlideshowInterval(pos) {
  _applySlideshowInterval(_slideshowPosToSec(pos));
}
function editSlideshowInterval() {
  const cur = state.slideshow.interval / 1000;
  const input = prompt('幻灯片切换间隔(0.3~60秒):', String(cur));
  if (input === null) return;
  const sec = parseFloat(input);
  if (!isFinite(sec) || sec <= 0) { if (typeof showToast === 'function') showToast('请输入有效数字', 'error'); return; }
  const clamped = Math.max(SLIDESHOW_MIN, Math.min(SLIDESHOW_MAX, sec));
  const slider = document.getElementById('slideshow-interval');
  if (slider) slider.value = _slideshowSecToPos(clamped);
  _applySlideshowInterval(clamped);
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

// ── 侧边栏折叠/拖拽(桌面) + 抽屉开关(手机) ────────────
(function() {
  let collapsed = false;
  let sidebar, toggle, resizer, backdrop;
  function isMobileViewport() { return window.matchMedia('(max-width:768px)').matches; }

  function applyState() {
    if (!sidebar) return;
    if (isMobileViewport()) {
      // 手机: collapsed=true 表示抽屉收起(默认), false表示展开覆盖在内容上。
      // 折叠箭头(#sidebar-toggle)和拖拽手柄(#sidebar-resizer)手机上都用不到——
      // 注意这两个元素HTML里写了内联style(其中#sidebar-toggle还内联了display:flex),
      // CSS的@media规则改不动内联style, 必须在JS里直接置style.display才能真正隐藏。
      sidebar.classList.remove('collapsed');
      sidebar.style.width = '';
      sidebar.classList.toggle('drawer-open', !collapsed);
      if (backdrop) backdrop.classList.toggle('show', !collapsed);
      if (toggle)  toggle.style.display  = 'none';
      if (resizer) resizer.style.display = 'none';
    } else {
      if (backdrop) backdrop.classList.remove('show');
      sidebar.classList.remove('drawer-open');
      const w = collapsed ? 0 : (parseInt(localStorage.getItem("sidebar-width")) || 260);
      sidebar.classList.toggle('collapsed', collapsed);
      if (toggle) { toggle.style.display = 'flex'; toggle.textContent = collapsed ? '▶' : '◀'; toggle.style.left = (collapsed ? 0 : w) + 'px'; }
      if (resizer) { resizer.style.display = collapsed ? 'none' : ''; resizer.style.left = (collapsed ? 0 : w) + 'px'; }   // 折叠时隐藏拖拽条
    }
    localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
    const _bd = document.getElementById('btn-dirs'); if (_bd) _bd.classList.toggle('active', !collapsed);   // 顶栏"目录"按钮: 目录栏显示时高亮
  }

  window.toggleSidebar = function() {
    collapsed = !collapsed;
    applyState();
  };

  // 手机上选中目录/标签/年份等筛选条件后自动收起抽屉, 不用手动关一次;
  // 桌面端调用这个函数是无害的空操作(isMobileViewport()为false时直接跳过)。
  window.closeSidebarDrawer = function() {
    if (isMobileViewport() && !collapsed) { collapsed = true; applyState(); }
  };

  document.addEventListener('DOMContentLoaded', () => {
    sidebar  = document.getElementById('sidebar');
    toggle   = document.getElementById('sidebar-toggle');
    resizer  = document.getElementById('sidebar-resizer');
    backdrop = document.getElementById('sidebar-backdrop');
    const neverToggled = localStorage.getItem('sidebar-collapsed') === null;
    if (localStorage.getItem('sidebar-collapsed') === '1') {
      collapsed = true;
    } else if (neverToggled && isMobileViewport()) {
      collapsed = true;   // 手机上第一次打开: 默认收起抽屉
    }
    applyState();

    const savedW = localStorage.getItem('sidebar-width');
    if (savedW && sidebar) {
      sidebar.style.width = savedW + 'px';
      if (resizer) resizer.style.left = savedW + 'px';
      if (toggle) toggle.style.left = savedW + 'px';
    }

    // 转屏/改变窗口宽度时重新计算一次抽屉 vs 折叠的呈现方式
    window.addEventListener('resize', () => {
      clearTimeout(window._sbResizeT);
      window._sbResizeT = setTimeout(applyState, 150);
    });

    if (!resizer || !sidebar) return;


    let startX = 0, startW = 0;
    resizer.addEventListener('mousedown', (e) => {
      if (collapsed) return;
      startX = e.clientX;
      startW = sidebar.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      resizer.classList.add('dragging');
      const onMove = (e) => {
        const maxW = Math.max(300, Math.min(800, Math.floor(window.innerWidth * 0.7)));   // 最宽 800px(原来 400), 但不超过窗口的 70%
        const newW = Math.max(160, Math.min(maxW, startW + e.clientX - startX));
        sidebar.style.width = newW + 'px';
        if (resizer) resizer.style.left = newW + 'px';
        if (toggle) toggle.style.left = newW + 'px';
      };
      const onUp = () => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        resizer.classList.remove('dragging');
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

// 2026-09-20加: 当前是否处于"家庭"限制模式——loadSidebar()算出有效角色后设置这个值,
// loadPhotos()读它决定要不要在查询里强制加category=family(修复"选收藏/全部就能看到
// 所有内容"那个bug, 见loadPhotos里的说明)。
let _familyGateActive = false;

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

// 2026-09-20加: 默认家庭身份, 切到"全部"或家庭以外的其他角色要输密码, 密码只在
// 当前浏览器会话(sessionStorage, 关标签页/浏览器失效)内记住, 不写进localStorage长期免密。
const NONFAMILY_PASSWORD = '1';
function isNonFamilyUnlocked() {
  try { return sessionStorage.getItem('viewer_nonfamily_unlocked') === '1'; } catch (e) { return false; }
}
function unlockNonFamily() {
  try { sessionStorage.setItem('viewer_nonfamily_unlocked', '1'); } catch (e) {}
}

// ══ 2026-10-01 筛选面板(🔎 筛选): 大小/分辨率/日期/文件名/文件夹名/方向/格式/相机/定位, 全部走 /api/photo-tags/photos ══
// 条件存在 sessionStorage('viewerAdv'), 刷新页面还在; 用顶部小标签显示当前生效的条件, 可单个取消或一键清除。
const ADV_LABELS = { minSizeMB: '大小≥', maxSizeMB: '大小≤', minWidth: '宽≥', maxWidth: '宽≤', dateFrom: '从', dateTo: '到', fileName: '文件名', folderName: '文件夹', orient: '方向', ext: '格式', camera: '相机', hasGps: '定位' };
const ADV_ORIENT = { landscape: '横图', portrait: '竖图', square: '方图' };
function _advLoad() { try { return JSON.parse(sessionStorage.getItem('viewerAdv') || '{}') || {}; } catch (e) { return {}; } }
function _advSave(a) { try { sessionStorage.setItem('viewerAdv', JSON.stringify(a)); } catch (e) {} }
function _advClean(a) { const o = {}; Object.keys(a || {}).forEach(k => { const v = a[k]; if (v === '' || v == null || (Array.isArray(v) && !v.length)) return; o[k] = v; }); return o; }
function _advActive() { return Object.keys(_advClean(_advLoad())).length > 0; }
function _advParams(skipDate) {
  const a = _advClean(_advLoad()); let u = '';
  if (a.minSizeMB) u += '&minSize=' + Math.round(parseFloat(a.minSizeMB) * 1048576);
  if (a.maxSizeMB) u += '&maxSize=' + Math.round(parseFloat(a.maxSizeMB) * 1048576);
  if (a.minWidth) u += '&minWidth=' + parseInt(a.minWidth, 10);
  if (a.maxWidth) u += '&maxWidth=' + parseInt(a.maxWidth, 10);
  if (!skipDate) {
    if (a.dateFrom) u += '&minDate=' + Math.floor(new Date(a.dateFrom + 'T00:00:00').getTime() / 1000);
    if (a.dateTo) u += '&maxDate=' + Math.floor(new Date(a.dateTo + 'T23:59:59').getTime() / 1000);
  }
  if (a.fileName) u += '&fileName=' + encodeURIComponent(a.fileName);
  if (a.folderName) u += '&folderName=' + encodeURIComponent(a.folderName);
  if (a.orient) u += '&orient=' + a.orient;
  if (a.ext && a.ext.length) u += '&ext=' + a.ext.join(',');
  if (a.camera) u += '&camera=' + encodeURIComponent(a.camera);
  if (a.hasGps) u += '&hasGps=' + a.hasGps;
  return u;
}
// 面板外观(记在浏览器): dock=float(悬浮在页面最上层, 默认, 可拖动)|left(左侧一列)|top(顶部工具栏) 停靠位置; pin=停靠顶部时是否吸附置顶(滚动页面时一直可见); collapsed=折叠(只留标题栏); open=上次是否打开
let _fp = (() => { const d = { dock: 'float', pin: true, collapsed: false, open: false, pos: null }; try { return Object.assign(d, JSON.parse(localStorage.getItem('viewerFilterUi2') || '{}')); } catch (e) { return d; } })();
function _fpSave() { try { localStorage.setItem('viewerFilterUi2', JSON.stringify(_fp)); } catch (e) {} }
let _camLoaded = false;
function _fpEl() { return document.getElementById('adv-panel'); }
function _fpIsOpen() { const p = _fpEl(); return !!p && p.style.display !== 'none'; }
// 按设置把面板放到正确位置: 左侧(侧边栏旁边的一列, 一直吸附) / 顶部吸顶(在滚动不走的工具栏里) / 顶部不吸顶(跟着页面滚走); 窄屏(<900px)不支持左侧, 自动退回顶部
function _fpLayout() {
  const p = _fpEl(); if (!p) return;
  const left = document.getElementById('adv-dock-left');
  const wide = window.innerWidth >= 900;
  const dock = _fp.dock === 'float' ? 'float' : ((_fp.dock === 'left' && wide) ? 'left' : 'top');
  const open = _fpIsOpen();
  p.dataset.dock = dock; p.dataset.pin = _fp.pin ? '1' : '0';
  if (dock === 'float') {
    // 悬浮: 挂到 body 上, position:fixed 盖在页面最上层(样式见 CSS), 记住拖动后的位置
    if (p.parentNode !== document.body) document.body.appendChild(p);
    if (left) left.style.display = 'none';
    if (_fp.pos) { p.style.left = Math.max(0, Math.min(_fp.pos.x, window.innerWidth - 120)) + 'px'; p.style.top = Math.max(0, Math.min(_fp.pos.y, window.innerHeight - 60)) + 'px'; p.style.right = 'auto'; }
    else { p.style.left = ''; p.style.top = ''; p.style.right = ''; }
  } else if (dock === 'left') {
    p.style.left = ''; p.style.top = ''; p.style.right = '';
    if (p.parentNode !== left) left.appendChild(p);
    left.style.display = open ? 'block' : 'none';
  } else {
    p.style.left = ''; p.style.top = ''; p.style.right = '';
    if (left) left.style.display = 'none';
    const anchor = document.getElementById('ai-tag-panel');
    const sticky = document.querySelector('.page-toolbar-sticky');
    if (_fp.pin) { if (anchor && p.nextSibling !== anchor) anchor.parentNode.insertBefore(p, anchor); }
    else if (sticky && sticky.nextSibling !== p) sticky.parentNode.insertBefore(p, sticky.nextSibling);
  }
  const body = document.getElementById('adv-body'); if (body) body.style.display = _fp.collapsed ? 'none' : 'block';
  const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  set('adv-btn-collapse', _fp.collapsed ? '▸ 展开' : '▾ 折叠');
  set('adv-btn-dock', dock === 'float' ? '⬅ 停靠左侧' : (dock === 'left' ? '⬆ 停靠顶部' : '🪟 悬浮'));
  set('adv-btn-pin', _fp.pin ? '📌 已吸顶' : '📍 吸顶');
  const pin = document.getElementById('adv-btn-pin'); if (pin) pin.style.display = dock === 'top' ? '' : 'none';
  const hd = document.getElementById('adv-head'); if (hd) hd.style.cursor = dock === 'float' ? 'move' : '';
  const rs = document.getElementById('adv-btn-reset'); if (rs) rs.style.display = (dock === 'float' && _fp.pos) ? '' : 'none';
}
function _fpRebuildIfOpen() { if (_fpIsOpen()) { _buildFilterPanel(); _fpLayout(); } }
function _buildFilterPanel() {
  const p = _fpEl(); if (!p) return;
  const a = _advLoad();
  const inp = (id, ph, w, v, type) => '<input id="' + id + '" type="' + (type || 'text') + '" placeholder="' + ph + '" value="' + (v == null ? '' : String(v).replace(/"/g, '&quot;')) + '" style="width:' + w + ';background:#0f1620;border:1px solid #263548;border-radius:6px;color:#f0f6ff;padding:5px 8px;font-size:.78rem" onkeydown="if(event.key===\'Enter\')applyFilter()">';
  const lab = (t) => '<span style="font-size:.76rem;color:#8fa8c4;min-width:64px;display:inline-block">' + t + '</span>';
  const row = (inner) => '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:7px">' + inner + '</div>';
  const hb = (id, click, tip) => '<button id="' + id + '" class="nav-btn" onclick="' + click + '" title="' + tip + '" style="padding:2px 9px;font-size:.72rem"></button>';
  const exts = ['jpg', 'png', 'webp', 'gif', 'heic', 'bmp'];
  const radio = (name, val, text, cur) => '<label style="font-size:.78rem;color:#8fa8c4;cursor:pointer"><input type="radio" name="' + name + '" value="' + val + '" ' + ((cur || '') === val ? 'checked' : '') + '> ' + text + '</label>';
  p.innerHTML = '<div id="adv-box" style="background:#101823;border:1px solid #1e2838;border-radius:10px;padding:10px 14px;max-width:760px">'
    + '<div id="adv-head" title="悬浮模式下可以按住这一栏拖动面板" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;user-select:none"><b style="font-size:.84rem;color:#f0f6ff">🔎 筛选</b><span style="flex:1"></span>'
    + hb('adv-btn-reset', 'fpResetPos()', '把面板放回默认位置') + hb('adv-btn-collapse', 'fpToggleCollapse()', '折叠/展开(折叠后只留标题栏)') + hb('adv-btn-dock', 'fpToggleDock()', '把面板停靠到左侧或顶部') + hb('adv-btn-pin', 'fpTogglePin()', '吸附置顶: 滚动页面时一直显示在顶部') + hb('adv-btn-close', 'toggleAdvPanel()', '关闭面板') + '</div>'
    + '<div id="adv-body">'
    + row(lab('文件大小') + inp('adv-minSizeMB', '最小(MB)', '90px', a.minSizeMB, 'number') + '<span style="color:#507090">~</span>' + inp('adv-maxSizeMB', '最大(MB)', '90px', a.maxSizeMB, 'number'))
    + row(lab('宽度(像素)') + inp('adv-minWidth', '最小', '90px', a.minWidth, 'number') + '<span style="color:#507090">~</span>' + inp('adv-maxWidth', '最大', '90px', a.maxWidth, 'number')
          + '<button class="nav-btn" style="padding:2px 8px;font-size:.72rem" onclick="advPreset(1920)">≥1080P</button><button class="nav-btn" style="padding:2px 8px;font-size:.72rem" onclick="advPreset(3840)">≥4K</button>')
    + row(lab('拍摄日期') + inp('adv-dateFrom', '', '140px', a.dateFrom, 'date') + '<span style="color:#507090">~</span>' + inp('adv-dateTo', '', '140px', a.dateTo, 'date'))
    + row(lab('文件名含') + inp('adv-fileName', '关键词(空格分隔多个)', '200px', a.fileName))
    + row(lab('文件夹含') + inp('adv-folderName', '关键词', '200px', a.folderName))
    + row(lab('方向') + radio('adv-orient', '', '不限', a.orient) + radio('adv-orient', 'landscape', '横图', a.orient) + radio('adv-orient', 'portrait', '竖图', a.orient) + radio('adv-orient', 'square', '方图', a.orient))
    + row(lab('格式') + exts.map(e => '<label style="font-size:.78rem;color:#8fa8c4;cursor:pointer"><input type="checkbox" class="adv-ext" value="' + e + '" ' + ((a.ext || []).includes(e) ? 'checked' : '') + '> ' + e + '</label>').join(' '))
    + row(lab('相机') + inp('adv-camera', '型号(可输入或下拉选)', '200px', a.camera) + '<datalist id="adv-cam-list"></datalist>')
    + row(lab('定位') + radio('adv-gps', '', '不限', a.hasGps) + radio('adv-gps', '1', '有', a.hasGps) + radio('adv-gps', '0', '无', a.hasGps))
    + '<div style="display:flex;gap:8px;margin-top:4px"><button class="nav-btn" onclick="applyFilter()" style="padding:5px 18px;font-size:.8rem;background:#40d0ff;color:#000;border:none;font-weight:700">应用筛选</button>'
    + '<button class="nav-btn" onclick="clearFilter()" style="padding:5px 14px;font-size:.8rem">清除全部</button></div></div></div>';
  const cam = document.getElementById('adv-camera'); if (cam) cam.setAttribute('list', 'adv-cam-list');
  if (!_camLoaded) {
    _camLoaded = true;
    fetch('/api/photo-tags/cameras?mediaType=photo').then(r => r.json()).then(list => {
      const dl = document.getElementById('adv-cam-list'); if (!dl || !Array.isArray(list)) return;
      dl.innerHTML = list.map(c => '<option value="' + String(c.name).replace(/"/g, '&quot;') + '">' + c.n + ' 张</option>').join('');
    }).catch(() => { _camLoaded = false; });
  }
}
function toggleAdvPanel() {
  const p = _fpEl(); if (!p) return;
  const show = p.style.display === 'none';
  if (show) _buildFilterPanel();
  p.style.display = show ? 'block' : 'none';
  _fp.open = show; _fpSave();
  _fpLayout();
  const b = document.getElementById('btn-filter'); if (b) b.classList.toggle('active', show);
  const fab = document.getElementById('fp-fab'); if (fab) fab.classList.toggle('on', show);
}
function fpToggleCollapse() { _fp.collapsed = !_fp.collapsed; _fpSave(); _fpLayout(); }
function fpToggleDock() {
  const wide = window.innerWidth >= 900;
  _fp.dock = _fp.dock === 'float' ? (wide ? 'left' : 'top') : (_fp.dock === 'left' ? 'top' : 'float');
  _fpSave(); _fpLayout();
}
function fpResetPos() { _fp.pos = null; _fpSave(); _fpLayout(); }
function fpTogglePin() { _fp.pin = !_fp.pin; _fpSave(); _fpLayout(); }
function advPreset(w) { const el = document.getElementById('adv-minWidth'); if (el) el.value = w; }
function applyFilter() {
  const v = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const rv = (name) => { const el = document.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ''; };
  const a = {
    minSizeMB: v('adv-minSizeMB'), maxSizeMB: v('adv-maxSizeMB'), minWidth: v('adv-minWidth'), maxWidth: v('adv-maxWidth'),
    dateFrom: v('adv-dateFrom'), dateTo: v('adv-dateTo'), fileName: v('adv-fileName'), folderName: v('adv-folderName'),
    orient: rv('adv-orient'), ext: [...document.querySelectorAll('.adv-ext:checked')].map(e => e.value), camera: v('adv-camera'), hasGps: rv('adv-gps'),
  };
  _advSave(_advClean(a)); renderFilterChips(); loadPhotos(true);
}
function clearFilter() { _advSave({}); _fpRebuildIfOpen(); renderFilterChips(); loadPhotos(true); }
function removeAdv(k) { const a = _advLoad(); delete a[k]; _advSave(a); _fpRebuildIfOpen(); renderFilterChips(); loadPhotos(true); }
function renderFilterChips() {
  const el = document.getElementById('filter-chips'); const cnt = document.getElementById('filter-count'); if (!el) return;
  const a = _advClean(_advLoad()); const keys = Object.keys(a);
  if (cnt) cnt.textContent = keys.length ? ' (' + keys.length + ')' : '';
  const fab = document.getElementById('fp-fab'), fc = document.getElementById('fp-fab-count');
  if (fc) { fc.textContent = keys.length ? String(keys.length) : ''; fc.style.display = keys.length ? 'flex' : 'none'; }
  if (fab) fab.classList.toggle('has', keys.length > 0);
  if (!keys.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'block';
  el.innerHTML = '<span style="font-size:.74rem;color:#507090;margin-right:6px">筛选中：</span>' + keys.map(k => {
    let t = a[k]; if (k === 'orient') t = ADV_ORIENT[t] || t; else if (k === 'hasGps') t = t === '1' ? '有' : '无'; else if (k === 'ext') t = t.join('/'); else if (/SizeMB$/.test(k)) t += 'MB';
    return '<span style="display:inline-block;margin:0 6px 4px 0;padding:2px 9px;border:1px solid #40d0ff;border-radius:12px;font-size:.74rem;color:#40d0ff;cursor:pointer" title="点击取消这个条件" onclick="removeAdv(\'' + k + '\')">' + ADV_LABELS[k] + ' ' + String(t).replace(/</g, '&lt;') + ' ✕</span>';
  }).join('') + '<span style="font-size:.74rem;color:#8aa8c8;cursor:pointer;margin-left:4px" onclick="clearFilter()">清除全部</span>';
}
document.addEventListener('DOMContentLoaded', () => { renderFilterChips(); if (_fp.open) toggleAdvPanel(); });
window.addEventListener('resize', () => { if (_fpIsOpen()) _fpLayout(); });
// 悬浮模式: 按住标题栏拖动面板, 位置记住; 按 Esc 关闭面板(大图打开时 Esc 仍是关大图; 在输入框里按 Esc 也不关)
(function () {
  let drag = null;
  document.addEventListener('mousedown', (e) => {
    const hd = e.target.closest && e.target.closest('#adv-head'); const p = _fpEl();
    if (!hd || !p || p.dataset.dock !== 'float' || e.target.closest('button')) return;
    const r = p.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!drag) return; const p = _fpEl(); if (!p) return;
    const x = Math.max(0, Math.min(e.clientX - drag.dx, window.innerWidth - 120)), y = Math.max(0, Math.min(e.clientY - drag.dy, window.innerHeight - 60));
    p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.right = 'auto'; _fp.pos = { x, y };
  });
  document.addEventListener('mouseup', () => { if (drag) { drag = null; _fpSave(); _fpLayout(); } });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !_fpIsOpen()) return;
    const vw = document.getElementById('viewer'); if (vw && vw.classList.contains('show')) return;
    const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) return;
    if (_fpEl().dataset.dock === 'float') toggleAdvPanel();
  });
})();

// 2026-10-01: 浏览顺序可选: folder=文件夹乱序(默认, 目录随机、目录内按原顺序) / random=全部乱序 / desc=时间倒序 / asc=时间正序;
// "换一波"=换一个新的随机种子。选择记在浏览器里(localStorage), 种子只在本次会话(sessionStorage)内保持稳定, 翻页不重不漏。
function _getSortMode() { try { const m = localStorage.getItem('viewerSortMode'); return ['folder', 'random', 'name', 'desc', 'asc', 'res_desc', 'res_asc', 'ratio'].includes(m) ? m : 'folder'; } catch (e) { return 'folder'; } }
function _getSeed() {
  try { let s = sessionStorage.getItem('viewer_seed'); if (!s) { s = String(1 + Math.floor(Math.random() * 999999937)); sessionStorage.setItem('viewer_seed', s); } return s; } catch (e) { return '1'; }
}
function setSortMode(m) {
  try { localStorage.setItem('viewerSortMode', m); } catch (e) {}
  loadPhotos(true);
}
function reshuffle() {
  const ns = String(1 + Math.floor(Math.random() * 999999937));
  try { sessionStorage.setItem('viewer_seed', ns); sessionStorage.setItem('viewer_dir_seed', ns); } catch (e) {}
  const m = _getSortMode();
  if (typeof showToast === 'function') showToast(m === 'folder' || m === 'random' ? '已换一波' : '当前是时间排序，"换一波"只对乱序生效', 'info');
  loadPhotos(true);
}
document.addEventListener('DOMContentLoaded', () => { const el = document.getElementById('sort-mode'); if (el) el.value = _getSortMode(); });

// 2026-09-23加: "全部"默认浏览用的文件夹随机种子, 存sessionStorage——同一次浏览器
// 会话内保持不变(翻页顺序稳定, 不重不漏), 关掉标签页/浏览器再打开才会换一批顺序,
// 不会每次loadPhotos(比如无限滚动加载下一页)都生成新种子导致顺序跳来跳去。
function _getDirSeed() {
  try {
    let s = sessionStorage.getItem('viewer_dir_seed');
    if (!s) { s = String(1 + Math.floor(Math.random() * 999999937)); sessionStorage.setItem('viewer_dir_seed', s); }
    return s;
  } catch (e) { return '1'; }
}
function _isFamilyRole(role) { return !!(role && String(role.name || '').indexOf('家庭') >= 0); }
// 算出"本次实际生效"的角色: 存的是家庭角色就直接用; 不是家庭角色但本次会话已解锁过也直接用;
// 否则(没解锁又不是家庭)一律强制退回家庭角色——哪怕localStorage里存的是上线前选的"全部"。
// familyRole找不到(角色被删了/改了名字)时退回null(全部), 避免功能配置一变就整个用不了。
// 2026-09-23修复真正的根因: localStorage里存的角色(setCurrentRole存的)只有
// {id,name,icon}三个字段, 是角色切换弹窗界面上读的dataset, 没有allowed_roots——
// 之前这里逻辑一旦命中"就用存的那份"分支, 返回的就是这个缺allowed_roots的精简对象,
// 后面_nasViewRoots.fn读.allowed_roots直接是undefined, 目录树一个目录都加载不出来。
// 改成永远拿id去这次新拉取的完整rolesList里查, 只用localStorage记"选的是哪个id"这一件事,
// 绝不直接把存储对象本身当作最终生效角色使用。
function getEffectiveRole(rolesList) {
  const stored = getCurrentRole();
  const familyRole = (rolesList || []).find(_isFamilyRole) || null;
  if (familyRole && stored && stored.id === familyRole.id) return familyRole;
  if (isNonFamilyUnlocked() && stored) {
    const full = (rolesList || []).find(r => r.id === stored.id);
    return full || familyRole;  // 存的角色已经被删了/改了, 退回家庭兜底, 不要整个崩掉
  }
  return familyRole;
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
    const targetRole = id ? { id: id, name: item.dataset.name, icon: item.dataset.icon } : null;
    // 2026-09-20加: 选的不是家庭角色, 本次会话又没解锁过, 弹密码框拦一下
    if (!_isFamilyRole(targetRole) && !isNonFamilyUnlocked()) {
      const pwd = prompt('切换到"' + (targetRole ? targetRole.name : '全部(无限制)') + '"需要输入密码:');
      if (pwd === null) return;   // 取消, 菜单继续开着, 不做任何事
      if (pwd !== NONFAMILY_PASSWORD) { if (typeof showToast === 'function') showToast('密码错误', 'error'); return; }
      unlockNonFamily();
    }
    setCurrentRole(targetRole);
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
// ══ 2026-10-01 大图(灯箱)右键菜单: 对"当前这张"生效, 功能与网格右键菜单一致, 另加几个大图里常用的 ══
function _vwOrigUrl(ph) { return /^[A-Za-z]:/.test(ph.path || '') ? '/api/pc/file/' + encodeURIComponent(ph.path) : '/original' + ph.path; }
function _vwCopy(text) {
  const done = () => showToast('已复制路径');
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, () => _vwCopyFallback(text, done)); }
  else _vwCopyFallback(text, done);
}
function _vwCopyFallback(text, done) {
  const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { showToast('复制失败'); } t.remove();
}
// 大图里"放入待删除"(逻辑删除, 只打标记不动文件; 去"回收站"页面才会真的删): 删完自动显示下一张, 没有了就关掉大图
var _vwDeleting = false;
async function softDeleteCurrentPhoto(noConfirm) {
  if (_vwDeleting) return;
  const idx = state.viewer.index, photo = state.photos[idx]; if (!photo) return;
  // 2026-10-01: 不再弹确认——只是放进回收站(不动文件), 回收站里随时能恢复
  _vwDeleting = true;
  try {
    const r = await fetch('/api/photos/soft-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [photo.id] }) });
    if (!r.ok) throw new Error('请求失败');
    _lastDel = { photo, idx };      // 只记刚删的这一张(Ctrl+Z 用); 翻页/关闭大图/换列表后作废
    state.photos = state.photos.filter(p => p.id !== photo.id);
    state.total = Math.max(0, (state.total || 0) - 1);
    renderGrid(state.photos, true);
    if (typeof updateStats === 'function') updateStats();
    if (!state.photos.length) { closeViewer(); }
    else { state.viewer.index = Math.min(idx, state.photos.length - 1); resetViewerTransform(); showViewerPhoto(); }
    showToast('已放入回收站（Ctrl+Z 撤销）');
  } catch (e) { showToast('操作失败'); }
  finally { _vwDeleting = false; }
}
function openViewerMenu(e) {
  const idx = state.viewer.index, photo = state.photos[idx];
  if (!photo) return;
  const url = _vwOrigUrl(photo);
  ctxMenu.show(e.clientX, e.clientY, [
    { icon: photo.favorite ? '💔' : '❤️', text: photo.favorite ? '取消收藏' : '收藏', action: () => toggleFav({ stopPropagation: () => {} }, photo.id) },
    { icon: '🏷', text: '编辑标签', action: () => addTagModal(photo.md5) },
    { sep: true },
    { icon: '📋', text: '复制路径', action: () => _vwCopy(photo.path) },
    { icon: '🔗', text: '在新标签页打开原图', action: () => window.open(url, '_blank') },
    { icon: '⬇', text: '下载原图', action: () => { const a = document.createElement('a'); a.href = url; a.download = String(photo.path).split('/').pop(); document.body.appendChild(a); a.click(); a.remove(); } },
    { icon: '📁', text: '定位到所在目录', action: () => { const d = _dirFull(photo); closeViewer(); jumpToDir({ stopPropagation: () => {} }, d); } },
    { sep: true },
    { icon: '▶', text: '重新处理', action: () => reprocessPhoto(photo.id) },
    { icon: '🗑', text: '放入回收站', action: () => softDeleteCurrentPhoto() },
  ]);
}
(function () {
  const bind = () => {
    const vw = document.getElementById('viewer'); if (!vw || vw._ctxBound) return; vw._ctxBound = true;
    vw.addEventListener('contextmenu', (e) => {
      // 只在大图区域(图片/空白处)弹出; 顶部工具栏、音乐栏、输入框里保持浏览器默认右键(复制粘贴等)
      if (e.target.closest('.viewer-header, .viewer-footer, .viewer-prev, .viewer-next, input, textarea, select, button')) return;
      e.preventDefault(); e.stopPropagation();
      openViewerMenu(e);
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();

// 2026-10-01: 网格右键"放入回收站"(逻辑删除, 只打标记不动文件; 统一回收站里恢复或彻底删除)
async function softDeleteGridPhoto(photo) {
  if (!photo) return;
  try {
    const r = await fetch('/api/photos/soft-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [photo.id] }) });
    if (!r.ok) throw new Error('请求失败');
    state.photos = state.photos.filter(p => p.id !== photo.id);
    state.total = Math.max(0, (state.total || 0) - 1);
    renderGrid(state.photos, true);
    if (typeof updateStats === 'function') updateStats();
    showToast('已放入回收站（右上角"🗑 回收站"可恢复）');
  } catch (e) { showToast('操作失败'); }
}

// ══ 2026-10-01 撤销删除(Ctrl+Z / Cmd+Z): 只针对"大图里刚删除的这一张"——删完立刻按 Ctrl+Z 就直接恢复(只是清掉回收站标记, 文件本来就没动)。
// 一旦切换(翻到别的图 / 关闭大图 / 换了列表)就不能再恢复了(想找回去回收站里恢复)。
var _lastDel = null;
var _undoBusy = false;
function _undoClear() { _lastDel = null; }
async function undoDelete() {
  if (_vwDeleting || _undoBusy || !_lastDel) return;
  if (!document.getElementById('viewer').classList.contains('show')) { _lastDel = null; return; }
  const ent = _lastDel; _lastDel = null; _undoBusy = true;
  try {
    const r = await fetch('/api/photos/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [ent.photo.id] }) });
    if (!r.ok) throw new Error('请求失败');
    if (!state.photos.some(p => p.id === ent.photo.id)) state.photos.splice(Math.min(ent.idx, state.photos.length), 0, ent.photo);
    state.total = (state.total || 0) + 1;
    renderGrid(state.photos, true);
    if (typeof updateStats === 'function') updateStats();
    state.viewer.index = state.photos.findIndex(p => p.id === ent.photo.id);
    resetViewerTransform(); showViewerPhoto();
    showToast('已恢复');
  } catch (e) { _lastDel = ent; showToast('恢复失败'); }
  finally { _undoBusy = false; }
}
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || String(e.key).toLowerCase() !== 'z') return;
  const t = e.target; if ((t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) || (t && t.isContentEditable)) return;   // 输入框里的 Ctrl+Z 留给输入框自己撤销文字
  e.preventDefault(); undoDelete();
});

// ══ 2026-10-01 排布模式: 等高行(justified, 默认) / 瀑布(masonry, 不对齐) / 网格(grid, 原样) ══
// 等高行: 一行里每张图的宽度按各自宽高比分配 → 同一行高度完全相同、铺满整行; 不改变图片先后顺序。目标行高 = 每列宽度 ÷ 平均宽高比, 所以"列数"仍然有意义(1~10)。
function _ratioOf(p) { return (p && p.width > 0 && p.height > 0) ? Math.max(0.35, Math.min(3, p.width / p.height)) : 1.33; }
function _getLayout() { try { const m = localStorage.getItem('viewerLayout'); return ['justified', 'masonry', 'grid'].includes(m) ? m : 'justified'; } catch (e) { return 'justified'; } }
function setLayout(m) { try { localStorage.setItem('viewerLayout', m); } catch (e) {} _applyLayout(true); }
// 等高行算法(类似 Flickr/Google 相册): 从头往后一张张放进当前行, 当行高降到目标行高以下时, 比较"带上这张"和"不带这张"哪个更接近目标行高, 在那里换行;
// 每一行里每张图的宽度 = 宽高比 × 该行行高, 行宽刚好铺满 → 一行内高度完全相同。最后一行不拉伸(行高不超过目标的 1.3 倍)。
let _lastLayoutSig = '';
function _justify(grid, force) {
  const items = [...grid.children].filter(el => el.classList && el.classList.contains('photo-item'));
  const W = grid.clientWidth, target = parseFloat(getComputedStyle(grid).getPropertyValue('--row-h')) || 180, gap = 6;
  const sig = W + '|' + items.length + '|' + Math.round(target);
  if (!force && sig === _lastLayoutSig) return;
  _lastLayoutSig = sig;
  if (!W) return;
  let row = [], sum = 0;
  const flush = (last) => {
    if (!row.length) return;
    let h = (W - gap * (row.length - 1)) / sum;
    if (last) h = Math.min(h, target * 1.3);
    row.forEach(it => { it.el.style.flex = 'none'; it.el.style.width = Math.floor(it.r * h) + 'px'; });
    row = []; sum = 0;
  };
  for (const el of items) {
    const r = parseFloat(el.style.getPropertyValue('--r')) || 1.33;
    row.push({ el, r }); sum += r;
    let h = (W - gap * (row.length - 1)) / sum;
    if (h < target) {                                           // 这一行已经"满"了
      if (row.length > 1) {
        const hWithout = (W - gap * (row.length - 2)) / (sum - r);
        if (Math.abs(hWithout - target) < Math.abs(h - target)) {   // 不带最后这张更接近目标 → 在它前面换行, 它另起一行
          const last = row.pop(); sum -= last.r; flush(false); row = [last]; sum = last.r;
          if ((W - gap * (row.length - 1)) / sum >= target) continue;
        }
      }
      flush(false);
    }
  }
  flush(true);
}
function _clearJustify(grid) { [...grid.children].forEach(el => { if (el.style) { el.style.width = ''; el.style.flex = ''; } }); _lastLayoutSig = ''; }
function _applyLayout(force) {
  const grid = document.getElementById('photo-grid'); if (!grid) return;
  const mode = _getLayout();
  if (grid.dataset.layout !== mode) { grid.dataset.layout = mode; if (mode !== 'justified') _clearJustify(grid); force = true; }
  const n = _loadColCount();
  const w = grid.clientWidth || (grid.parentElement && grid.parentElement.clientWidth) || 1000;
  const rs = (state.photos || []).slice(-200).map(_ratioOf);
  const avg = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 1.4;
  grid.style.setProperty('--row-h', Math.round(Math.max(28, (w / n) / Math.max(0.6, Math.min(1.8, avg)))) + 'px');
  if (mode === 'justified') _justify(grid, force);
  const sel = document.getElementById('layout-mode'); if (sel && sel.value !== mode) sel.value = mode;
}
document.addEventListener('DOMContentLoaded', () => {
  _applyLayout();
  const grid = document.getElementById('photo-grid');
  if (grid && window.ResizeObserver) new ResizeObserver(() => _applyLayout()).observe(grid);   // 窗口/侧边栏/左侧筛选栏宽度变化时重算行高
});

// 列数滑块: 拖动直接设置(1~COL_MAX 步长 1)
function setColCount(v) { const n = Math.max(COL_MIN, Math.min(COL_MAX, parseInt(v, 10) || COL_DEFAULT)); _applyColCount(n); }

// ── 目录栏: 双击拖拽条恢复默认宽度; 按 [ 键折叠/展开 ──
document.addEventListener('DOMContentLoaded', () => {
  const r = document.getElementById('sidebar-resizer'), sb = document.getElementById('sidebar'), tg = document.getElementById('sidebar-toggle');
  if (r && sb) r.addEventListener('dblclick', () => { sb.style.width = '260px'; r.style.left = '260px'; if (tg) tg.style.left = '260px'; try { localStorage.setItem('sidebar-width', 260); } catch (e) {} });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable)) return;
  const vw = document.getElementById('viewer'); if (vw && vw.classList.contains('show')) return;
  if (typeof toggleSidebar === 'function') toggleSidebar();
});
