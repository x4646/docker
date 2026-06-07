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
async function loadSidebar() {
  const [dirsRes, timeRes] = await Promise.all([
    fetch('/api/photos/groups/dir'),
    fetch('/api/photos/groups/time'),
  ]);
  const dirs  = await dirsRes.json();
  const times = await timeRes.json();

  // 按年分组
  const years = {};
  times.forEach(t => {
    if (!years[t.year]) years[t.year] = [];
    years[t.year].push(t);
  });

  const months     = ['','1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const totalCount = times.reduce((a, b) => a + b.count, 0);

  let html = `
    <div class="sidebar-section">视图</div>
    <div class="sidebar-item active" id="item-all" onclick="setDirFilter('',0,0,this)">📷 全部 <small style="color:#507090">${totalCount}</small></div>
    <div class="sidebar-item" onclick="setFavFilter(this)">❤️ 收藏</div>
    <div class="sidebar-section" style="margin-top:8px">目录</div>`;

  // 构建树状结构
  const renderDirTree = (items) => {
    // 找到depth=0的根目录
    const roots = items.filter(d => d.depth === 0);
    
    const renderNode = (node, allItems) => {
      const indent  = node.depth * 10;
      const icon    = node.depth === 0 ? '📁' : node.depth === 1 ? '🗂' : '📂';
      const nodeId  = 'dir_' + node.path.replace(/[^a-zA-Z0-9]/g, '_');
      
      // 找子目录
      const children = allItems.filter(d => 
        d.depth === node.depth + 1 && 
        d.path.startsWith(node.path + '/')
      );

      let result = `
        <div class="sidebar-item dir-node" 
             style="padding-left:${14+indent}px;font-size:${node.depth===0?'.82':'.76'}rem"
             onclick="toggleDirNode('${nodeId}', '${escJs(node.path)}', this)">
          <span class="dir-toggle-icon">${children.length ? '▶' : '　'}</span>
          ${icon} ${escHtml(node.name)}
          <small style="color:#507090;margin-left:4px">${node.count}</small>
        </div>
        <div id="${nodeId}" style="display:none">
          ${children.map(c => renderNode(c, allItems)).join('')}
        </div>`;
      return result;
    };

    return roots.map(r => renderNode(r, items)).join('');
  };

  html += renderDirTree(dirs);

  // 时间轴
  html += `<div class="sidebar-section" style="margin-top:8px">时间轴</div>`;
  Object.entries(years).sort((a,b) => Number(b[0])-Number(a[0])).forEach(([year, ms]) => {
    const yearCount = ms.reduce((a,b) => a+b.count, 0);
    html += `
      <div class="sidebar-item" onclick="toggleYearNode('months_${year}', this)">
        <span class="dir-toggle-icon">▶</span>📅 ${year}年
        <small style="color:#507090;margin-left:4px">${yearCount}</small>
      </div>
      <div id="months_${year}" style="display:none">
        ${ms.map(m => `
          <div class="sidebar-item" style="padding-left:24px;font-size:.76rem"
               onclick="setDirFilter('',${year},${m.month},this)">
            　${months[m.month]} <small style="color:#507090">${m.count}</small>
          </div>`).join('')}
      </div>`;
  });

  html += `<div class="sidebar-section" style="margin-top:8px">标签</div>
    <div class="tag-cloud" id="tag-cloud"></div>`;

  document.querySelector('.sidebar').innerHTML = html;
  loadTags();
}

function toggleDirNode(nodeId, path, el) {
  const container = document.getElementById(nodeId);
  if (container) {
    const isOpen = container.style.display !== 'none';
    container.style.display = isOpen ? 'none' : 'block';
    const icon = el.querySelector('.dir-toggle-icon');
    if (icon) icon.textContent = isOpen ? '▶' : '▼';
  }
  // 同时过滤图片
  document.querySelectorAll('.sidebar-item').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  state.filter.dirPath  = path;
  state.filter.year     = 0;
  state.filter.month    = 0;
  state.filter.favorite = false;
  loadPhotos(true);
}

function toggleYearNode(nodeId, el) {
  const container = document.getElementById(nodeId);
  if (container) {
    const isOpen = container.style.display !== 'none';
    container.style.display = isOpen ? 'none' : 'block';
    const icon = el.querySelector('.dir-toggle-icon');
    if (icon) icon.textContent = isOpen ? '▶' : '▼';
  }
}
function setDirFilter(path, year, month, el) {
  document.querySelectorAll(".sidebar-item").forEach(e => e.classList.remove("active"));
  if (el) el.classList.add("active");
  state.filter.dirPath  = path;
  state.filter.year     = year;
  state.filter.month    = month;
  state.filter.favorite = false;
  loadPhotos(true);
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
  let url = `/api/photos?page=${state.page}&limit=50&status=done`;
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
