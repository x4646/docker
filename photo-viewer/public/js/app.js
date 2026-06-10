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
  const row    = document.createElement("div");
  row.className = "sidebar-item dir-node";
  row.style.cssText = `padding-left:${14+indent}px;font-size:${depth===0?".83":".78"}rem;display:flex;align-items:center;gap:4px`;

  const toggleIcon = document.createElement("span");
  toggleIcon.className   = "dir-toggle-icon";
  toggleIcon.textContent = "▶";
  toggleIcon.style.flexShrink = "0";

  const nameSpan = document.createElement("span");
  nameSpan.textContent = "💻 " + (node.name || node.path.split("\\").pop().split("/").pop());
  nameSpan.style.flex  = "1";

  row.appendChild(toggleIcon);
  row.appendChild(nameSpan);

  const childContainer = document.createElement("div");
  childContainer.style.display = "none";
  let loaded = false;

  row.addEventListener("click", () => {
    const isOpen = childContainer.style.display !== "none";
    if (!isOpen && !loaded) {
      loaded = true;
      toggleIcon.textContent = "⟳";
      const pcPath = node.path || node;
      fetch(`/api/pc/browse?path=${encodeURIComponent(pcPath)}`)
        .then(r => r.json())
        .then(items => {
          if (items.error) {
            toggleIcon.textContent = "✕";
            return;
          }
          items.forEach(item => {
            if (item.type === "dir") {
              renderPcDirNode(item, childContainer, depth + 1);
            }
          });
          childContainer.style.display = "block";
          toggleIcon.textContent = "▼";
        })
        .catch(() => { toggleIcon.textContent = "▶"; });
    } else {
      childContainer.style.display = isOpen ? "none" : "block";
      toggleIcon.textContent        = isOpen ? "▶" : "▼";
    }
    document.querySelectorAll(".sidebar-item.dir-node").forEach(el => el.classList.remove("active"));
    row.classList.add("active");
    state.filter.dirPath  = "";
    state.filter.pcPath   = node.path || node;
    state.filter.year     = 0;
    state.filter.month    = 0;
    state.filter.favorite = false;
    loadPcPhotos(node.path || node);
  });

  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    ctxMenu.show(e.clientX, e.clientY, [
      { label: node.name || node.path },
      { sep: true },
      { icon: "▶", text: "派发给PC处理", action: () => dispatchPcDir(node.path || node) },
    ]);
  });

  container.appendChild(row);
  container.appendChild(childContainer);
}

async function loadPcPhotos(pcPath) {
  // 显示状态栏
  const statsBar = document.querySelector(".stats-bar");
  if (statsBar) statsBar.innerHTML = `💻 ${pcPath} <span style="color:#507090;font-size:.8rem">加载中...</span>`;

  // 查询数据库里已处理的
  const r    = await fetch(`/api/photos?dirPath=${encodeURIComponent(pcPath)}&limit=50&page=1`);
  const data = await r.json();

  // 同时异步获取统计
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

  // 显示已处理图片
  if (data.photos && data.photos.length) {
    state.photos  = data.photos;
    state.total   = data.total;
    state.page    = 2;
    state.hasMore = data.total > 50;
    renderGrid(data.photos, true);
    document.getElementById("stats-total").textContent = data.total;
  } else {
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

  // 目录行
  const row = document.createElement('div');
  row.className = 'sidebar-item dir-node';
  row.style.cssText = `padding-left:${14+indent}px;font-size:${depth===0?'.83':'.78'}rem;display:flex;align-items:center;gap:4px`;

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

  // 子目录容器（懒加载）
  const childContainer = document.createElement('div');
  childContainer.style.display = 'none';
  let loaded = false;

  // 展开/收起
  const toggle = () => {
    if (!node.hasChildren) return;
    const isOpen = childContainer.style.display !== 'none';
    if (!isOpen && !loaded) {
      loaded = true;
      toggleIcon.textContent = '⟳';
      fetch(`/api/photos/groups/dir?path=${encodeURIComponent(node.path)}`)
        .then(r => r.json())
        .then(children => {
          children.forEach(c => renderDirNode(c, childContainer, depth + 1));
          childContainer.style.display = 'block';
          toggleIcon.textContent = '▼';
          // 懒加载状态
          setTimeout(() => loadDirStatsLazy(node.path, statsSpan), 0);
        })
        .catch(() => { toggleIcon.textContent = '▶'; });
    } else {
      childContainer.style.display = isOpen ? 'none' : 'block';
      toggleIcon.textContent        = isOpen ? '▶' : '▼';
    }
  };

  // 点击展开+过滤图片
  row.addEventListener('click', () => {
    toggle();
    document.querySelectorAll('.sidebar-item.dir-node').forEach(el => el.classList.remove('active'));
    row.classList.add('active');
    state.filter.dirPath  = node.path;
    state.filter.year     = 0;
    state.filter.month    = 0;
    state.filter.favorite = false;
    loadPhotos(true);
    // 懒加载状态
    if (node.done === undefined) loadDirStatsLazy(node.path, statsSpan);
  });

  // 右键菜单
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
    ]);
  });

  wrap.appendChild(row);
  wrap.appendChild(childContainer);
  container.appendChild(wrap);
}

function renderDirStatsInline(el, stats) {
  if (stats.pending > 0) {
    el.innerHTML = `<span style="color:#3ddc84">${stats.done}</span><span style="color:#507090">/</span><span style="color:#ffa500">${stats.count}</span>`;
  } else {
    el.innerHTML = `<span style="color:#3ddc84">✅${stats.done}</span>`;
  }
}

async function loadDirStatsLazy(path, el) {
  if (el.dataset.loaded) return;
  el.dataset.loaded = '1';
  try {
    const r     = await fetch(`/api/photos/stats/by-dir?path=${encodeURIComponent(path)}`);
    const stats = await r.json();
    dirStatsCache.set(path, stats);
    if (stats.pending > 0 || stats.processing > 0) {
      el.innerHTML = `<span style="color:#3ddc84">${stats.done}</span><span style="color:#507090">/</span><span style="color:#ffa500">${stats.total}</span>`;
    } else if (stats.done > 0) {
      el.innerHTML = `<span style="color:#3ddc84">✅${stats.done}</span>`;
    } else {
      el.innerHTML = `<span style="color:#507090">${stats.total}</span>`;
    }
  } catch(e) {}
}

async function loadSidebar() {
  const sidebar = document.querySelector('.sidebar');
  sidebar.innerHTML = '';

  // 视图部分（立即显示）
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

  // 目录部分（异步加载）
  const secDir = document.createElement('div');
  secDir.className = 'sidebar-section';
  secDir.style.marginTop = '8px';
  secDir.textContent = '目录';
  sidebar.appendChild(secDir);

  const dirContainer = document.createElement('div');
  sidebar.appendChild(dirContainer);

  // 时间轴占位
  const secTime = document.createElement('div');
  secTime.className = 'sidebar-section';
  secTime.style.marginTop = '8px';
  secTime.textContent = '时间轴';
  sidebar.appendChild(secTime);
  const timeContainer = document.createElement('div');
  sidebar.appendChild(timeContainer);

  // 标签占位
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
  fetch('/api/photos/groups/dir')
    .then(r => r.json())
    .then(dirs => {
      renderDirTree(dirs, dirContainer);
    })
    .catch(() => {});

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

  // PC目录
  const secPc = document.createElement("div");
  secPc.className = "sidebar-section";
  secPc.style.marginTop = "8px";
  secPc.textContent = "💻 PC";
  sidebar.appendChild(secPc);
  const pcContainer = document.createElement("div");
  sidebar.appendChild(pcContainer);
  fetch("/api/pc-roots")
    .then(r => r.json())
    .then(roots => {
      if (!roots.length) {
        const el = document.createElement("div");
        el.style.cssText = "padding:8px 16px;font-size:.75rem;color:#507090";
        el.textContent = "未配置PC目录";
        pcContainer.appendChild(el);
        return;
      }
      roots.forEach(root => renderPcDirNode(root, pcContainer, 0));
    })
    .catch(() => {});

  // 异步加载标签
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
      const photo = state.photos[idx];
      ctxMenu.show(e.clientX, e.clientY, [
        { icon: "👁",  text: "预览",         action: () => openViewer(idx) },
        { icon: "▶",  text: "重新处理",       action: () => reprocessPhoto(photo.id) },
        { sep: true },
        { icon: "🏷",  text: "编辑标签",      action: () => addTagPrompt(photo.id) },
        { icon: "❤️", text: photo.favorite ? "取消收藏" : "收藏", action: () => toggleFav(e, photo.id) },
        { sep: true },
        { icon: "🗑",  text: "从索引删除",    action: () => deletePhoto(photo.id), danger: true },
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
    if (state.viewer.zoom !== 1) { resetViewerTransform(); }
    else {
      state.viewer.zoom = 2.5;
      const rect = wrap.getBoundingClientRect();
      state.viewer.panX = (rect.width/2  - e.clientX) * 1.5;
      state.viewer.panY = (rect.height/2 - e.clientY) * 1.5;
    }
    applyTransform(); showZoomIndicator();
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
  img.style.transition = state.viewer.dragging ? 'none' : 'transform .05s ease';
  img.style.transform  = `translate(${state.viewer.panX}px, ${state.viewer.panY}px) scale(${state.viewer.zoom})`;

  if (state.viewer.zoom > 2 && photo && img.dataset.mode !== 'original') {
    img.dataset.mode = 'original';
    const src = `/original${photo.path}`;
    const tmp = new Image();
    tmp.onload = () => { img.src = src; };
    tmp.src = src;
  } else if (state.viewer.zoom <= 2 && img.dataset.mode === 'original') {
    img.dataset.mode = 'preview';
    if (photo) img.src = photo.preview_path ? `/preview/${photo.preview_path.split('/').pop()}` : `/original${photo.path}`;
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
  document.getElementById('btn-slideshow').classList.add('active');
  state.slideshow.timer = setInterval(() => viewerNext(), state.slideshow.interval);
  if (!state.music.playing) playMusic();
}

function stopSlideshow() {
  state.slideshow.active = false;
  document.getElementById('btn-slideshow').classList.remove('active');
  clearInterval(state.slideshow.timer);
}

// ── 键盘 ──────────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (!document.getElementById('viewer').classList.contains('show')) return;
    switch(e.key) {
      case 'ArrowLeft':  viewerPrev(); break;
      case 'ArrowRight': viewerNext(); break;
      case 'Escape':     closeViewer(); break;
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
function updateStats() { document.getElementById('stats-total').textContent = state.total; }
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
const dirStatsCache = new Map();

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
  ]);
}

async function dispatchDir(path, reprocess) {
  showToast(reprocess ? '重新处理中...' : '派发中...');
  try {
    const r = await fetch('/api/photos/dispatch/dir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirPath: path, reprocess }),
    });
    const d = await r.json();
    showToast(`已派发 ${d.sent} 个任务`);
    // 清除缓存，重新加载状态
    dirStatsCache.delete(path);
    const statsId = 'stats_dir_' + btoa(encodeURIComponent(path)).replace(/[^a-zA-Z0-9]/g, '_');
    loadDirStats(path, statsId);
  } catch(e) {
    showToast('派发失败: ' + e.message, 'error');
  }
}

async function scanDir(path) {
  showToast('扫描中...');
  try {
    const r = await fetch('/api/photos/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const d = await r.json();
    showToast(`扫描完成，发现 ${d.count} 张图片`);
    dirStatsCache.clear();
    // 只更新当前目录状态，不刷新整个侧边栏
    document.querySelectorAll(".sidebar-item.dir-node.active").forEach(el => {
      const statsEl = el.nextElementSibling;
      if (statsEl && statsEl.dataset) loadDirStatsLazy(path, statsEl);
    });
    loadPhotos(true);
  } catch(e) {
    showToast('扫描失败', 'error');
  }
}

// ── 图片操作 ──────────────────────────────────────────
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
  if (!confirm('确认从索引删除？（不删除原文件）')) return;
  try {
    await fetch(`/api/photos/${id}`, { method: 'DELETE' });
    state.photos = state.photos.filter(p => p.id !== id);
    loadPhotos(true);
    showToast('已删除');
  } catch(e) {
    showToast('失败', 'error');
  }
}

// ── 侧边栏可调宽度 ────────────────────────────────────
(function() {
  const resizer  = document.getElementById('sidebar-resizer');
  const sidebar  = document.getElementById('sidebar');
  const main     = document.querySelector('.main');
  if (!resizer || !sidebar) return;

  let startX = 0, startW = 0;

  resizer.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (e) => {
      const newW = Math.max(120, Math.min(400, startW + e.clientX - startX));
      sidebar.style.width = newW + 'px';

    };

    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      localStorage.setItem('sidebar-width', sidebar.offsetWidth);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  // 恢复上次宽度
  const saved = localStorage.getItem('sidebar-width');
  if (saved) {
    sidebar.style.width = saved + 'px';

  }
})();
