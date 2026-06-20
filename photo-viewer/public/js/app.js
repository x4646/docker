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
  viewer:    { index:-1, zoom:1, panX:0, panY:0, dragging:false, lastX:0, lastY:0 },
  slideshow: { active:false, timer:null, interval:4000 },
  music:     { audio:null, playlist:[], index:0, playing:false, mode:'shuffle', volume:0.6 },
  playlists: [],
  tags:      [],
};

const dirFilecountCache = new Map(); // 缺失的全局声明

async function init() {
  await Promise.all([loadSidebar(), loadTags(), loadPlaylists(), loadMusicSettings()]);
  loadPhotos(true);
  setupIntersectionObserver();
  setupKeyboard();
  setupViewer();
}

// ── 侧边栏 ────────────────────────────────────────────
// ── PC目录树 ─────────────────────────────────────────
function renderPcDirNode(node, container, depth) {
  const indent = depth * 12;
  const icon   = depth === 0 ? '💻' : '📂';
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'sidebar-item dir-node';
  row.dataset.path = node.path;
  row.style.cssText = `padding-left:${14+indent}px;font-size:${depth===0?'.83':'.78'}rem;display:flex;align-items:center;gap:4px;flex-wrap:nowrap;overflow:hidden`;
  const toggleIcon = document.createElement('span');
  toggleIcon.className   = 'dir-toggle-icon';
  toggleIcon.textContent = '▶';
  toggleIcon.style.flexShrink = '0';
  const nameSpan = document.createElement('span');
  nameSpan.textContent = icon + ' ' + (node.name || node.path.split('\\').pop().split('/').pop());
  nameSpan.style.flex = '1';
  nameSpan.style.overflow = 'hidden';
  nameSpan.style.textOverflow = 'ellipsis';
  nameSpan.style.whiteSpace = 'nowrap';
  const statsSpan = document.createElement('span');
  statsSpan.style.cssText = 'font-size:.65rem;flex-shrink:0;margin-left:4px';
  row.appendChild(toggleIcon);
  row.appendChild(nameSpan);
  row.appendChild(statsSpan);
  const childContainer = document.createElement('div');
  childContainer.style.display = 'none';
  let loaded = false;
  const toggle = () => {
    const isOpen = childContainer.style.display !== 'none';
    if (!isOpen && !loaded) {
      loaded = true;
      toggleIcon.textContent = '⟳';
      fetch(`/api/pc/browse?path=${encodeURIComponent(node.path || node)}`)
        .then(r => r.json())
        .then(items => {
          if (items.error) { toggleIcon.textContent = '✕'; return; }
          items.forEach(item => {
            if (item.type === 'dir') renderPcDirNode(item, childContainer, depth + 1);
          });
          childContainer.style.display = 'block';
          toggleIcon.textContent = '▼';
        })
        .catch(() => { toggleIcon.textContent = '▶'; });
    } else {
      childContainer.style.display = isOpen ? 'none' : 'block';
      toggleIcon.textContent        = isOpen ? '▶' : '▼';
    }
  };
  row.addEventListener('click', () => {
    toggle();
    document.querySelectorAll('.sidebar-item.dir-node').forEach(el => el.classList.remove('active'));
    row.classList.add('active');
    state.filter.dirPath  = '';
    state.filter.pcPath   = node.path || node;
    state.filter.year     = 0;
    state.filter.month    = 0;
    state.filter.favorite = false;
    loadPcPhotos(node.path || node);
    loadDirStatsLazy(node.path || node, statsSpan);
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    ctxMenu.show(e.clientX, e.clientY, [
      { label: node.name || node.path },
      { sep: true },
      { icon: '🔍', text: '查看此目录图片', action: () => row.click() },
      { icon: '▶',  text: '派发处理',       action: () => dispatchDir(node.path || node, false) },
      { icon: '🔄', text: '重新处理全部',   action: () => dispatchDir(node.path || node, true) },
      { sep: true },
      { icon: '🔁', text: '重新扫描目录',   action: () => scanDir(node.path || node) },
      { sep: true },
      { icon: '🗑', text: '删除整个目录',   action: () => deleteDir(node.path || node), danger: true },
    ]);
  });
  wrap.appendChild(row);
  wrap.appendChild(childContainer);
  container.appendChild(wrap);
}

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
      + `📂 此目录暂无已处理图片<br><small>右键目录→「派发给PC处理」生成缩略图</small></div>`;
  }
}

async function dispatchPcDir(pcPath) {
  showToast("派发中...");
  const r = await fetch("/api/pc/dispatch", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pcPath }),
  });
  const d = await r.json();
  if (d.ok) {
    showToast("已派发，等待PC处理...");
  } else {
    showToast("派发失败: " + (d.error || "未知错误"), "error");
  }
}

// ── 目录树懒加载 ──────────────────────────────────────
function renderDirTree(items, container) {
  items.forEach(node => renderDirNode(node, container, 0));
}

function renderDirNode(node, container, depth) {
  const indent = depth * 12;
  const icon   = depth === 0 ? '📁' : '📂';

  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'sidebar-item dir-node';
  row.style.cssText = `padding-left:${14+indent}px;font-size:${depth===0?'.83':'.78'}rem;display:flex;align-items:center;gap:4px;flex-wrap:nowrap;overflow:hidden`;
  row.dataset.path = node.path;

  const toggleIcon = document.createElement('span');
  toggleIcon.className   = 'dir-toggle-icon';
  toggleIcon.textContent = node.hasChildren ? '▶' : '　';
  toggleIcon.style.flexShrink = '0';

  const nameSpan = document.createElement('span');
  nameSpan.textContent = icon + ' ' + node.name;
  nameSpan.style.flex  = '1';
  nameSpan.style.overflow = 'hidden';
  nameSpan.style.textOverflow = 'ellipsis';
  nameSpan.style.whiteSpace = 'nowrap';

  const statsSpan = document.createElement('span');
  statsSpan.style.cssText = 'font-size:.65rem;flex-shrink:0;margin-left:4px';
  if (node.done !== undefined) {
    renderDirStatsInline(statsSpan, node);
  } else {
    statsSpan.style.color = '#507090';
    statsSpan.textContent = node.count || '';
  }

  row.appendChild(toggleIcon);
  row.appendChild(nameSpan);
  row.appendChild(statsSpan);

  const childContainer = document.createElement('div');
  childContainer.style.display = 'none';
  let loaded = false;

  const toggle = () => {
    if (!node.hasChildren) return;
    const isOpen = childContainer.style.display !== 'none';
    if (!isOpen && !loaded) {
      loaded = true;
      toggleIcon.textContent = '⟳';
      fetch(`/api/dir-tree?source=nas&path=${encodeURIComponent(node.path)}`)
        .then(r => r.json())
        .then(children => {
          children.forEach(c => renderDirNode(c, childContainer, depth + 1));
          childContainer.style.display = 'block';
          toggleIcon.textContent = '▼';
          setTimeout(() => loadDirStatsLazy(node.path, statsSpan), 0);
        })
        .catch(() => { toggleIcon.textContent = '▶'; });
    } else {
      childContainer.style.display = isOpen ? 'none' : 'block';
      toggleIcon.textContent        = isOpen ? '▶' : '▼';
    }
  };

  row.addEventListener('click', () => {
    toggle();
    document.querySelectorAll('.sidebar-item.dir-node').forEach(el => el.classList.remove('active'));
    row.classList.add('active');
    state.filter.dirPath  = node.path;
    state.filter.year     = 0;
    state.filter.month    = 0;
    state.filter.favorite = false;
    loadPhotos(true);
    if (node.done === undefined) loadDirStatsLazy(node.path, statsSpan);
  });

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    ctxMenu.show(e.clientX, e.clientY, [
      { label: node.name },
      { sep: true },
      { icon: '🔍', text: '查看此目录图片',   action: () => row.click() },
      { icon: '▶',  text: '派发给PC处理',     action: () => dispatchDir(node.path, false) },
      { icon: '🔄', text: '重新处理全部图片', action: () => dispatchDir(node.path, true) },
      { sep: true },
      { icon: '🔁', text: '重新扫描目录',     action: () => scanDir(node.path) },
      { sep: true },
      { icon: '🗑', text: '删除整个目录', action: () => deleteDir(node.path), danger: true },
    ]);
  });

  wrap.appendChild(row);
  wrap.appendChild(childContainer);
  container.appendChild(wrap);
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
  const dirContainer = document.createElement('div');
  sidebar.appendChild(dirContainer);

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

  // 异步加载目录树
  window.dirTree = new DirTreeWidget({
    container: dirContainer,
    source: 'nas',
    instanceId: 'viewer_nas',
    mode: 'single',
    showRefresh: true,
    rootsFn: async () => {
      const roots = await fetch('/api/browser/roots?source=nas').then(r => r.json());
      return roots.map(r => ({ name: r.name, path: r.path }));
    },
    childrenFn: async (path) => {
      return await fetch('/api/dir-tree?source=nas&hasPhotos=1&path=' + encodeURIComponent(path)).then(r => r.json());
    },
    onSelect: (path) => {
      state.filter.dirPath  = path;
      state.filter.year     = 0;
      state.filter.month    = 0;
      state.filter.favorite = false;
      loadPhotos(true);
    },
    contextMenu: (path) => [
      { icon: '🔍', label: '查看此目录图片', action: () => { state.filter.dirPath=path; state.filter.year=0; state.filter.month=0; state.filter.favorite=false; loadPhotos(true); } },
      { sep: true },
      { icon: '🔑', label: '打MD5',    action: () => dtwWriteMd5(path) },
      { icon: '🧹', label: '清理孤立', action: () => dtwCleanOrphan(path) },
      { icon: '⚙',  label: '处理',     action: () => dtwProcess(path) },
      { sep: true },
      { icon: '🔁', label: '重新扫描目录', action: () => scanDir(path) },
      { sep: true },
      { icon: '🗑', label: '删除整个目录', color: '#ff5567', action: () => deleteDir(path) },
    ],
  });
  window.dirTree.bind();
  window.dirTree.init();

  // 异步加载时间轴
  fetch('/api/photos/groups/time')
    .then(r => r.json())
    .then(times => {
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
            state.filter.dirPath  = '';
            state.filter.year     = parseInt(year);
            state.filter.month    = 0;
            state.filter.favorite = false;
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
            document.querySelectorAll('.sidebar-item').forEach(e => e.classList.remove('active'));
            mRow.classList.add('active');
            state.filter.dirPath  = '';
            state.filter.year     = parseInt(year);
            state.filter.month    = m.month;
            state.filter.favorite = false;
            loadPhotos(true);
          });
          monthContainer.appendChild(mRow);
        });

        timeContainer.appendChild(yearRow);
        timeContainer.appendChild(monthContainer);
      });
    })
    .catch(() => {});

  // 异步加载PC目录
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
      window.pcTree = new DirTreeWidget({
        container: pcContainer,
        source: 'pc',
        instanceId: 'viewer_pc',
        mode: 'single',
        showRefresh: true,
        icons: { root: '💻', child: '📁' },
        rootsFn: async () => {
          const roots = await fetch('/api/pc-roots').then(r => r.json());
          return roots.map(r => ({ name: r.name || r.path.split('/').pop(), path: r.path.replace(/\\/g,'/') }));
        },
        childrenFn: async (path) => {
          return await fetch('/api/dir-tree?source=pc&hasPhotos=1&path=' + encodeURIComponent(path)).then(r => r.json());
        },
        onSelect: (path) => {
          state.filter.dirPath  = '';
          state.filter.pcPath   = path;
          state.filter.year     = 0;
          state.filter.month    = 0;
          state.filter.favorite = false;
          loadPcPhotos(path);
        },
        contextMenu: (path) => [
          { icon: '🔍', label: '查看此目录图片', action: () => loadPcPhotos(path) },
          { sep: true },
          { icon: '🔑', label: '打MD5',    action: () => dtwWriteMd5(path) },
          { icon: '🧹', label: '清理孤立',  action: () => dtwCleanOrphan(path) },
          { icon: '⚙',  label: '处理',     action: () => dtwProcess(path) },
          { sep: true },
          { icon: '🔁', label: '重新扫描目录', action: () => scanDir(path) },
          { sep: true },
          { icon: '🗑', label: '删除整个目录', color: '#ff5567', action: () => deleteDir(path) },
        ],
      });
      window.pcTree.bind();
      window.pcTree.init();
    });

  loadTags();
}

function setFavFilter(el) {
  document.querySelectorAll('.sidebar-item').forEach(e => e.classList.remove('active'));
  if (el) el.classList.add('active');
  state.filter.favorite = true;
  state.filter.dirPath  = '';
  state.filter.year     = 0;
  state.filter.month    = 0;
  loadPhotos(true);
}

// ── 图片加载 ──────────────────────────────────────────
async function loadPhotos(reset = false) {
  if (!state.pcMode) state.filter.dirPath = state.filter.dirPath;
  if (state.loading || (!reset && !state.hasMore)) return;
  if (reset) { state.page = 1; state.photos = []; state.hasMore = true; }

  state.loading = true;
  showSpinner(true);

  const { q, tags, favorite, dirPath, year, month } = state.filter;
  let url = `/api/photos?page=${state.page}&limit=50`;
  if (!state.filter.dirPath) url += `&status=done`;
  if (q)        url += `&q=${encodeURIComponent(q)}`;
  if (tags.length) url += `&tags=${tags.join(',')}`;
  if (favorite) url += `&favorite=true`;
  if (dirPath)  url += `&dirPath=${encodeURIComponent(dirPath)}`;
  if (year)     url += `&year=${year}`;
  if (month)    url += `&month=${month}`;

  try {
    const r = await fetch(url);
    const { photos, total } = await r.json();
    state.total   = total;
    state.hasMore = state.photos.length + photos.length < total;
    state.page++;
    if (reset) { state.photos = photos; renderGrid(photos, true); }
    else        { state.photos.push(...photos); renderGrid(photos, false); }
    updateStats();
  } catch(e) { console.error('加载失败', e); }
  finally    { state.loading = false; showSpinner(false); }
}

function renderGrid(photos, clear) {
  const grid = document.getElementById('photo-grid');
  if (clear) grid.innerHTML = '';

  photos.forEach((p, i) => {
    const idx      = clear ? i : state.photos.length - photos.length + i;
    const item     = document.createElement('div');
    item.className = 'photo-item';
    item.dataset.idx = idx;
    const tags     = [...(p.user_tags||[]), ...(p.ai_tags||[])].slice(0,3);
    const favClass = p.favorite ? 'active' : '';

    item.innerHTML = `
      <img src="/thumbs/${p.thumb_path?.split('/').pop()}"
          class="loading" alt=""
          onload="this.classList.remove('loading');this.classList.add('loaded')"
          onerror="this.src=''">
      <div class="photo-overlay">
        <div class="photo-info">${formatDate(p.exif_time || p.mtime)}</div>
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
        { icon: "🏷",  text: "编辑标签",      action: () => addTagPrompt(photo.id) },
        { icon: "❤️", text: photo.favorite ? "取消收藏" : "收藏", action: () => toggleFav(e, photo.id) },
        { sep: true },
        { icon: "🗑",  text: "彻底删除（含原文件）",    action: () => deletePhoto(photo.id), danger: true },
      ]);
    });
    grid.appendChild(item);
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
  document.getElementById('viewer').classList.remove('show');
  document.body.style.overflow = '';
  stopSlideshow();
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
}

function showViewerPhoto() {
  const photo = state.photos[state.viewer.index];
  if (!photo) return;

  const img = document.getElementById('viewer-img');
  img.dataset.mode = 'preview';
  img.src = photo.preview_path ? `/preview/${photo.preview_path.split('/').pop()}` : `/original${photo.path}`;

  document.getElementById('viewer-filename').textContent = photo.path.split('/').pop();
  document.getElementById('viewer-dims').textContent     = photo.width && photo.height ? `${photo.width}×${photo.height}` : '-';
  document.getElementById('viewer-size').textContent     = formatSize(photo.size);
  document.getElementById('viewer-camera').textContent   = photo.exif_camera || '-';
  document.getElementById('viewer-date').textContent     = photo.exif_time ? formatDate(photo.exif_time) : '-';
  document.getElementById('viewer-ai').textContent       = photo.ai_desc || '暂无AI描述';
  const gpsEl = document.getElementById('viewer-gps');
  if (gpsEl) gpsEl.textContent = photo.exif_gps ? photo.exif_gps : '-';
  const pathEl = document.getElementById('viewer-path');
  if (pathEl) pathEl.textContent = photo.path;

  renderViewerTags(photo);
  updateViewerNav();
}

function renderViewerTags(photo) {
  const container = document.getElementById('viewer-tags');
  const allTags   = [...(photo.user_tags||[]), ...(photo.ai_tags||[])];
  container.innerHTML = allTags.map(t =>
    `<span class="viewer-tag" onclick="filterByTag('${escJs(t)}')">${escHtml(t)}</span>`
  ).join('') + `<span class="viewer-tag add-tag" onclick="addTagPrompt(${photo.id})">＋ 标签</span>`;
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
    state.viewer.zoom = Math.max(0.5, Math.min(10, state.viewer.zoom * delta));
    applyTransform();
    showZoomIndicator();
  }, { passive: false });

  wrap.addEventListener('dblclick', (e) => {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } else {
      const el = document.getElementById('viewer');
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
  });

  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
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

  let lastDist = 0;
  wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
  }, { passive: true });

  wrap.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      state.viewer.zoom = Math.max(0.5, Math.min(10, state.viewer.zoom * (dist / lastDist)));
      lastDist = dist;
      applyTransform(); showZoomIndicator();
    }
  }, { passive: false });
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
    if (photo) img.src = photo.preview_path ? `/preview/${photo.preview_path.split('/').pop()}` : getOrigSrc(photo);
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
function toggleSlideshow() {
  state.slideshow.active ? stopSlideshow() : startSlideshow();
}

function startSlideshow() {
  state.slideshow.active = true;
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
  e.stopPropagation();
  const r    = await fetch(`/api/photos/${id}/favorite`, { method:'POST' });
  const data = await r.json();
  const photo = state.photos.find(p => p.id === id);
  if (photo) photo.favorite = data.favorite;

  const idx = state.photos.findIndex(p => p.id === id);
  const btn = document.querySelector(`.photo-item[data-idx="${idx}"] .fav-btn`);
  if (btn) { btn.textContent = data.favorite ? '❤️' : '🤍'; btn.classList.toggle('active', data.favorite); }
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
  const r    = await fetch('/api/photos/tags/all');
  state.tags = await r.json();
  const cloud = document.getElementById('tag-cloud');
  if (!cloud) return;
  cloud.innerHTML = state.tags.slice(0,30).map(t =>
    `<span class="tag-chip" onclick="filterByTag('${escJs(t.name)}')">${escHtml(t.name)}<small style="color:#507090;margin-left:3px">${t.count}</small></span>`
  ).join('');
}

// ── 音乐 ──────────────────────────────────────────────
async function loadPlaylists() {
  const r        = await fetch('/api/playlists');
  state.playlists = await r.json();
}

async function loadMusicSettings() {
  const r   = await fetch('/api/music-settings');
  const cfg = await r.json();
  if (!cfg) return;
  state.music.mode   = cfg.mode   || 'shuffle';
  state.music.volume = cfg.volume || 0.6;
  if (cfg.playlist_id) {
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
  state.music.audio.play();
  state.music.playing = true;
  document.getElementById('music-name').textContent = song.name || song.path.split('/').pop();
  document.getElementById('btn-play').textContent = '⏸';
  const mainPlay = document.getElementById('main-btn-play');
  if (mainPlay) mainPlay.textContent = '⏸';
}

function togglePlay() {
  if (!state.music.audio) { playMusic(); return; }
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
  state.music.index = (state.music.index + 1) % state.music.playlist.length;
  playMusic();
}

function prevSong() {
  state.music.index = (state.music.index - 1 + state.music.playlist.length) % state.music.playlist.length;
  playMusic();
}

function updateProgress() {
  const audio = state.music.audio;
  if (!audio || !audio.duration) return;
  const pct = (audio.currentTime / audio.duration * 100) + '%';
  document.getElementById('music-progress-fill').style.width = pct;
  const mainFill = document.getElementById('main-music-progress-fill');
  if (mainFill) mainFill.style.width = pct;
}

function seekMusic(e) {
  const audio = state.music.audio;
  if (!audio || !audio.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
}

function setVolume(val) {
  state.music.volume = parseFloat(val);
  if (state.music.audio) state.music.audio.volume = state.music.volume;
}

function togglePlaylistPanel() {
  document.getElementById('playlist-panel').classList.toggle('show');
  if (document.getElementById('playlist-panel').classList.contains('show')) renderPlaylistPanel();
}

function renderPlaylistPanel() {
  const body = document.getElementById('playlist-body');
  if (!state.playlists.length) { body.innerHTML = '<div style="padding:16px;color:#507090">暂无播放列表</div>'; return; }
  body.innerHTML = state.playlists.map(pl => `
    <div class="playlist-item ${state.music.currentPl === pl.id ? 'playing':''}" onclick="selectPlaylist(${pl.id})">
      <div class="playlist-item-name">🎵 ${escHtml(pl.name)}</div>
      <div class="playlist-item-dur">${(pl.songs||[]).length}首</div>
    </div>`).join('');
}

function selectPlaylist(id) {
  const pl = state.playlists.find(p => p.id === id);
  if (pl) { setPlaylist(pl); state.music.currentPl = id; playMusic(); togglePlaylistPanel(); }
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
// dirFilecountCache 已在顶部声明

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

// ── 目录右键菜单 ──────────────────────────────────────
function showDirMenu(e, path) {
  e.stopPropagation();
  ctxMenu.show(e.clientX, e.clientY, [
    { label: path.split('/').pop() },
    { sep: true },
    { icon: '🔍', text: '查看此目录图片',   action: () => setDirFilter(path, 0, 0, null) },
    { icon: '▶',  text: '派发给PC处理',     action: () => dispatchDir(path, false) },
    { icon: '🔄', text: '重新处理全部图片', action: () => dispatchDir(path, true) },
    { sep: true },
    { icon: '🔁', text: '重新扫描目录',     action: () => scanDir(path) },
    { icon: '🗑', text: '删除整个目录', action: () => deleteDir(path), danger: true },
  ]);
}

async function dispatchDir(path, reprocess) {
  if (/^[A-Za-z]:/.test(path)) {
    try {
      const pcPathFwd = path.split('\\').join('/');
      const r = await fetch('/api/photos/boost-priority', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({dirPath: pcPathFwd})
      }).then(r=>r.json());
      showToast(`已提升优先级 ${r.boosted||0} 张`);
    } catch(e) { showToast('派发失败:' + e.message, 'error'); }
    return;
  }
  const mask = document.createElement("div");
  mask.id = "dispatch-mask";
  mask.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-size:1rem;gap:12px";
  mask.innerHTML = `<div style="font-size:2rem">📤</div><div>${reprocess?"重新派发":"派发"}中...</div><div style="font-size:.8rem;color:#909090">${path}</div><div id="dispatch-progress" style="margin-top:8px;color:#40d0ff">初始化...</div>`;
  document.body.appendChild(mask);
  try {
    const d = await fetch("/api/photos/dispatch/dir2", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dirPath: path, reprocess }),
    }).then(r => r.json());

    let result = {};
    await new Promise(resolve => {
      const poll = setInterval(async () => {
        try {
          const p = await fetch(`/api/photos/scan2/progress/${d.taskId}`).then(r => r.json());
          const el = document.getElementById("dispatch-progress");
          if (el) el.textContent = `扫描 ${p.scanned} 张，加入队列 ${p.added}，跳过 ${p.skipped}`;
          if (p.done) { result = p; clearInterval(poll); resolve(); }
        } catch(e) { clearInterval(poll); resolve(); }
      }, 500);
    });

    mask.innerHTML = `
      <div style="background:#1e2838;border:1px solid #2a3d55;border-radius:12px;padding:24px 32px;min-width:280px;text-align:center">
        <div style="font-size:1.1rem;font-weight:bold;margin-bottom:16px">✅ 派发完成</div>
        <div style="margin-bottom:16px;color:#c8dff5;line-height:1.8">
          扫描文件：<span style="color:#40d0ff">${result.scanned||0}</span> 张<br>
          加入队列：<span style="color:#3ddc84">${result.added||0}</span> 张<br>
          已完成跳过：<span style="color:#ffa500">${result.skipped||0}</span> 张
        </div>
        <button onclick="document.getElementById('dispatch-mask').remove()" style="padding:8px 24px;border-radius:6px;background:#40d0ff;color:#000;border:none;cursor:pointer">确定</button>
      </div>`;

    await fetch("/api/dir-stats/recalc", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const stats = await fetch(`/api/dir-stats?path=${encodeURIComponent(path)}`).then(r => r.json());
    for (const s of stats) {
      if (window.dirTree && window.dirTree.has(s.path)) {
        window.dirTree.updateStats(s.path, s.done_files, s.total_files, s.pending_files);
      }
    }
  } catch(e) {
    if (document.body.contains(mask)) document.body.removeChild(mask);
    showToast("派发失败: " + e.message, "error");
  }
}

async function scanDir(dirPath) {
  if (dirPath.includes(':\\') || dirPath.includes(':/') || /^[A-Za-z]:/.test(dirPath)) {
    const pcMask = document.createElement('div');
    pcMask.id = 'scan-mask';
    pcMask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    const shortPath = dirPath.split('\\').slice(-2).join('\\') || dirPath;
    pcMask.innerHTML = `<div style="background:#161d28;border:1px solid #2a3d55;border-radius:14px;padding:28px 32px;min-width:380px;max-width:460px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <div style="width:40px;height:40px;border-radius:8px;background:rgba(64,208,255,.15);display:flex;align-items:center;justify-content:center;font-size:1.2rem">🔍</div>
        <div>
          <div style="font-size:.95rem;font-weight:700;color:#f0f6ff">扫描PC目录</div>
          <div style="font-size:.72rem;color:#507090;font-family:monospace;margin-top:2px">${dirPath}</div>
        </div>
      </div>
      <div style="margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:.72rem;color:#507090">扫描进度</span>
          <span id="pc-scan-pct" style="font-size:.72rem;font-weight:700;color:#40d0ff">0%</span>
        </div>
        <div style="height:4px;background:#1e2838;border-radius:99px;overflow:hidden">
          <div id="pc-scan-bar" style="height:100%;width:0%;background:#40d0ff;border-radius:99px;transition:width .4s ease"></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
        <div style="background:#1e2838;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:.62rem;color:#507090;margin-bottom:4px">已扫目录</div>
          <div id="pc-scan-dirs" style="font-size:1.3rem;font-weight:700;color:#f0f6ff">0</div>
        </div>
        <div style="background:#1e2838;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:.62rem;color:#507090;margin-bottom:4px">发现图片</div>
          <div id="pc-scan-files" style="font-size:1.3rem;font-weight:700;color:#40d0ff">0</div>
        </div>
        <div style="background:#1e2838;border-radius:8px;padding:12px;text-align:center">
          <div style="font-size:.62rem;color:#507090;margin-bottom:4px">写入DB</div>
          <div id="pc-scan-sent" style="font-size:1.3rem;font-weight:700;color:#3ddc84">0</div>
        </div>
      </div>
      <div style="background:#1e2838;border-radius:8px;padding:10px 12px;margin-bottom:18px;display:flex;align-items:center;gap:8px">
        <span style="font-size:.75rem;color:#507090;flex-shrink:0">📁</span>
        <div id="pc-scan-curdir" style="font-size:.7rem;color:#507090;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:monospace">初始化...</div>
      </div>
      <button id="pc-scan-cancel" style="width:100%;padding:9px;border-radius:7px;background:transparent;border:1px solid #2a3d55;color:#507090;cursor:pointer;font-size:.82rem">取消</button>
    </div>`;
    document.body.appendChild(pcMask);
    document.getElementById('pc-scan-cancel').onclick = () => { pcMask.remove(); };

    try {
      const d = await fetch('/api/pc/scan', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({path: dirPath})}).then(r=>r.json());
      if (d.error) { pcMask.remove(); showToast('扫描失败:' + d.error, 'error'); return; }
      const tid = d.taskId;
      let scanResult = {};
      await new Promise(resolve => {
        const poll = setInterval(async () => {
          try {
            if (!document.getElementById('scan-mask')) { clearInterval(poll); resolve(); return; }
            const prog = await fetch('/api/photos/scan2/progress/' + tid).then(r=>r.json());
            const pct  = prog.done ? 100 : Math.min(99, prog.dirs||0);
            const bar  = document.getElementById('pc-scan-bar');
            if (bar) bar.style.width = pct + '%';
            const pctEl = document.getElementById('pc-scan-pct');
            if (pctEl) pctEl.textContent = pct + '%';
            const dirsEl = document.getElementById('pc-scan-dirs');
            if (dirsEl) dirsEl.textContent = (prog.dirs||0).toLocaleString();
            const filesEl = document.getElementById('pc-scan-files');
            if (filesEl) filesEl.textContent = (prog.actual||0).toLocaleString();
            const sentEl = document.getElementById('pc-scan-sent');
            if (sentEl) sentEl.textContent = (prog.sent||0).toLocaleString();
            const curEl = document.getElementById('pc-scan-curdir');
            if (curEl && prog.currentDir) curEl.textContent = prog.currentDir.split('\\').slice(-2).join('\\');
            if (prog.done) { scanResult = prog; clearInterval(poll); resolve(); }
          } catch(e) { clearInterval(poll); resolve(); }
        }, 800);
      });

      if (!document.getElementById('scan-mask')) return;
      const maskInner = pcMask.querySelector('div');
      maskInner.innerHTML = `<div style="text-align:center">
        <div style="font-size:2.5rem;margin-bottom:16px">✅</div>
        <div style="font-size:1rem;font-weight:700;color:#f0f6ff;margin-bottom:20px">扫描完成</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
          <div style="background:#1e2838;border-radius:8px;padding:14px;text-align:center">
            <div style="font-size:.62rem;color:#507090;margin-bottom:4px">发现图片</div>
            <div style="font-size:1.4rem;font-weight:700;color:#40d0ff">${(scanResult.actual||0).toLocaleString()}</div>
          </div>
          <div style="background:#1e2838;border-radius:8px;padding:14px;text-align:center">
            <div style="font-size:.62rem;color:#507090;margin-bottom:4px">写入DB</div>
            <div style="font-size:1.4rem;font-weight:700;color:#3ddc84">${(scanResult.sent||0).toLocaleString()}</div>
          </div>
        </div>
        <button onclick="document.getElementById('scan-mask').remove()" style="width:100%;padding:10px;border-radius:7px;background:#40d0ff;color:#000;border:none;cursor:pointer;font-weight:700;font-size:.9rem">确定</button>
      </div>`;

      if (window.pcTree && scanResult.dirStats) {
        const normP = (pp) => pp.replace(/\//g, '\\');
        const sorted = Object.keys(scanResult.dirStats).sort((a,b)=>a.split(/[\\/]/).length-b.split(/[\\/]/).length);
        for (const pp of sorted) {
          const np = normP(pp); const st = scanResult.dirStats[pp];
          if (st.total > 0 && st.done < st.total && window.pcTree.has(np)) await window.pcTree.expand(np);
          try {
            const dbSt = await fetch('/api/pc/dir-children?path=' + encodeURIComponent(np) + '&self=1').then(r=>r.json());
            if (dbSt && dbSt.total !== undefined) {
              window.pcTree.updateStats(np, dbSt.done||0, dbSt.total, dbSt.total-(dbSt.done||0));
            } else {
              window.pcTree.updateStats(np, st.done||0, st.total, st.total-(st.done||0));
            }
          } catch(e) {
            window.pcTree.updateStats(np, st.done||0, st.total, st.total-(st.done||0));
          }
        }
      }
      if (state.pcMode && state.filter.pcPath) loadPcPhotos(state.filter.pcPath);
    } catch(e) {
      if (document.getElementById('scan-mask')) document.getElementById('scan-mask').remove();
      showToast('扫描失败:' + e.message, 'error');
    }
    return;
  }
  // NAS 目录扫描逻辑
  const mask = document.createElement("div");
  mask.id = "dispatch-mask";
  mask.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-size:1rem;gap:12px";
  mask.innerHTML = `<div style="font-size:2rem">📤</div><div>扫描中...</div><div style="font-size:.8rem;color:#909090">${path}</div><div id="dispatch-progress" style="margin-top:8px;color:#40d0ff">初始化...</div>`;
  document.body.appendChild(mask);
  try {
    const d = await fetch("/api/photos/dispatch/dir2", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dirPath: path, reprocess: false }),
    }).then(r => r.json());

    let result = {};
    await new Promise(resolve => {
      const poll = setInterval(async () => {
        try {
          const p = await fetch(`/api/photos/scan2/progress/${d.taskId}`).then(r => r.json());
          const el = document.getElementById("dispatch-progress");
          if (el) el.textContent = `扫描 ${p.scanned} 张，加入队列 ${p.added}，跳过 ${p.skipped}`;
          if (p.done) { result = p; clearInterval(poll); resolve(); }
        } catch(e) { clearInterval(poll); resolve(); }
      }, 500);
    });

    mask.innerHTML = `
      <div style="background:#1e2838;border:1px solid #2a3d55;border-radius:12px;padding:24px 32px;min-width:280px;text-align:center">
        <div style="font-size:1.1rem;font-weight:bold;margin-bottom:16px">✅ 扫描完成</div>
        <div style="margin-bottom:16px;color:#c8dff5;line-height:1.8">
          扫描文件：<span style="color:#40d0ff">${result.scanned||0}</span> 张<br>
          加入队列：<span style="color:#3ddc84">${result.added||0}</span> 张<br>
          已完成跳过：<span style="color:#ffa500">${result.skipped||0}</span> 张
        </div>
        <button onclick="document.getElementById('dispatch-mask').remove()" style="padding:8px 24px;border-radius:6px;background:#40d0ff;color:#000;border:none;cursor:pointer">确定</button>
      </div>`;

    await fetch("/api/dir-stats/recalc", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const stats = await fetch(`/api/dir-stats?path=${encodeURIComponent(path)}`).then(r => r.json());
    for (const s of stats) {
      if (window.dirTree && window.dirTree.has(s.path)) {
        window.dirTree.updateStats(s.path, s.done_files, s.total_files, s.pending_files);
      }
    }
  } catch(e) {
    if (document.body.contains(mask)) document.body.removeChild(mask);
    showToast("扫描失败: " + e.message, "error");
  }
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

async function deleteDir(dirPath) {
  const r = await fetch('/api/photos/stats/by-dir?path=' + encodeURIComponent(dirPath));
  const s = await r.json();
  if (!confirm('确认删除整个目录？\n' + dirPath + '\n共 ' + (s.total||0) + ' 张图片\n原文件、缩略图、数据库记录全部删除，不可恢复！')) return;
  const r2 = await fetch('/api/photos/delete-dir', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({dirPath})});
  const d  = await r2.json();
  if (d.deleted !== undefined) { showToast('已删除 ' + d.deleted + ' 张，目录已移除'); loadSidebar(); loadPhotos(true); }
  else showToast('删除失败:' + (d.error||'未知'), 'error');
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

// ── 侧边栏折叠/拖拽（统一实现） ──
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
    // 恢复上次状态
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

// ── 全量加载目录节点（重新扫描后用） ──
async function renderDirNodeFull(node, container, depth) {
  const indent = depth * 12;
  const icon   = depth === 0 ? '📁' : '📂';

  const wrap = document.createElement('div');
  const row  = document.createElement('div');
  row.className    = 'sidebar-item dir-node';
  row.dataset.path = node.path;
  row.dataset.depth = depth;
  row.style.cssText = `padding-left:${14+indent}px;font-size:${depth===0?'.83':'.78'}rem;display:flex;align-items:center;gap:4px;flex-wrap:nowrap;overflow:hidden`;

  const toggleIcon = document.createElement('span');
  toggleIcon.className   = 'dir-toggle-icon';
  toggleIcon.textContent = node.hasChildren ? '▼' : '　';

  const nameSpan = document.createElement('span');
  nameSpan.textContent    = icon + ' ' + node.name;
  nameSpan.style.flex     = '1';
  nameSpan.style.overflow = 'hidden';
  nameSpan.style.textOverflow = 'ellipsis';
  nameSpan.style.whiteSpace   = 'nowrap';

  const statsSpan = document.createElement('span');
  statsSpan.style.cssText = 'font-size:.65rem;flex-shrink:0;margin-left:4px';
  statsSpan.textContent   = node.count || '';

  row.appendChild(toggleIcon);
  row.appendChild(nameSpan);
  row.appendChild(statsSpan);

  const childContainer = document.createElement('div');
  childContainer.style.display = 'block';

  if (node.hasChildren) {
    try {
      const children = await fetch(`/api/dir-tree?source=nas&path=${encodeURIComponent(node.path)}`).then(r=>r.json());
      for (const c of children) {
        await renderDirNodeFull(c, childContainer, depth + 1);
      }
    } catch(e) {}
  }

  row.addEventListener('click', () => {
    const isOpen = childContainer.style.display !== 'none';
    childContainer.style.display  = isOpen ? 'none' : 'block';
    toggleIcon.textContent         = isOpen ? '▶' : '▼';
    document.querySelectorAll('.sidebar-item.dir-node').forEach(el => el.classList.remove('active'));
    row.classList.add('active');
    state.filter.dirPath  = node.path;
    state.filter.year     = 0;
    state.filter.month    = 0;
    state.filter.favorite = false;
    loadPhotos(true);
    loadDirStatsLazy(node.path, statsSpan);
  });

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    ctxMenu.show(e.clientX, e.clientY, [
      { label: node.name },
      { sep: true },
      { icon: '🔍', text: '查看此目录图片',   action: () => row.click() },
      { icon: '▶',  text: '派发给PC处理',     action: () => dispatchDir(node.path, false) },
      { icon: '🔄', text: '重新处理全部图片', action: () => dispatchDir(node.path, true) },
      { sep: true },
      { icon: '🔁', text: '重新扫描目录',     action: () => scanDir(node.path) },
    ]);
  });

  setTimeout(() => loadDirStatsLazy(node.path, statsSpan), 300);

  wrap.appendChild(row);
  wrap.appendChild(childContainer);
  container.appendChild(wrap);
}