let playlists  = [];
let currentPl  = null;
let dispatching = false;
let dispatchTimer = null;

// ── 初始化 ────────────────────────────────────────────
async function init() {
  await Promise.all([loadStats(), loadDirs(), loadPlaylists(), loadMusicSettings(), loadBrowserRoots()]);
  setInterval(loadStats, 5000);
}

function switchTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('page-' + tab).style.display = 'block';
}

// ── 处理状态 ──────────────────────────────────────────
async function loadStats() {
  const r     = await fetch('/api/photos/stats');
  const stats = await r.json();
  document.getElementById('stat-pending').textContent    = stats.pending    || 0;
  document.getElementById('stat-processing').textContent = stats.processing || 0;
  document.getElementById('stat-done').textContent       = stats.done       || 0;
  document.getElementById('stat-error').textContent      = stats.error      || 0;
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const done  = stats.done || 0;
  const pct   = total > 0 ? Math.round(done / total * 100) : 0;
  document.getElementById('progress-bar').style.width  = pct + '%';
  document.getElementById('progress-text').textContent = `${pct}% (${done}/${total})`;
}

function toggleDispatch() {
  if (dispatching) {
    stopDispatch();
  } else {
    startDispatch();
  }
}

function startDispatch() {
  dispatching = true;
  document.getElementById('btn-dispatch').textContent   = '⏸ 暂停派发';
  document.getElementById('btn-dispatch').style.background = '#ff9500';
  doDispatch();
  dispatchTimer = setInterval(doDispatch, 5000);
}

function stopDispatch() {
  dispatching = false;
  clearInterval(dispatchTimer);
  document.getElementById('btn-dispatch').textContent   = '▶ 开始派发';
  document.getElementById('btn-dispatch').style.background = '';
}

async function doDispatch() {
  if (!dispatching) return;
  const r = await fetch('/api/photos/dispatch', { method: 'POST' });
  const d = await r.json();
  if (d.sent === 0 && (await getStats()).pending === 0) {
    stopDispatch();
    showToast('全部处理完成', 'success');
  }
  loadStats();
}

async function getStats() {
  const r = await fetch('/api/photos/stats');
  return r.json();
}

// ── 监控目录 ──────────────────────────────────────────
async function loadDirs() {
  const r    = await fetch('/api/watch-dirs');
  const dirs = await r.json();
  const list = document.getElementById('dir-list');
  list.innerHTML = dirs.map(d => `
    <div class="dir-item">
      <div class="dir-path">${escHtml(d.path)}</div>
      <div class="dir-actions">
        <button class="btn-sm success" onclick="scanDir(${d.id},'${escJs(d.path)}')">🔍 扫描</button>
        <button class="btn-sm danger"  onclick="deleteDir(${d.id})">删除</button>
      </div>
    </div>`).join('') || '<div style="color:#507090;padding:12px">暂无监控目录</div>';
}

function openAddDirBrowser() {
  const browser = new FileBrowser({
    mode:   'dir',
    source: 'nas',
    title:  '选择监控目录',
    onConfirm: async (path) => {
      await fetch('/api/watch-dirs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      loadDirs();
      showToast('目录已添加', 'success');
    }
  });
  browser.open();
}

async function deleteDir(id) {
  if (!confirm('确认删除监控目录？')) return;
  await fetch(`/api/watch-dirs/${id}`, { method: 'DELETE' });
  loadDirs();
  showToast('已删除', 'success');
}

async function scanDir(id, path) {
  showToast('扫描中...', 'success');
  const r = await fetch('/api/photos/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const d = await r.json();
  showToast(`扫描完成，发现 ${d.count} 张图片`, 'success');
  loadStats();
}

// ── 播放列表管理 ──────────────────────────────────────
async function loadPlaylists() {
  const r   = await fetch('/api/playlists');
  playlists = await r.json();
  renderPlaylists();
}

function renderPlaylists() {
  const list = document.getElementById('playlist-list');
  list.innerHTML = playlists.map(p => `
    <div class="playlist-item" onclick="openPlaylist(${p.id})">
      <div class="playlist-name">🎵 ${escHtml(p.name)}</div>
      <div class="playlist-count">${(p.songs||[]).length} 首</div>
      <div class="dir-actions">
        <button class="btn-sm danger" onclick="event.stopPropagation();deletePlaylist(${p.id})">删除</button>
      </div>
    </div>`).join('') || '<div style="color:#507090;padding:12px">暂无播放列表</div>';
}

function openAddPlaylistModal() {
  document.getElementById('pl-name').value = '';
  document.getElementById('pl-modal').classList.add('show');
}

function closePlModal() {
  document.getElementById('pl-modal').classList.remove('show');
}

async function confirmAddPlaylist() {
  const name = document.getElementById('pl-name').value.trim();
  if (!name) { showToast('请输入名称', 'error'); return; }
  await fetch('/api/playlists', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, songs: [] }),
  });
  closePlModal();
  loadPlaylists();
  showToast('播放列表已创建', 'success');
}

async function deletePlaylist(id) {
  if (!confirm('确认删除？')) return;
  await fetch(`/api/playlists/${id}`, { method: 'DELETE' });
  loadPlaylists();
  showToast('已删除', 'success');
}

function openPlaylist(id) {
  currentPl = playlists.find(p => p.id === id);
  if (!currentPl) return;
  document.getElementById('edit-pl-title').textContent = currentPl.name;
  renderSongList();
  document.getElementById('edit-pl-modal').classList.add('show');
}

function closeEditPlModal() {
  document.getElementById('edit-pl-modal').classList.remove('show');
  currentPl = null;
}

function openAddSongBrowser() {
  const browser = new FileBrowser({
    mode:   'multi',
    source: 'nas',
    filter: ['.mp3', '.flac', '.aac', '.wav', '.m4a', '.ogg'],
    title:  '选择音乐文件',
    onConfirm: async (paths) => {
      if (!currentPl) return;
      const songs = [...(currentPl.songs || [])];
      paths.forEach(p => {
        if (!songs.find(s => s.path === p)) {
          songs.push({ path: p, name: p.split('/').pop() });
        }
      });
      currentPl.songs = songs;
      await fetch(`/api/playlists/${currentPl.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: currentPl.name, songs }),
      });
      renderSongList();
      showToast(`已添加 ${paths.length} 首`, 'success');
    }
  });
  browser.open();
}

function renderSongList() {
  if (!currentPl) return;
  const songs = currentPl.songs || [];
  document.getElementById('song-list').innerHTML = songs.map((s, i) => `
    <div class="song-item">
      <span style="color:#507090;font-size:.7rem;width:20px">${i+1}</span>
      <span class="song-name">${escHtml(s.name || s.path.split('/').pop())}</span>
      <span class="song-path">${escHtml(s.path)}</span>
      <button class="btn-sm danger" onclick="removeSong(${i})">✕</button>
    </div>`).join('') || '<div style="color:#507090;padding:12px">暂无歌曲，点击上方添加</div>';
}

async function removeSong(idx) {
  if (!currentPl) return;
  const songs = [...(currentPl.songs || [])];
  songs.splice(idx, 1);
  currentPl.songs = songs;
  await fetch(`/api/playlists/${currentPl.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: currentPl.name, songs }),
  });
  renderSongList();
}

// ── 浏览器根目录管理 ──────────────────────────────────
async function loadBrowserRoots() {
  const r     = await fetch('/api/browser/roots?source=nas');
  const roots = await r.json();
  const list  = document.getElementById('browser-roots-list');
  if (!list) return;
  list.innerHTML = roots.map(r => `
    <div class="dir-item">
      <div class="dir-path"><strong>${escHtml(r.name)}</strong> — ${escHtml(r.path)}</div>
      <div class="dir-actions">
        <button class="btn-sm danger" onclick="deleteRoot(${r.id})">删除</button>
      </div>
    </div>`).join('') || '<div style="color:#507090;padding:12px">暂无根目录</div>';
}

function openAddRootBrowser() {
  const browser = new FileBrowser({
    mode:   'dir',
    source: 'nas',
    title:  '选择根目录',
    onConfirm: async (path) => {
      const name = prompt('给这个目录起个名字：', path.split('/').pop());
      if (!name) return;
      await fetch('/api/browser/roots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, path, source: 'nas' }),
      });
      loadBrowserRoots();
      showToast('根目录已添加', 'success');
    }
  });
  browser.open();
}

async function deleteRoot(id) {
  if (!confirm('确认删除根目录？')) return;
  await fetch(`/api/browser/roots/${id}`, { method: 'DELETE' });
  loadBrowserRoots();
  showToast('已删除', 'success');
}

// ── 音乐设置 ──────────────────────────────────────────
async function loadMusicSettings() {
  const r   = await fetch('/api/music-settings');
  const cfg = await r.json();
  if (!cfg) return;
  document.getElementById('music-mode').value     = cfg.mode     || 'shuffle';
  document.getElementById('music-volume').value   = cfg.volume   || 0.6;
  document.getElementById('music-autoplay').checked = cfg.auto_play === 1;
  document.getElementById('music-volume-val').textContent = Math.round((cfg.volume||0.6)*100) + '%';
}

document.addEventListener('change', e => {
  if (e.target.id === 'music-volume') {
    document.getElementById('music-volume-val').textContent = Math.round(e.target.value * 100) + '%';
  }
});

async function saveMusicSettings() {
  await fetch('/api/music-settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode:      document.getElementById('music-mode').value,
      volume:    parseFloat(document.getElementById('music-volume').value),
      auto_play: document.getElementById('music-autoplay').checked,
    }),
  });
  showToast('设置已保存', 'success');
}

// ── 工具 ──────────────────────────────────────────────
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escJs(s)   { return String(s).replace(/'/g,"\\'"); }
function showToast(msg, type='success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', init);
