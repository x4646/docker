let playlists    = [];
let editPlaylist = null;
let browserPath  = '/share';
let browserMode  = '';
let currentPl    = null;

async function init() {
  await Promise.all([loadStats(), loadDirs(), loadPlaylists()]);
  setInterval(loadStats, 5000);
}

function switchTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('page-' + tab).style.display = 'block';
}

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

async function startDispatch() {
  const r = await fetch('/api/photos/dispatch', { method: 'POST' });
  const d = await r.json();
  showToast(`已派发 ${d.sent} 个任务`, 'success');
  loadStats();
}

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

function openAddDirModal() {
  browserMode = 'dir';
  browserPath = '/share';
  document.getElementById('selected-dir-path').textContent = '未选择';
  loadBrowser('/share');
  document.getElementById('dir-modal').classList.add('show');
}

function closeDirModal() {
  document.getElementById('dir-modal').classList.remove('show');
}

async function confirmAddDir() {
  const path = document.getElementById('selected-dir-path').textContent;
  if (!path || path === '未选择') { showToast('请选择目录', 'error'); return; }
  await fetch('/api/watch-dirs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  closeDirModal();
  loadDirs();
  showToast('目录已添加', 'success');
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

async function loadBrowser(path) {
  if (path) browserPath = path;
  document.getElementById('browser-path').textContent = browserPath;

  const r     = await fetch(`/api/music/browse?path=${encodeURIComponent(browserPath)}`);
  const items = await r.json();
  const list  = document.getElementById('browser-list');
  list.innerHTML = '';

  if (browserPath !== '/' && browserPath !== '/share') {
    const up = document.createElement('div');
    up.className = 'file-item dir';
    up.textContent = '📁 ..';
    up.onclick = () => loadBrowser(browserPath.split('/').slice(0,-1).join('/') || '/share');
    list.appendChild(up);
  }

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = `file-item ${item.type}`;
    if (item.type === 'dir') {
      el.textContent = `📁 ${item.name}`;
      el.onclick = () => {
        if (browserMode === 'dir') {
          document.getElementById('selected-dir-path').textContent = item.path;
        }
        loadBrowser(item.path);
      };
    } else {
      el.textContent = `🎵 ${item.name}`;
      el.onclick = () => addSongToPlaylist(item);
    }
    list.appendChild(el);
  });
}

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
  browserMode = 'song';
  loadBrowser('/share');
  document.getElementById('edit-pl-modal').classList.add('show');
}

function closeEditPlModal() {
  document.getElementById('edit-pl-modal').classList.remove('show');
  currentPl = null;
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
    </div>`).join('') || '<div style="color:#507090;padding:12px">暂无歌曲</div>';
}

async function addSongToPlaylist(item) {
  if (!currentPl) return;
  const songs = [...(currentPl.songs || [])];
  if (songs.find(s => s.path === item.path)) { showToast('歌曲已存在', 'error'); return; }
  songs.push({ path: item.path, name: item.name });
  currentPl.songs = songs;
  await fetch(`/api/playlists/${currentPl.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: currentPl.name, songs }),
  });
  renderSongList();
  showToast(`已添加：${item.name}`, 'success');
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

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escJs(s)   { return String(s).replace(/'/g,"\\'"); }
function showToast(msg, type='success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', init);
