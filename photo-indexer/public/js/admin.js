let playlists  = [];
let currentPl  = null;
let dispatching = false;
let dispatchTimer = null;

// ── 初始化 ────────────────────────────────────────────
async function init() {
  await Promise.all([loadStats(), loadNasDirs(), loadPlaylists(), loadMusicSettings(), loadBrowserRoots()]);
  setInterval(loadStats, 5000);
}

function switchTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('page-' + tab).style.display = 'block';
  if (tab === 'pc') { loadPcRoots(); loadPcStats(); }
  if (tab === 'dirs') { loadNasDirs(); }
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
async function __loadDirs_OLD() {
  const r    = await fetch('/api/watch-dirs');
  const dirs = await r.json();
  const list = document.getElementById('dir-list');
  list.innerHTML = dirs.map(d => `
    <div class="dir-item" style="display:flex;align-items:flex-start;gap:8px">
      <input type="checkbox" class="nas-dir-check" value="${d.path}" style="margin-top:4px">
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
      loadNasDirs();
      showToast('目录已添加', 'success');
    }
  });
  browser.open();
}

async function deleteDir(id) {
  if (!confirm('确认删除监控目录？')) return;
  await fetch(`/api/watch-dirs/${id}`, { method: 'DELETE' });
  loadNasDirs();
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

// ── PC目录管理 ────────────────────────────────────────
// ── PC目录树（可展开，B方案） ──────────────────────────
function pcDirActionButtons(path) {
  const esc = (path || '').replace(/'/g, "\\'");
  return `
    <button class="btn-sm" data-path="${path}" onclick="writeMd5(this)" style="border-color:#40d0ff;color:#40d0ff">🔑 打MD5</button>
    <button class="btn-sm" data-path="${path}" onclick="cleanOrphan(this)" style="border-color:#ffa500;color:#ffa500">🧹 清理孤立</button>
    <button class="btn-sm" data-path="${path}" onclick="processPcDir(this)" style="border-color:#3ddc84;color:#3ddc84">⚙ 处理</button>
    <button class="btn-sm danger" data-path="${path}" onclick="deletePcDir(this)">🗑 删除</button>`;
}

// 渲染一行目录（根或子目录通用）
function renderPcDirRow(node, depth) {
  const safeId = 'pcrow_' + btoa(unescape(encodeURIComponent(node.path))).replace(/[^a-zA-Z0-9]/g, '');
  const isRoot = depth === 0;
  const displayName = node.name || node.path.replace(/\\/g,'/').split('/').filter(Boolean).pop();
  // 竖线缩进
  let guides = '';
  for (let i = 0; i < depth; i++) guides += '<span class="pc-guide"></span>';
  return `
    <div class="pc-dir-row" data-path="${node.path}" data-depth="${depth}">
      <div class="pc-row-inner" style="display:flex;align-items:flex-start;gap:6px;padding:7px 0">
        ${guides}
        <span class="pc-toggle" onclick="togglePcDir(this)" data-path="${node.path}" data-depth="${depth}" data-loaded="0">+</span>
        <input type="checkbox" class="pc-dir-check" value="${node.path}" style="margin-top:4px;flex-shrink:0">
        <div style="flex:1;min-width:0">
          <div class="dir-path">
            <strong>${isRoot ? '💻' : '📁'} ${escHtml(displayName)}</strong>
            <small style="color:#507090;margin-left:8px" id="${safeId}_stat">…</small>
          </div>
          <div class="dir-actions" style="margin-top:6px">
            ${pcDirActionButtons(node.path)}
          </div>
        </div>
      </div>
      <div class="pc-children" id="${safeId}_children" style="display:none"></div>
    </div>`;
}

let pcTreeWidget = null;
async function loadPcRoots() {
  const list = document.getElementById('pc-root-list');
  if (!list) return;
  const toolbar = `<div style="display:flex;align-items:center;gap:8px;padding:8px 0 12px;border-bottom:1px solid #2a3d55;margin-bottom:4px;flex-wrap:wrap">
    <button class="btn-sm" style="border-color:#40d0ff;color:#40d0ff" onclick="batchWriteMd5()">🔑 批量打MD5</button>
    <button class="btn-sm" style="border-color:#ffa500;color:#ffa500" onclick="batchCleanOrphan()">🧹 批量清理</button>
    <button class="btn-sm" style="border-color:#3ddc84;color:#3ddc84" onclick="batchProcessPc()">⚙ 批量处理</button>
    <button class="btn-sm" style="border-color:#ff5567;color:#ff5567" onclick="killAllWorkers()">⛔ 停止</button>
    <button class="btn-sm" id="mig-fail-btn" style="margin-left:auto;border-color:#ff5567;color:#ff5567;display:none" onclick="openMigrateFailuresModal()">⚠️ 迁移失败 (<span id="mig-fail-count">0</span>)</button>
    <button class="btn-sm" style="border-color:#a78bfa;color:#a78bfa" onclick="openMigrateModal()">📦 迁移到NAS</button>
    <button class="btn-sm" onclick="loadPcRoots()">🔄 刷新</button>
    <button class="btn btn-primary" onclick="openPcBrowser()">＋ 添加</button>
  </div>
  <div style="display:flex;align-items:center;gap:8px;padding:8px 0;flex-wrap:wrap;border-bottom:1px solid #2a3d55;margin-bottom:8px">
    <input id="pc-filter-name" placeholder="目录名关键词" style="padding:5px 8px;border-radius:6px;border:1px solid #2a3d55;background:#0f1620;color:#c8dff5;font-size:.78rem;width:140px">
    <select id="pc-filter-status" style="padding:5px 8px;border-radius:6px;border:1px solid #2a3d55;background:#0f1620;color:#c8dff5;font-size:.78rem">
      <option value="all">全部状态</option>
      <option value="pending">有未处理</option>
      <option value="error">有错误</option>
      <option value="done">已完成</option>
    </select>
    <input id="pc-filter-min" type="number" placeholder="最小张数" style="padding:5px 8px;border-radius:6px;border:1px solid #2a3d55;background:#0f1620;color:#c8dff5;font-size:.78rem;width:90px">
    <button class="btn-sm" style="border-color:#40d0ff;color:#40d0ff" onclick="applyPcFilter()">🔍 筛选</button>
    <button class="btn-sm" onclick="clearPcFilter()">✕ 清空</button>
    <span id="pc-filter-count" style="font-size:.74rem;color:#507090"></span>
  </div>
  <div id="pc-tree-mount"></div>`;
  list.innerHTML = toolbar;
  pcTreeWidget = new DirTreeWidget({
    container: 'pc-tree-mount',
    source: 'pc',
    mode: 'batch',
    rootsFn: () => fetch('/api/pc-roots').then(r=>r.json()).then(rs=>rs.map(d=>({name:d.name, path:d.path.replace(/\\/g,'/')}))),
    actions: [
      { label:'打MD5', icon:'🔑', color:'#40d0ff', fn: dtwWriteMd5 },
      { label:'清理', icon:'🧹', color:'#ffa500', fn: dtwCleanOrphan },
      { label:'处理', icon:'⚙', color:'#3ddc84', fn: dtwProcess },
    ]
  });
  pcTreeWidget.bind();
  pcTreeWidget.init();
  refreshMigFailCount();
}

// 加载某行的统计到 _stat
async function loadPcRowStat(path) {
  const safeId = 'pcrow_' + btoa(unescape(encodeURIComponent(path))).replace(/[^a-zA-Z0-9]/g, '');
  const el = document.getElementById(safeId + '_stat');
  if (!el) return;
  try {
    const fwd = path.replace(/\\/g, '/').replace(/\/$/, '');
    const q = await fetch('/api/db/query', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sql: "SELECT COUNT(*) total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) done, SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) err, SUM(CASE WHEN status='pending' OR status='processing' THEN 1 ELSE 0 END) pend FROM photos WHERE REPLACE(path,'\\','/') LIKE '" + fwd + "/%'" })
    }).then(r=>r.json());
    const row = (q.rows && q.rows[0]) || {};
    const total = row.total||0, done = row.done||0, err = row.err||0, pend = row.pend||0;
    let html = `总${total} <span style="color:#3ddc84">✅${done}</span> <span style="color:#ffa500">⏳${pend}</span>`;
    if (err > 0) {
      const pesc = path.replace(/'/g, "\\'");
      html += ` <span style="color:#ff5567;cursor:pointer;text-decoration:underline" onclick="showDirErrors('${pesc}')">❌${err}</span>`;
    }
    el.innerHTML = html;
  } catch(e) { el.textContent = ''; }
}

// 展开/收起
async function togglePcDir(toggle) {
  const path  = toggle.dataset.path;
  const depth = parseInt(toggle.dataset.depth);
  const safeId = 'pcrow_' + btoa(unescape(encodeURIComponent(path))).replace(/[^a-zA-Z0-9]/g, '');
  const childBox = document.getElementById(safeId + '_children');
  if (!childBox) return;
  if (childBox.style.display === 'none') {
    // 展开
    if (toggle.dataset.loaded === '0') {
      toggle.textContent = '·';
      const children = await fetch('/api/pc/dir-children?path=' + encodeURIComponent(path)).then(r=>r.json()).catch(()=>[]);
      if (Array.isArray(children) && children.length) {
        childBox.innerHTML = children.map(ch => renderPcDirRow(ch, depth+1)).join('');
        children.forEach(ch => loadPcRowStat(ch.path));
      } else {
        childBox.innerHTML = '<div style="color:#507090;font-size:.72rem;padding:4px 0 4px ' + ((depth+1)*18) + 'px">（无子目录）</div>';
      }
      toggle.dataset.loaded = '1';
    }
    childBox.style.display = 'block';
    toggle.textContent = '−';
  } else {
    childBox.style.display = 'none';
    toggle.textContent = '+';
  }
}

// 自动展开：depth层，超10个子目录的层不展开
async function autoExpandPc(path, depth, maxDepth) {
  if (depth >= maxDepth) return;
  const children = await fetch('/api/pc/dir-children?path=' + encodeURIComponent(path)).then(r=>r.json()).catch(()=>[]);
  if (!Array.isArray(children) || !children.length) return;
  if (children.length > 10) return; // 超10个不自动展开
  const safeId = 'pcrow_' + btoa(unescape(encodeURIComponent(path))).replace(/[^a-zA-Z0-9]/g, '');
  const childBox = document.getElementById(safeId + '_children');
  const toggle = document.querySelector('.pc-toggle[data-path="' + (path.replace(/"/g,'\\"')) + '"]');
  if (!childBox || !toggle) return;
  childBox.innerHTML = children.map(ch => renderPcDirRow(ch, depth+1)).join('');
  children.forEach(ch => loadPcRowStat(ch.path));
  childBox.style.display = 'block';
  toggle.textContent = '−';
  toggle.dataset.loaded = '1';
  for (const ch of children) {
    await autoExpandPc(ch.path, depth+1, maxDepth);
  }
}


function openAddPcRootModal() {
  const name = prompt('目录名称（例：音乐、照片）：');
  if (!name) return;
  const dirPath = prompt('PC目录路径（例：D:\\\\Music）：');
  if (!dirPath) return;
  fetch('/api/pc-roots', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, path: dirPath }),
  }).then(() => {
    loadPcRoots();
    showToast('已添加', 'success');
  });
}

async function editPcRoot(btn) {
  const idx = parseInt(btn.dataset.idx);
  const name = btn.dataset.name;
  const path = btn.dataset.path;
  const newName = prompt('目录名称：', name);
  if (!newName) return;
  const newPath = prompt('PC目录路径：', path);
  if (!newPath) return;
  await fetch('/api/pc-roots/' + idx, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ name: newName, path: newPath }),
  });
  loadPcRoots();
  showToast('已更新', 'success');
}
async function deletePcRoot(idx) {
  if (!confirm('确认删除？')) return;
  await fetch(`/api/pc-roots/${idx}`, { method: 'DELETE' });
  loadPcRoots();
  showToast('已删除', 'success');
}

// 切换到PC标签时加载

// ── 系统配置 ──────────────────────────────────────────
async function loadSysConfig() {
  const r   = await fetch('/api/config/system');
  const cfg = await r.json();
  document.getElementById('cfg-nas-ip').value       = cfg.nas_ip      || '192.168.0.3';
  document.getElementById('cfg-smb-host').value    = cfg.nas_smb_host || 'whfnas';
  document.getElementById('cfg-pipe-port').value    = cfg.pipe_port   || 3030;
  document.getElementById('cfg-indexer-port').value = cfg.indexer_port|| 3050;
  document.getElementById('cfg-viewer-port').value  = cfg.viewer_port || 3051;
  document.getElementById('cfg-sync-port').value    = cfg.sync_port   || 3040;
}

async function saveSysConfig() {
  const cfg = {
    nas_ip:       document.getElementById('cfg-nas-ip').value.trim(),
    nas_smb_host: document.getElementById('cfg-smb-host').value.trim(),
    pipe_port:    parseInt(document.getElementById('cfg-pipe-port').value),
    indexer_port: parseInt(document.getElementById('cfg-indexer-port').value),
    viewer_port:  parseInt(document.getElementById('cfg-viewer-port').value),
    sync_port:    parseInt(document.getElementById('cfg-sync-port').value),
  };
  await fetch('/api/config/system', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  showToast('系统配置已保存', 'success');
}

// ── PC处理状态 ────────────────────────────────────────
async function loadPcProcessStatus() {
  const r     = await fetch('/api/photos/stats');
  const stats = await r.json();
  const el    = document.getElementById('pc-process-detail');
  if (!el) return;

  const total = stats.pending + stats.processing + stats.done + stats.error;
  const pct   = total > 0 ? Math.round(stats.done / total * 100) : 0;

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px">
      <div class="stat-item"><div class="stat-label">待处理</div><div class="stat-value pending">${stats.pending}</div></div>
      <div class="stat-item"><div class="stat-label">处理中</div><div class="stat-value processing">${stats.processing}</div></div>
      <div class="stat-item"><div class="stat-label">已完成</div><div class="stat-value done">${stats.done}</div></div>
      <div class="stat-item"><div class="stat-label">失败</div><div class="stat-value error">${stats.error}</div></div>
    </div>
    <div class="progress-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
    <div style="font-size:.75rem;color:#507090;margin-top:6px">${pct}% (${stats.done}/${total})</div>`;

  document.getElementById('pc-process-status').style.display = 'block';
}

async function loadPcStats() {
  const r = await fetch('/api/photos/stats');
  const s = await r.json();
  const total = (s.done||0)+(s.pending||0)+(s.error||0)+(s.processing||0);
  document.getElementById('pc-stat-total').textContent   = total.toLocaleString();
  document.getElementById('pc-stat-done').textContent    = (s.done||0).toLocaleString();
  document.getElementById('pc-stat-pending').textContent = ((s.pending||0)+(s.processing||0)).toLocaleString();
  document.getElementById('pc-stat-error').textContent   = (s.error||0).toLocaleString();
}

async function loadPcDirStat(path, idx) {
  const fwd = path.replace(/\\/g, '/');
  try {
    const r = await fetch('/api/db/query', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({sql: `SELECT COUNT(*) as total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending FROM photos WHERE path LIKE '${fwd}%'`})
    });
    const d = await r.json();
    const row = d.rows[0];
    const el = document.getElementById('pc-dir-stat-' + idx);
    if (el) el.textContent = `总计${row.total} ✅${row.done} ⏳${row.pending}`;
  } catch(e) {}
}

async function scanPcDir(btn) {
  const path = btn.dataset.path;
  btn.disabled = true; btn.textContent = '扫描中...';
  try {
    const r = await fetch('/api/pc/scan', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({path})
    });
    const d = await r.json();
    if (d.error) showToast('扫描失败: ' + d.error, 'error');
    else showToast('扫描已触发', 'success');
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
  btn.disabled = false; btn.textContent = '🔍 扫描';
}

function toggleAllPcDirs(cb) {
  document.querySelectorAll('.pc-dir-check').forEach(c => c.checked = cb.checked);
}

async function batchWriteMd5() {
  const checked = [...document.querySelectorAll(".pc-dir-check:checked")].map(c => c.value);
  if (!checked.length) { showToast('请先勾选目录', 'error'); return; }

  const modal = document.createElement('div');
  modal.id = 'md5-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center';
  const items = checked.map((p, i) => ({ p, key: 'idx' + i }));
  modal.innerHTML = '<div style="background:#161d28;border:1px solid #2a3d55;border-radius:14px;padding:28px 32px;min-width:420px;max-width:520px">'
    + '<div style="font-size:1rem;font-weight:700;color:#f0f6ff;margin-bottom:20px">🔑 批量打MD5</div>'
    + '<div id="md5-list">'
    + items.map(({p, key}) =>
        '<div style="margin-bottom:12px">'
        + '<div style="font-size:.78rem;color:#c8dff5;margin-bottom:4px;font-family:monospace">' + p + '</div>'
        + '<div style="height:4px;background:#1e2838;border-radius:99px;overflow:hidden">'
        + '<div id="md5-bar-' + key + '" style="height:100%;width:0%;background:#40d0ff;border-radius:99px;transition:width .3s"></div>'
        + '</div>'
        + '<div id="md5-status-' + key + '" style="font-size:.7rem;color:#507090;margin-top:3px">等待中...</div>'
        + '</div>'
      ).join('')
    + '</div>'
    + '<button id="md5-close" style="display:none;width:100%;padding:10px;border-radius:7px;background:#40d0ff;color:#000;border:none;cursor:pointer;font-weight:700;margin-top:16px">完成</button>'
    + '</div>';
  document.body.appendChild(modal);
  document.getElementById('md5-close').onclick = () => modal.remove();

  for (const {p, key} of items) {
    const statusEl = document.getElementById('md5-status-' + key);
    const barEl    = document.getElementById('md5-bar-' + key);
    if (statusEl) statusEl.textContent = '处理中...';
    if (barEl) barEl.style.width = '30%';
    try {
      const r = await fetch('/api/pc/write-md5', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({path: p})
      });
      const d = await r.json();
      if (d.error) {
        if (statusEl) { statusEl.textContent = '失败: ' + d.error; statusEl.style.color = '#ff5567'; }
        if (barEl)    { barEl.style.width = '100%'; barEl.style.background = '#ff5567'; }
      } else {
        if (statusEl) statusEl.textContent = '已触发，后台处理中...';
        if (barEl) barEl.style.width = '100%';
      }
    } catch(e) {
      if (statusEl) { statusEl.textContent = '失败: ' + e.message; statusEl.style.color = '#ff5567'; }
    }
  }
  document.getElementById('md5-close').style.display = 'block';
}

async function cleanOrphan(btn) {
  const path = btn.dataset.path;
  if (!confirm('清理孤立记录？\n' + path + '\n\n会检查该目录下DB记录对应的PC文件是否还存在，\n删除文件已不存在的记录(连带NAS缩略图)。\n不会删除任何实际文件。')) return;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '检查中...';
  try {
    const r = await fetch('/api/pc/clean-orphan', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({path})
    });
    const d = await r.json();
    if (d.error) showToast('失败: ' + d.error, 'error');
    else showToast('PC端已开始检查，完成后自动清理(看PC窗口进度)', 'success');
  } catch(e) {
    showToast('失败: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.textContent = orig;
}

async function batchCleanOrphan() {
  const checked = [...document.querySelectorAll(".pc-dir-check:checked")].map(c => c.value);
  if (!checked.length) { showToast('请先勾选目录', 'error'); return; }
  if (!confirm(`清理孤立记录？\n选中 ${checked.length} 个目录\n\n检查DB记录对应的PC文件是否存在，删除文件已不存在的记录(连带NAS缩略图)。\n不会删除任何实际文件。`)) return;

  const items = checked.map((p, i) => ({ p, key: 'co' + i }));
  const modal = document.createElement('div');
  modal.id = 'clean-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = '<div style="background:#161d28;border:1px solid #2a3d55;border-radius:14px;padding:28px 32px;min-width:460px;max-width:600px;max-height:80vh;overflow:auto">'
    + '<div style="font-size:1rem;font-weight:700;color:#f0f6ff;margin-bottom:20px">🧹 批量清理孤立记录</div>'
    + '<div id="clean-list">'
    + items.map(({p, key}) =>
        '<div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #1e2838">'
        + '<div style="font-size:.76rem;color:#c8dff5;margin-bottom:6px;font-family:monospace;word-break:break-all">' + p + '</div>'
        + '<div id="clean-status-' + key + '" style="font-size:.74rem;color:#507090">等待中...</div>'
        + '</div>'
      ).join('')
    + '</div>'
    + '<div id="clean-summary" style="display:none;margin-top:8px;padding:12px;background:#1e2838;border-radius:8px;font-size:.82rem;color:#3ddc84"></div>'
    + '<button id="clean-close" disabled style="width:100%;padding:10px;border-radius:7px;background:#2a3d55;color:#507090;border:none;cursor:not-allowed;font-weight:700;margin-top:16px">处理中，请稍候...</button>'
    + '</div>';
  document.body.appendChild(modal);

  let totDb = 0, totOrphan = 0, totDeleted = 0, failCnt = 0;

  for (const {p, key} of items) {
    const statusEl = document.getElementById('clean-status-' + key);
    if (statusEl) { statusEl.textContent = '检查中...'; statusEl.style.color = '#40d0ff'; }
    try {
      const r = await fetch('/api/pc/clean-orphan', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({path: p})
      });
      const d = await r.json();
      if (d.ok) {
        totDb += d.total||0; totOrphan += d.orphan||0; totDeleted += d.deleted||0;
        if (statusEl) {
          statusEl.style.color = (d.deleted > 0) ? '#ffa500' : '#3ddc84';
          statusEl.textContent = `DB记录 ${d.total} 条 · 孤立 ${d.orphan} 条 · 已删除 ${d.deleted} 条`;
        }
      } else {
        failCnt++;
        if (statusEl) { statusEl.style.color = '#ff5567'; statusEl.textContent = '失败: ' + (d.error||'未知'); }
      }
    } catch(e) {
      failCnt++;
      if (statusEl) { statusEl.style.color = '#ff5567'; statusEl.textContent = '失败: ' + e.message; }
    }
  }

  const sum = document.getElementById('clean-summary');
  if (sum) {
    sum.style.display = 'block';
    sum.innerHTML = `✅ 全部完成<br>共检查 ${totDb} 条DB记录，发现孤立 ${totOrphan} 条，已删除 ${totDeleted} 条` + (failCnt ? `<br><span style="color:#ff5567">${failCnt} 个目录失败</span>` : '');
  }
  const btn = document.getElementById('clean-close');
  if (btn) {
    btn.disabled = false;
    btn.textContent = '完成';
    btn.style.cssText = 'width:100%;padding:10px;border-radius:7px;background:#40d0ff;color:#000;border:none;cursor:pointer;font-weight:700;margin-top:16px';
    btn.onclick = () => { modal.remove(); loadPcRoots(); loadPcStats(); };
  }
}

// ── 处理图片（worker进程池，最多5并发） ──────────────
let _processModalTimer = null;

async function processPcDir(btn) {
  const path = btn.dataset.path;
  try {
    const r = await fetch('/api/pc/process-dir', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({path})
    });
    const d = await r.json();
    if (d.error) { showToast('失败: ' + d.error, 'error'); return; }
    showToast(d.status === 'running' ? '已开始处理' : '已加入队列', 'success');
    openProcessModal();
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}

async function batchProcessPc() {
  const checked = [...document.querySelectorAll('.pc-dir-check:checked')].map(c => c.value);
  if (!checked.length) { showToast('请先勾选目录', 'error'); return; }
  for (const path of checked) {
    try {
      await fetch('/api/pc/process-dir', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({path})
      });
    } catch(e) {}
  }
  showToast(`已提交 ${checked.length} 个目录`, 'success');
  openProcessModal();
}

function openProcessModal() {
  if (document.getElementById('process-modal')) return; // 已打开
  const modal = document.createElement('div');
  modal.id = 'process-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = '<div style="background:#161d28;border:1px solid #2a3d55;border-radius:14px;padding:24px 28px;min-width:520px;max-width:680px;max-height:82vh;overflow:auto">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'
    + '<span style="font-size:1rem;font-weight:700;color:#f0f6ff">⚙ 图片处理进度</span>'
    + '<span id="proc-pool-info" style="font-size:.74rem;color:#507090">—</span>'
    + '</div>'
    + '<div id="proc-list" style="font-size:.8rem;color:#507090">加载中...</div>'
    + '<button id="proc-close" style="width:100%;padding:10px;border-radius:7px;background:#40d0ff;color:#000;border:none;cursor:pointer;font-weight:700;margin-top:16px">关闭（后台继续处理）</button>'
    + '</div>';
  document.body.appendChild(modal);
  document.getElementById('proc-close').onclick = () => {
    modal.remove();
    if (_processModalTimer) { clearInterval(_processModalTimer); _processModalTimer = null; }
    loadPcRoots(); loadPcStats();
  };
  refreshProcessModal();
  _processModalTimer = setInterval(refreshProcessModal, 2000);
}

async function refreshProcessModal() {
  const listEl = document.getElementById('proc-list');
  const poolEl = document.getElementById('proc-pool-info');
  if (!listEl) return;
  let status;
  try {
    status = await fetch('/api/pc/worker-status', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());
  } catch(e) { return; }
  if (status.error) { listEl.innerHTML = '<span style="color:#ff5567">'+status.error+'</span>'; return; }

  const running = status.running || [];
  const queued  = status.queued || [];
  if (poolEl) poolEl.textContent = `运行 ${running.length}/${status.max||5} · 排队 ${queued.length}`;

  if (!running.length && !queued.length) {
    listEl.innerHTML = '<div style="color:#3ddc84;padding:8px 0">✅ 没有正在处理的任务</div>';
    return;
  }

  // 拉每个running目录的DB统计
  const rows = [];
  for (const path of running) {
    let st = { total: 0, done: 0 };
    try {
      st = await fetch('/api/pc/dir-children?path=' + encodeURIComponent(path) + '&self=1').then(r=>r.json());
    } catch(e) {}
    const total = st.total||0, done = st.done||0, pending = total-done;
    const pct = total ? Math.round(done/total*100) : 0;
    rows.push(`<div style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #1e2838">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="color:#40d0ff;font-family:monospace;font-size:.74rem;word-break:break-all">▶ ${path}</span>
        <span style="color:#3ddc84;flex-shrink:0;margin-left:8px">${pct}%</span>
      </div>
      <div style="height:5px;background:#1e2838;border-radius:99px;overflow:hidden;margin-bottom:3px">
        <div style="height:100%;width:${pct}%;background:#3ddc84;border-radius:99px;transition:width .4s"></div>
      </div>
      <div style="font-size:.7rem;color:#507090">已处理 ${done} / 待处理 ${pending} · 共 ${total}</div>
    </div>`);
  }
  for (const path of queued) {
    rows.push(`<div style="margin-bottom:8px;color:#ffa500;font-size:.74rem;font-family:monospace">⏳ 排队中: ${path}</div>`);
  }
  listEl.innerHTML = rows.join('');
}

// 显示某目录的错误图片详情
async function showDirErrors(path) {
  const fwd = path.replace(/\\/g, '/').replace(/\/$/, '');
  let rows = [];
  try {
    const q = await fetch('/api/db/query', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ sql: "SELECT p.id, p.path, (SELECT error FROM process_logs WHERE path=p.path ORDER BY created_at DESC LIMIT 1) AS err FROM photos p WHERE REPLACE(p.path,'\\','/') LIKE '" + fwd + "/%' AND p.status='error'" })
    }).then(r=>r.json());
    rows = q.rows || [];
  } catch(e) { showToast('查询失败: ' + e.message, 'error'); return; }

  const modal = document.createElement('div');
  modal.id = 'err-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center';
  const items = rows.map(r => `
    <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #1e2838">
      <div style="font-size:.74rem;color:#c8dff5;font-family:monospace;word-break:break-all;margin-bottom:3px">${r.path}</div>
      <div style="font-size:.7rem;color:#ff5567">${(r.err||'无记录').replace(/</g,'&lt;')}</div>
    </div>`).join('') || '<div style="color:#3ddc84">无错误</div>';

  modal.innerHTML = '<div style="background:#161d28;border:1px solid #2a3d55;border-radius:14px;padding:24px 28px;min-width:520px;max-width:720px;max-height:82vh;overflow:auto">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'
    + '<span style="font-size:1rem;font-weight:700;color:#f0f6ff">❌ 错误图片 (' + rows.length + ')</span>'
    + '<span style="font-size:.72rem;color:#507090;font-family:monospace">' + path + '</span>'
    + '</div>'
    + '<div>' + items + '</div>'
    + '<div style="display:flex;gap:8px;margin-top:16px">'
    + '<button id="err-retry" style="flex:1;padding:10px;border-radius:7px;background:#ffa500;color:#000;border:none;cursor:pointer;font-weight:700">🔄 全部重新处理</button>'
    + '<button id="err-close" style="flex:1;padding:10px;border-radius:7px;background:#2a3d55;color:#c8dff5;border:none;cursor:pointer;font-weight:700">关闭</button>'
    + '</div>'
    + '</div>';
  document.body.appendChild(modal);
  document.getElementById('err-close').onclick = () => modal.remove();
  document.getElementById('err-retry').onclick = async () => {
    if (!rows.length) { modal.remove(); return; }
    const ids = rows.map(r => r.id).join(',');
    const btn = document.getElementById('err-retry');
    btn.disabled = true; btn.textContent = '处理中...';
    try {
      // 1. 重置为pending
      await fetch('/api/db/query', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ sql: "UPDATE photos SET status='pending' WHERE id IN (" + ids + ")" })
      });
      // 2. 直接触发worker处理该目录
      const r = await fetch('/api/pc/process-dir', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ path: path })
      });
      const d = await r.json();
      modal.remove();
      if (d.error) { showToast('已重置但启动失败: ' + d.error, 'error'); }
      else { showToast('已重置 ' + rows.length + ' 张并开始处理', 'success'); openProcessModal(); }
      loadPcRoots();
    } catch(e) { showToast('失败: ' + e.message, 'error'); }
  };
}

// ── PC目录筛选（基于all-dirs） ──────────────────
let _allDirsCache = null;

async function applyPcFilter() {
  const name   = (document.getElementById('pc-filter-name').value || '').trim().toLowerCase();
  const status = document.getElementById('pc-filter-status').value;
  const minCnt = parseInt(document.getElementById('pc-filter-min').value) || 0;
  const countEl = document.getElementById('pc-filter-count');

  if (countEl) countEl.textContent = '加载中...';
  // 拉全量目录（缓存）
  if (!_allDirsCache) {
    try {
      _allDirsCache = await fetch('/api/pc/all-dirs').then(r=>r.json());
    } catch(e) { if (countEl) countEl.textContent = '加载失败'; return; }
  }

  let matched = _allDirsCache.filter(d => {
    if (name && !d.name.toLowerCase().includes(name) && !d.path.toLowerCase().includes(name)) return false;
    if (minCnt && d.total < minCnt) return false;
    if (status === 'pending' && d.pending <= 0) return false;
    if (status === 'error'   && d.error   <= 0) return false;
    if (status === 'done'    && !(d.total > 0 && d.done === d.total)) return false;
    return true;
  });

  // 按总数降序
  matched.sort((a,b) => b.total - a.total);

  const list = document.getElementById('pc-root-list');
  // 保留toolbar（前两个div），替换后面的目录区
  const toolbar = list.querySelector('div'); // 第一个是批量栏
  const filterbar = toolbar ? toolbar.nextElementSibling : null;

  if (countEl) countEl.textContent = `匹配 ${matched.length} 个目录`;

  // 构建平铺结果（带操作按钮，复用renderPcDirRow但不可展开）
  const resultHtml = matched.map(d => `
    <div class="pc-dir-row" data-path="${d.path}" style="border-bottom:1px solid #1a2433">
      <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0">
        <input type="checkbox" class="pc-dir-check" value="${d.path}" style="margin-top:4px;flex-shrink:0">
        <div style="flex:1;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div class="dir-path" style="min-width:0">
            <strong>📁 ${escHtml(d.name)}</strong>
            <small style="color:#507090;margin-left:8px;font-family:monospace;font-size:.7rem">${escHtml(d.path)}</small>
            <div style="font-size:.72rem;margin-top:2px">总${d.total} <span style="color:#3ddc84">✅${d.done}</span> <span style="color:#ffa500">⏳${d.pending}</span>${d.error>0?` <span style="color:#ff5567;cursor:pointer;text-decoration:underline" onclick="showDirErrors('${d.path.replace(/'/g,"\\'")}')">❌${d.error}</span>`:''}</div>
          </div>
          <div class="dir-actions" style="margin-top:0;flex-shrink:0">
            ${pcDirActionButtons(d.path)}
          </div>
        </div>
      </div>
    </div>`).join('') || '<div style="color:#507090;padding:20px;text-align:center">无匹配目录</div>';

  // 找到结果容器（toolbar之后的所有内容），清掉换成结果
  let resultBox = document.getElementById('pc-filter-result');
  if (!resultBox) {
    resultBox = document.createElement('div');
    resultBox.id = 'pc-filter-result';
    list.appendChild(resultBox);
  }
  // 隐藏原始树节点
  [...list.children].forEach(ch => {
    if (ch.classList && ch.classList.contains('pc-dir-row') && ch.id !== 'pc-filter-result') {
      // 这些是根目录树节点，隐藏
    }
  });
  // 简单做法：把树节点都藏起来，只显示结果
  list.querySelectorAll(':scope > .pc-dir-row').forEach(el => el.style.display = 'none');
  resultBox.innerHTML = resultHtml;
  resultBox.style.display = 'block';
}

function clearPcFilter() {
  document.getElementById('pc-filter-name').value = '';
  document.getElementById('pc-filter-status').value = 'all';
  document.getElementById('pc-filter-min').value = '';
  const countEl = document.getElementById('pc-filter-count');
  if (countEl) countEl.textContent = '';
  const resultBox = document.getElementById('pc-filter-result');
  if (resultBox) { resultBox.remove(); }
  const list = document.getElementById('pc-root-list');
  list.querySelectorAll(':scope > .pc-dir-row').forEach(el => el.style.display = '');
  _allDirsCache = null; // 清缓存，下次重新拉
}


async function killAllWorkers() {
  if (!confirm('停止所有正在处理的worker？\n(主服务不受影响，待处理图片保留，可稍后继续)')) return;
  try {
    const r = await fetch('/api/pc/kill-workers', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const d = await r.json();
    if (d.error) showToast('失败: ' + d.error, 'error');
    else showToast('已停止 ' + (d.killed||0) + ' 个处理进程', 'success');
    const pm = document.getElementById('process-modal');
    if (pm) { pm.remove(); if (_processModalTimer) { clearInterval(_processModalTimer); _processModalTimer=null; } }
    loadPcRoots(); loadPcStats();
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}
// ── NAS目录树（复用PC的行渲染+操作函数） ──────────────
let nasTreeWidget = null;
async function loadNasDirs() {
  const list = document.getElementById('dir-list');
  if (!list) return;
  const toolbar = `<div style="display:flex;align-items:center;gap:8px;padding:8px 0 12px;border-bottom:1px solid #2a3d55;margin-bottom:4px;flex-wrap:wrap">
    <button class="btn-sm" style="border-color:#40d0ff;color:#40d0ff" onclick="batchWriteMd5Nas()">🔑 批量打MD5</button>
    <button class="btn-sm" style="border-color:#ffa500;color:#ffa500" onclick="batchCleanOrphanNas()">🧹 批量清理</button>
    <button class="btn-sm" style="border-color:#3ddc84;color:#3ddc84" onclick="batchProcessNas()">⚙ 批量处理</button>
    <button class="btn-sm" style="border-color:#ff5567;color:#ff5567" onclick="killAllWorkers()">⛔ 停止</button>
    <button class="btn-sm" style="margin-left:auto" onclick="loadNasDirs()">🔄 刷新</button>
  </div>
  <div id="nas-tree-mount"></div>`;
  list.innerHTML = toolbar;
  nasTreeWidget = new DirTreeWidget({
    container: 'nas-tree-mount',
    source: 'nas',
    mode: 'batch',
    rootsFn: () => fetch('/api/watch-dirs').then(r=>r.json()).then(ds=>ds.map(d=>({name:d.path.replace(/\/$/,'').split('/').filter(Boolean).pop(), path:d.path}))),
    actions: [
      { label:'打MD5', icon:'🔑', color:'#40d0ff', fn: dtwWriteMd5 },
      { label:'处理', icon:'⚙', color:'#3ddc84', fn: dtwProcess },
    ]
  });
  nasTreeWidget.bind();
  nasTreeWidget.init();
}
// NAS批量操作（读nasTreeWidget勾选）
function batchWriteMd5Nas() { _batchRun(nasTreeWidget, dtwWriteMd5); }
function batchProcessNas() { _batchRun(nasTreeWidget, dtwProcess); }
async function _batchRun(widget, fn) {
  if (!widget) return;
  const checked = widget.getChecked();
  if (!checked.length) { showToast('请先勾选目录', 'error'); return; }
  for (const path of checked) { await fn(path); }
}

// ── PC目录浏览选择器（模态） ──────────────────────────
let _pcBrowseCur = '';

function openPcBrowser() {
  const modal = document.createElement('div');
  modal.id = 'pc-browse-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `<div style="background:#161d28;border:1px solid #2a3d55;border-radius:14px;padding:22px 26px;min-width:520px;max-width:640px;display:flex;flex-direction:column;max-height:78vh">
    <div style="font-size:1rem;font-weight:700;color:#f0f6ff;margin-bottom:14px">📁 选择PC目录</div>
    <div id="pcb-crumb" style="font-size:.76rem;color:#40d0ff;font-family:monospace;padding:8px 10px;background:#0f1620;border-radius:7px;margin-bottom:10px;word-break:break-all;min-height:18px">此电脑</div>
    <div id="pcb-list" style="flex:1;overflow:auto;border:1px solid #2a3d55;border-radius:8px;padding:6px;min-height:240px;max-height:42vh">加载中...</div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:14px">
      <input id="pcb-name" placeholder="目录名称(可选,默认用文件夹名)" style="flex:1;padding:8px 10px;border-radius:7px;border:1px solid #2a3d55;background:#0f1620;color:#c8dff5;font-size:.82rem">
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button id="pcb-up" style="padding:9px 14px;border-radius:7px;background:#1e2838;color:#c8dff5;border:1px solid #2a3d55;cursor:pointer;font-size:.82rem">⬆ 上层</button>
      <button id="pcb-add" style="flex:1;padding:9px;border-radius:7px;background:#3ddc84;color:#000;border:none;cursor:pointer;font-weight:700;font-size:.82rem">✓ 添加当前目录</button>
      <button id="pcb-cancel" style="padding:9px 14px;border-radius:7px;background:#2a3d55;color:#c8dff5;border:none;cursor:pointer;font-size:.82rem">取消</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  document.getElementById('pcb-cancel').onclick = () => modal.remove();
  document.getElementById('pcb-up').onclick = () => {
    if (!_pcBrowseCur) return;
    const fwd = _pcBrowseCur.replace(/\\/g,'/').replace(/\/$/,'');
    const parts = fwd.split('/');
    if (parts.length <= 1) { pcbLoad(''); }  // 回到盘符列表
    else { parts.pop(); pcbLoad(parts.join('/') + (parts.length===1?'/':'')); }
  };
  document.getElementById('pcb-add').onclick = async () => {
    if (!_pcBrowseCur) { showToast('请先进入一个目录', 'error'); return; }
    const fwd = _pcBrowseCur.replace(/\\/g,'/');
    let name = document.getElementById('pcb-name').value.trim();
    if (!name) name = fwd.replace(/\/$/,'').split('/').filter(Boolean).pop();
    try {
      const r = await fetch('/api/pc-roots', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name, path: fwd })
      });
      const d = await r.json();
      if (d.error) { showToast('添加失败: ' + d.error, 'error'); return; }
      showToast('已添加: ' + name, 'success');
      modal.remove();
      loadPcRoots();
    } catch(e) { showToast('失败: ' + e.message, 'error'); }
  };
  pcbLoad('');
}

async function pcbLoad(path) {
  _pcBrowseCur = path;
  const listEl  = document.getElementById('pcb-list');
  const crumbEl = document.getElementById('pcb-crumb');
  if (crumbEl) crumbEl.textContent = path ? path.replace(/\\/g,'/') : '此电脑（选择磁盘）';
  if (listEl) listEl.innerHTML = '加载中...';
  let items = [];
  try {
    const url = '/api/pc/browse' + (path ? ('?path=' + encodeURIComponent(path)) : '');
    items = await fetch(url).then(r=>r.json());
  } catch(e) { if (listEl) listEl.innerHTML = '<span style="color:#ff5567">加载失败</span>'; return; }
  if (items.error) { if (listEl) listEl.innerHTML = '<span style="color:#ff5567">'+items.error+'</span>'; return; }
  const dirs = (Array.isArray(items)?items:[]).filter(it => it.type === 'dir');
  if (!dirs.length) { listEl.innerHTML = '<div style="color:#507090;padding:12px;text-align:center">（无子目录）</div>'; return; }
  listEl.innerHTML = dirs.map(d => `
    <div onclick="pcbLoad('${d.path.replace(/\\/g,'/').replace(/'/g,"\\'")}')"
         style="padding:7px 10px;cursor:pointer;border-radius:6px;display:flex;align-items:center;gap:8px;font-size:.82rem;color:#c8dff5"
         onmouseover="this.style.background='#1e2838'" onmouseout="this.style.background='transparent'">
      <span>${path?'📁':'💽'}</span><span style="word-break:break-all">${escHtml(d.name)}</span>
    </div>`).join('');
}

// ── 迁移模态（选源PC + 选目标NAS + 校验 + 进度，全在一个模态） ──
let _migSrc = '';   // PC源
let _migDst = '';   // NAS目标根
let _migBrowseSide = 'src';  // 当前在选哪边
let _migStatusTimer = null;

function openMigrateModal() {
  _migSrc = ''; _migDst = '';
  const modal = document.createElement('div');
  modal.id = 'mig-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.78);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `<div style="background:#161d28;border:1px solid #2a3d55;border-radius:14px;padding:22px 26px;width:760px;max-width:94vw;display:flex;flex-direction:column;max-height:88vh">
    <div style="font-size:1rem;font-weight:700;color:#f0f6ff;margin-bottom:14px">📦 迁移目录（PC → NAS）</div>
    <div style="display:flex;gap:10px;margin-bottom:12px">
      <div style="flex:1;padding:10px;background:#0f1620;border-radius:8px;border:1px solid #2a3d55">
        <div style="font-size:.7rem;color:#507090;margin-bottom:4px">源（PC）</div>
        <div id="mig-src-show" style="font-size:.78rem;color:#40d0ff;font-family:monospace;word-break:break-all;min-height:18px">点左侧文件夹名选择</div>
      </div>
      <div style="flex:1;padding:10px;background:#0f1620;border-radius:8px;border:1px solid #2a3d55">
        <div style="font-size:.7rem;color:#507090;margin-bottom:4px">目标（NAS）</div>
        <div id="mig-dst-show" style="font-size:.78rem;color:#3ddc84;font-family:monospace;word-break:break-all;min-height:18px">点右侧文件夹名选择</div>
      </div>
    </div>
    <div style="display:flex;gap:12px;flex:1;min-height:0">
      <div style="flex:1;display:flex;flex-direction:column;min-height:0">
        <div style="font-size:.74rem;color:#40d0ff;margin-bottom:4px;font-weight:700">PC目录（已添加）</div>
        <div id="mig-tree-src" style="flex:1;overflow:auto;border:1px solid #2a3d55;border-radius:8px;padding:6px;min-height:240px"></div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;min-height:0">
        <div style="font-size:.74rem;color:#3ddc84;margin-bottom:4px;font-weight:700">NAS目录</div>
        <div id="mig-tree-dst" style="flex:1;overflow:auto;border:1px solid #2a3d55;border-radius:8px;padding:6px;min-height:240px"></div>
      </div>
    </div>
    <div id="mig-check-result" style="margin-top:8px;font-size:.78rem;max-height:80px;overflow-y:auto"></div>
    <div id="mig-pipeline-log" style="margin-top:4px;max-height:120px;overflow-y:auto;font-size:.78rem"></div>
    <div style="display:flex;gap:8px;margin-top:14px;align-items:center">
      <button onclick="migToggleAll(true)" class="btn-sm" style="font-size:.72rem">全选</button>
      <button onclick="migToggleAll(false)" class="btn-sm" style="font-size:.72rem">取消</button>
      <button id="mig-go" style="flex:1;padding:9px;border-radius:7px;background:#3ddc84;color:#000;border:none;cursor:pointer;font-weight:700">开始</button>
      <button id="mig-close" class="btn-sm danger">关闭</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  document.getElementById('mig-close').onclick = () => {
    if (_migStatusTimer) { clearInterval(_migStatusTimer); _migStatusTimer = null; }
    modal.remove();
  };
  document.getElementById('mig-go').onclick = () => migStartPipeline();
  migTreeInit('src');
  migTreeInit('dst');
}

// 初始化树根：src=已添加的pc-roots，dst=/share
async function migTreeInit(side) {
  const box = document.getElementById('mig-tree-' + side);
  box.innerHTML = '加载中...';
  let roots = [];
  try {
    if (side === 'src') {
      const r = await fetch('/api/pc-roots').then(r=>r.json());
      roots = r.map(d => ({ name: d.name, path: d.path }));
    } else {
      const r = await fetch('/api/nas/ls?path=/share').then(r=>r.json());
      roots = (r.dirs||[]);
    }
  } catch(e) { box.innerHTML = '<span style="color:#ff5567">加载失败</span>'; return; }
  if (!roots.length) { box.innerHTML = '<div style="color:#507090;padding:12px">（空）</div>'; return; }
  box.innerHTML = roots.map(r => migNodeHtml(r, 0, side)).join('');
}

function migNodeHtml(node, depth, side) {
  const fwd = node.path.replace(/\\/g,'/');
  const nid = 'mig_' + side + '_' + btoa(unescape(encodeURIComponent(fwd))).replace(/[^a-zA-Z0-9]/g,'');
  let guides = '';
  for (let i=0;i<depth;i++) guides += '<span class="pc-guide"></span>';
  const esc = fwd.replace(/'/g,"\\'");
  return `<div class="mig-node">
    <div style="display:flex;align-items:center;gap:4px;padding:4px 0">
      ${guides}
      <span class="pc-toggle" onclick="migToggle('${esc}','${side}','${nid}',${depth})" data-loaded="0" id="${nid}_tg">+</span>
      ${side==='src'?'<input type="checkbox" class="mig-src-check" value="'+esc+'" style="flex-shrink:0;cursor:pointer;width:14px;height:14px">':''}
      <span onclick="${side==='src'?'migSrcToggleCheck(event,\''+esc+'\')':"migSelect('"+esc+"','"+side+"')"}" oncontextmenu="${side==='dst'?'migCtxMenu(event,\''+esc+'\',\''+nid+'\','+depth+');return false;':''}" style="cursor:pointer;font-size:.82rem;color:#c8dff5;flex:1;word-break:break-all" id="${nid}_nm">${depth===0?(side==='src'?'💻':'🗄'):'📁'} ${escHtml(node.name)}</span>
      <button class="btn-sm" onclick="migRowRefresh('${esc}','${side}','${nid}',${depth})" title="刷新此目录" style="padding:2px 6px;font-size:.7rem">🔄</button>
    </div>
    <div class="mig-children" id="${nid}_ch" style="display:none"></div>
  </div>`;
}

// 点目录名切换checkbox
function migSrcToggleCheck(e, path) {
  const checks = document.querySelectorAll('#mig-tree-src .mig-src-check');
  for (const cb of checks) {
    if (cb.value === path) { cb.checked = !cb.checked; break; }
  }
}

// 获取源树所有勾选路径
function migGetChecked() {
  return [...document.querySelectorAll('#mig-tree-src .mig-src-check:checked')].map(c => c.value);
}

// 全选/取消全选
function migToggleAll(checked) {
  document.querySelectorAll('#mig-tree-src .mig-src-check').forEach(c => c.checked = checked);
}

// 批量校验
async function migBatchCheck() {
  const srcs = migGetChecked();
  if (!srcs.length) { showToast('请先勾选要迁移的目录', 'error'); return; }
  if (!_migDst) { showToast('请先选择目标目录', 'error'); return; }
  const resultEl = document.getElementById('mig-check-result');
  resultEl.innerHTML = '<span style="color:#507090">校验中...</span>';
  let html = '';
  let allOk = true;
  for (const src of srcs) {
    try {
      const r = await fetch('/api/nas-migrate-check', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ srcPath: src, dstRoot: _migDst })
      }).then(r=>r.json());
      if (!r.ok) {
        html += `<div style="color:#ff5567">❌ ${src.split('/').pop()} — ${r.error}</div>`;
        allOk = false;
      } else if (r.hasConflict) {
        html += `<div style="color:#ffa500">⚠️ ${src.split('/').pop()} — 目标已存在同名目录</div>`;
        allOk = false;
      } else {
        html += `<div style="color:#3ddc84">✅ ${src.split('/').pop()} — 共${r.total||0}个文件，无冲突</div>`;
      }
    } catch(e) {
      html += `<div style="color:#ff5567">❌ ${src.split('/').pop()} — ${e.message}</div>`;
      allOk = false;
    }
  }
  resultEl.innerHTML = html;
  // 校验全通过才启用迁移按钮
  const goBtn = document.getElementById('mig-go');
  if (goBtn) { goBtn.disabled = !allOk; goBtn.style.opacity = allOk ? '1' : '0.5'; }
}

// 流水线：校验→迁移→打MD5→处理（逐个目录串行）
async function migStartPipeline() {
  console.log("[pipeline] start", migGetChecked(), _migDst);
  const srcs = migGetChecked();
  if (!srcs.length) { showToast('请先勾选要迁移的目录', 'error'); return; }
  if (!_migDst) { showToast('请先选择目标目录', 'error'); return; }
  const goBtn = document.getElementById('mig-go');
  if (goBtn) goBtn.disabled = true;
  const logEl = document.getElementById('mig-pipeline-log');
  logEl.innerHTML = '';

  // 弹出进度模态
  document.getElementById('mig-progress-modal')?.remove();
  const progModal = document.createElement('div');
  progModal.id = 'mig-progress-modal';
  progModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:10000;display:flex;align-items:center;justify-content:center';
  progModal.innerHTML = `<div style="background:#1e2838;border:1px solid #2a3d55;border-radius:12px;padding:24px 32px;min-width:420px;max-width:560px;width:90%">
    <div style="font-size:1rem;font-weight:700;color:#f0f6ff;margin-bottom:16px">📦 迁移流水线</div>
    <div style="margin-bottom:12px;padding:12px;background:#0f1620;border-radius:8px">
      <div style="font-size:.72rem;color:#507090;margin-bottom:4px">当前任务</div>
      <div id="mprog-cur-name" style="font-size:.88rem;color:#40d0ff;font-weight:700;margin-bottom:6px">初始化...</div>
      <div id="mprog-cur-step" style="font-size:.78rem;color:#c8dff5">等待中</div>
      <div style="margin-top:8px;height:4px;background:#1a2433;border-radius:99px;overflow:hidden">
        <div id="mprog-bar" style="height:100%;width:0%;background:#40d0ff;border-radius:99px;transition:width .3s ease"></div>
      </div>
      <div id="mprog-count" style="font-size:.7rem;color:#507090;margin-top:4px">0 / 0</div>
    </div>
    <div style="font-size:.72rem;color:#507090;margin-bottom:6px">任务列表</div>
    <div id="mprog-list" style="max-height:200px;overflow-y:auto;font-size:.78rem"></div>
  </div>`;
  document.body.appendChild(progModal);

  // 更新进度模态的辅助函数
  const mprogSetCur = (name, step, color='#c8dff5') => {
    const el = document.getElementById('mprog-cur-name');
    const stepEl = document.getElementById('mprog-cur-step');
    if (el) el.textContent = name;
    if (stepEl) { stepEl.textContent = step; stepEl.style.color = color; }
  };
  const mprogSetBar = (cur, total) => {
    const bar = document.getElementById('mprog-bar');
    const cnt = document.getElementById('mprog-count');
    const pct = total > 0 ? Math.round(cur/total*100) : 0;
    if (bar) bar.style.width = pct + '%';
    if (cnt) cnt.textContent = cur + ' / ' + total + ' 个文件';
  };
  const mprogAddItem = (name, status, color) => {
    const list = document.getElementById('mprog-list');
    if (!list) return;
    const id = 'mprog-item-' + btoa(unescape(encodeURIComponent(name))).replace(/[^a-zA-Z0-9]/g,'').slice(0,16);
    const existing = document.getElementById(id);
    if (existing) { existing.innerHTML = `<span style="color:${color}">${status}</span> ${name}`; return; }
    const div = document.createElement('div');
    div.id = id;
    div.style.cssText = 'padding:4px 0;border-bottom:1px solid #1a2433';
    div.innerHTML = `<span style="color:${color}">${status}</span> ${name}`;
    list.appendChild(div);
  };

  for (const src of srcs) {
    const name = src.split('/').pop();
    const dst = _migDst + '/' + name;
    const lineId = 'mig-line-' + btoa(unescape(encodeURIComponent(src))).replace(/[^a-zA-Z0-9]/g,'').slice(0,16);
    logEl.innerHTML += `<div id="${lineId}" style="padding:4px 0;border-bottom:1px solid #1a2433;font-size:.8rem">
      <span style="color:#c8dff5">📁 ${name}</span>
      <span id="${lineId}_status" style="margin-left:8px;color:#507090">等待中...</span>
    </div>`;

    const setStatus = (msg, color='#507090') => {
      const el = document.getElementById(lineId + '_status');
      if (el) el.innerHTML = `<span style="color:${color}">${msg}</span>`;
    };

    // Step0: 校验
    const isPcSrc = /^[A-Za-z]:/.test(src);
    mprogSetCur(name, '🔍 校验中...', '#507090'); mprogAddItem(name, '⏳', '#507090');
    setStatus('🔍 校验中...', '#507090');
    try {
      const checkApi = isPcSrc ? '/api/pc/migrate-check' : '/api/nas-migrate-check';
      const chk = await fetch(checkApi, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ srcPath: src, dstRoot: _migDst })
      }).then(r=>r.json());
      if (!chk.ok) { setStatus('❌ 校验失败: ' + chk.error, '#ff5567'); continue; }
      if (chk.hasConflict) { setStatus('⚠️ 冲突: ' + chk.conflictReason, '#ffa500'); continue; }
      setStatus('✅ 校验通过 共' + (chk.total||0) + '个文件', '#3ddc84'); mprogSetBar(0, chk.total||0);
    } catch(e) { setStatus('❌ 校验异常: ' + e.message, '#ff5567'); continue; }

    // Step1: 迁移
    setStatus('📦 迁移中...', '#40d0ff');
    try {
      if (isPcSrc) {
        // PC→NAS：启动后轮询等完成，确保串行
        setStatus('📦 启动迁移...', '#40d0ff');
        const startR = await fetch('/api/pc/migrate', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ srcPath: src, dstRoot: _migDst })
        }).then(r=>r.json());
        if (!startR.ok) throw new Error(startR.error || '迁移失败');
        // 轮询直到done
        await new Promise((resolve, reject) => {
          const poll = setInterval(async () => {
            try {
              const st = await fetch('/api/pc/migrate-status', {
                method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'
              }).then(r=>r.json());
              if (st.error) { clearInterval(poll); reject(new Error(st.error)); return; }
              if (st.done) { clearInterval(poll); setTimeout(resolve, 800); return; }
              setStatus('📦 迁移中... ' + (st.copied||0) + '/' + (st.total||0), '#40d0ff'); mprogSetCur(name, '📦 迁移中... ' + (st.copied||0) + '/' + (st.total||0), '#40d0ff'); mprogSetBar(st.copied||0, st.total||0);
            } catch(e) { clearInterval(poll); reject(e); }
          }, 1500);
        });
      } else {
        // NAS→NAS：直接mv
        const r = await fetch('/api/nas-migrate', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ srcPath: src, dstRoot: _migDst })
        }).then(r=>r.json());
        if (!r.ok) throw new Error(r.error || '迁移失败');
      }
      setStatus('✅ 迁移完成', '#3ddc84'); mprogSetCur(name, '✅ 迁移完成', '#3ddc84');
    } catch(e) {
      setStatus('❌ 迁移失败: ' + e.message, '#ff5567');
      await fetch('/api/migrate-failures', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify([{ src_path:src, dst_path:dst, error:e.message, migrate_batch:'pipeline_'+Date.now(), step:'migrate' }])
      }).catch(()=>{});
      continue; // 迁移失败跳到下一个
    }

    // Step2: 打MD5
    setStatus('🔑 打MD5中...', '#ffa500'); mprogSetCur(name, '🔑 打MD5中...', '#ffa500');
    try {
      const r = await fetch('/api/pc/write-md5', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ path: dst })
      }).then(r=>r.json());
      if (r.error) throw new Error(r.error);
      setStatus('✅ MD5完成', '#3ddc84'); mprogSetCur(name, '✅ MD5完成', '#3ddc84');
    } catch(e) {
      setStatus('⚠️ MD5失败: ' + e.message + ' (已迁移)', '#ffa500');
      await fetch('/api/migrate-failures', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify([{ src_path:src, dst_path:dst, error:e.message, migrate_batch:'pipeline_'+Date.now(), step:'md5' }])
      }).catch(()=>{});
      continue;
    }

    // Step3: 处理
    setStatus('⚙️ 处理中...', '#a78bfa'); mprogSetCur(name, '⚙️ 处理中...', '#a78bfa');
    try {
      const r = await fetch('/api/pc/process-dir', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ path: dst })
      }).then(r=>r.json());
      if (r.error) throw new Error(r.error);
      setStatus('✅ 全部完成', '#3ddc84'); mprogSetCur(name, '✅ 全部完成', '#3ddc84'); mprogAddItem(name, '✅', '#3ddc84');
    } catch(e) {
      setStatus('⚠️ 处理失败: ' + e.message + ' (已迁移+MD5)', '#ffa500');
      await fetch('/api/migrate-failures', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify([{ src_path:src, dst_path:dst, error:e.message, migrate_batch:'pipeline_'+Date.now(), step:'process' }])
      }).catch(()=>{});
    }
  }

  if (goBtn) goBtn.disabled = false;
  refreshMigFailCount();
  loadPcRoots();
  if (window.nasTreeWidget) nasTreeWidget.refresh();
  // 关闭进度模态，显示完成
  const pm = document.getElementById('mig-progress-modal');
  if (pm) {
    const curStep = pm.querySelector('#mprog-cur-step');
    if (curStep) { curStep.textContent = '✅ 全部完成'; curStep.style.color = '#3ddc84'; }
    const bar = pm.querySelector('#mprog-bar');
    if (bar) { bar.style.width = '100%'; bar.style.background = '#3ddc84'; }
    setTimeout(() => pm.remove(), 2000);
  }
  showToast('流水线执行完成', 'success');
}

// 强制刷新单个节点(不管loaded状态,重新拉取子目录)
async function migRowRefresh(path, side, nid, depth) {
  const tg = document.getElementById(nid + '_tg');
  const ch = document.getElementById(nid + '_ch');
  if (!tg || !ch) return;
  tg.textContent = '\u00b7';
  let items = [];
  try {
    if (side === 'src') {
      const r = await fetch('/api/pc/browse?path=' + encodeURIComponent(path)).then(r=>r.json());
      items = (Array.isArray(r)?r:[]).filter(it => it.type === 'dir').map(d=>({name:d.name,path:d.path}));
    } else {
      const r = await fetch('/api/nas/ls?path=' + encodeURIComponent(path)).then(r=>r.json());
      items = (r.dirs||[]);
    }
  } catch(e) {}
  ch.innerHTML = items.length
    ? items.map(d => migNodeHtml(d, depth+1, side)).join('')
    : '<div style="color:#507090;font-size:.7rem;padding:2px 0 2px ' + ((depth+1)*18) + 'px">（无子目录）</div>';
  ch.style.display = 'block';
  tg.dataset.loaded = '1';
  tg.textContent = '\u2212';
}

async function migToggle(path, side, nid, depth) {
  const tg = document.getElementById(nid + '_tg');
  const ch = document.getElementById(nid + '_ch');
  if (!ch) return;
  if (ch.style.display === 'none') {
    if (tg.dataset.loaded === '0') {
      tg.textContent = '\u00b7';
      let dirs = [];
      try {
        if (side === 'src') {
          const items = await fetch('/api/pc/browse?path=' + encodeURIComponent(path)).then(r=>r.json());
          dirs = (Array.isArray(items)?items:[]).filter(it => it.type === 'dir').map(d=>({name:d.name,path:d.path}));
        } else {
          const r = await fetch('/api/nas/ls?path=' + encodeURIComponent(path)).then(r=>r.json());
          dirs = (r.dirs||[]);
        }
      } catch(e) {}
      ch.innerHTML = dirs.length
        ? dirs.map(d => migNodeHtml(d, depth+1, side)).join('')
        : '<div style="color:#507090;font-size:.7rem;padding:2px 0 2px ' + ((depth+1)*18) + 'px">（无子目录）</div>';
      tg.dataset.loaded = '1';
    }
    ch.style.display = 'block';
    tg.textContent = '\u2212';
  } else {
    ch.style.display = 'none';
    tg.textContent = '+';
  }
}

function migSelect(path, side) {
  const fwd = path.replace(/\\/g,'/');
  if (side === 'src') {
    _migSrc = fwd;
    document.getElementById('mig-src-show').textContent = fwd;
  } else {
    _migDst = fwd;
    document.getElementById('mig-dst-show').textContent = fwd;
  }
  document.querySelectorAll('#mig-tree-' + side + ' [id$="_nm"]').forEach(el => el.style.background='transparent');
  const nid = 'mig_' + side + '_' + btoa(unescape(encodeURIComponent(fwd))).replace(/[^a-zA-Z0-9]/g,'');
  const nm = document.getElementById(nid + '_nm');
  if (nm) nm.style.background = (side==='src'?'rgba(64,208,255,.2)':'rgba(61,220,132,.2)');
}

async function migGo() {
  if (!_migSrc) { showToast('请先选源(PC)目录', 'error'); return; }
  if (!_migDst) { showToast('请先选目标(NAS)目录', 'error'); return; }
  const prog = document.getElementById('mig-progress');
  const goBtn = document.getElementById('mig-go');
  prog.style.display = 'block';
  prog.innerHTML = '<div style="color:#40d0ff">⏳ 校验中（检查同名文件冲突）...</div>';
  goBtn.disabled = true;

  // 1. 校验
  let chk;
  try {
    chk = await fetch('/api/pc/migrate-check', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ srcPath: _migSrc, dstRoot: _migDst })
    }).then(r=>r.json());
  } catch(e) { prog.innerHTML = '<span style="color:#ff5567">校验失败: '+e.message+'</span>'; goBtn.disabled=false; return; }

  if (chk.error) { prog.innerHTML = '<span style="color:#ff5567">校验失败: '+chk.error+'</span>'; goBtn.disabled=false; return; }

  if (chk.hasConflict) {
    // 有冲突，显示列表，停止
    prog.innerHTML = `<div style="color:#ff5567;font-weight:700;margin-bottom:8px">⚠ 发现 ${chk.conflictCount} 个同名文件冲突，已停止迁移</div>
      <div style="color:#507090;font-size:.74rem;margin-bottom:6px">目标位置已存在这些文件，请先处理后再迁移：</div>
      <div style="max-height:160px;overflow:auto;font-size:.72rem;font-family:monospace;color:#c8dff5">
        ${chk.conflicts.map(f => '<div style="padding:2px 0">'+escHtml(f)+'</div>').join('')}
        ${chk.conflictCount > chk.conflicts.length ? '<div style="color:#507090">...还有更多</div>':''}
      </div>`;
    goBtn.disabled = false;
    return;
  }

  // 2. 无冲突，确认后迁移
  if (!confirm(`校验通过，共 ${chk.total} 个文件，无冲突。\n确认迁移到 ${chk.dstRoot}？`)) { goBtn.disabled=false; return; }

  prog.innerHTML = '<div style="color:#40d0ff">🚀 开始迁移...</div>';
  try {
    const r = await fetch('/api/pc/migrate', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ srcPath: _migSrc, dstRoot: _migDst })
    }).then(r=>r.json());
    if (r.error) { prog.innerHTML = '<span style="color:#ff5567">启动失败: '+r.error+'</span>'; goBtn.disabled=false; return; }
  } catch(e) { prog.innerHTML = '<span style="color:#ff5567">启动失败: '+e.message+'</span>'; goBtn.disabled=false; return; }

  // 3. 轮询进度
  _migStatusTimer = setInterval(migRefreshProgress, 1500);
  migRefreshProgress();
}

async function migRefreshProgress() {
  const prog = document.getElementById('mig-progress');
  if (!prog) { if(_migStatusTimer){clearInterval(_migStatusTimer);_migStatusTimer=null;} return; }
  let st;
  try {
    st = await fetch('/api/pc/migrate-status', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());
  } catch(e) { return; }
  if (st.error) { prog.innerHTML = '<span style="color:#ff5567">'+st.error+'</span>'; return; }

  const total = st.total||0, copied = st.copied||0, skipped = st.skipped||0, failed = st.failed||0;
  const handled = copied + skipped + failed;
  const pct = total ? Math.round(handled/total*100) : 0;

  prog.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:6px">
      <span style="color:#c8dff5;font-size:.82rem;font-weight:700">${st.done?'✅ 迁移完成':'📦 迁移中...'}</span>
      <span style="color:#3ddc84">${pct}%</span>
    </div>
    <div style="height:6px;background:#1e2838;border-radius:99px;overflow:hidden;margin-bottom:8px">
      <div style="height:100%;width:${pct}%;background:#3ddc84;border-radius:99px;transition:width .4s"></div>
    </div>
    <div style="font-size:.74rem;color:#507090;line-height:1.7">
      共 ${total} · <span style="color:#3ddc84">已复制 ${copied}</span> · <span style="color:#ffa500">跳过 ${skipped}</span> · <span style="color:#ff5567">失败 ${failed}</span><br>
      ${st.cur ? '当前: <span style="font-family:monospace;color:#c8dff5">'+escHtml(st.cur)+'</span>' : ''}
    </div>`;

  if (st.done) {
    if (_migStatusTimer) { clearInterval(_migStatusTimer); _migStatusTimer=null; }
    const goBtn = document.getElementById('mig-go');
    if (goBtn) goBtn.disabled = false;
    loadPcRoots();
    refreshMigFailCount();
    // 整树重建 + 自动展开到迁移目标,确保新文件夹一定能看到
    if (window.nasTreeWidget && st.dst) {
      const targetPath = st.dst.replace(/\\/g,'/');
      nasTreeWidget.refresh();
      setTimeout(() => expandToPath(nasTreeWidget, targetPath), 600); // 等init的fetch完成
    }
  }
}

// 整树重建后,沿路径逐层自动展开,直到目标路径
async function expandToPath(widget, targetPath) {
  const parts = targetPath.replace(/^\//,'').split('/').filter(Boolean);
  let cur = '';
  for (let i = 0; i < parts.length; i++) {
    cur = cur ? cur + '/' + parts[i] : '/' + parts[i];
    const nid = widget._nid(cur);
    const tg = document.getElementById(nid + '_tg');
    if (!tg) break; // 这一层还没渲染出来(可能根列表里没有这条),停止往下展开
    if (tg.dataset.loaded === '0') {
      await widget._toggle(tg); // 展开这一层
    } else {
      // 已加载过,确保是展开状态
      const ch = document.getElementById(nid + '_ch');
      if (ch && ch.style.display === 'none') await widget._toggle(tg);
    }
  }
  // 高亮滚动到最终目标节点
  const finalNid = widget._nid(targetPath);
  const finalRow = document.querySelector('[data-path="' + targetPath.replace(/"/g,'\\"') + '"] .dtw-row');
  if (finalRow) {
    finalRow.scrollIntoView({behavior:'smooth', block:'center'});
    finalRow.style.background = 'rgba(61,220,132,.15)';
    setTimeout(() => { finalRow.style.background = ''; }, 2000);
  }
}


// ── 迁移失败管理 ─────────────────────────────────────
async function refreshMigFailCount() {
  try {
    const r = await fetch('/api/migrate-failures/count').then(r=>r.json());
    const btn = document.getElementById('mig-fail-btn');
    const span = document.getElementById('mig-fail-count');
    if (!btn || !span) return;
    if (r.count > 0) {
      span.textContent = r.count;
      btn.style.display = '';
    } else {
      btn.style.display = 'none';
    }
  } catch(e) {}
}

async function openMigrateFailuresModal() {
  const modal = document.createElement('div');
  modal.id = 'mig-fail-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.78);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `<div style="background:#161d28;border:1px solid #2a3d55;border-radius:14px;padding:22px 26px;width:820px;max-width:94vw;max-height:88vh;display:flex;flex-direction:column">
    <div style="font-size:1rem;font-weight:700;color:#f0f6ff;margin-bottom:14px">⚠️ 迁移失败记录</div>
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #2a3d55;margin-bottom:8px">
      <input type="checkbox" id="mf-check-all" onclick="mfToggleAll(this)">
      <span style="font-size:.78rem;color:#507090">全选</span>
      <button class="btn-sm" style="border-color:#ffa500;color:#ffa500" onclick="mfBatchRetry()">🔄 批量重试</button>
      <button class="btn-sm" style="border-color:#ff5567;color:#ff5567" onclick="mfBatchDiscard()">🗑 批量放弃</button>
      <button class="btn-sm" style="margin-left:auto" onclick="mfLoadList()">🔄 刷新</button>
    </div>
    <div id="mf-list" style="flex:1;overflow:auto;font-size:.8rem">加载中...</div>
    <button id="mf-close" style="width:100%;padding:10px;border-radius:7px;background:#2a3d55;color:#c8dff5;border:none;cursor:pointer;font-weight:700;margin-top:14px">关闭</button>
  </div>`;
  document.body.appendChild(modal);
  document.getElementById('mf-close').onclick = () => { modal.remove(); refreshMigFailCount(); loadPcRoots(); };
  mfLoadList();
}

async function mfLoadList() {
  const list = document.getElementById('mf-list');
  if (!list) return;
  list.innerHTML = '加载中...';
  let rows = [];
  try { rows = await fetch('/api/migrate-failures?status=pending').then(r=>r.json()); }
  catch(e) { list.innerHTML = '<span style="color:#ff5567">加载失败</span>'; return; }
  if (!rows.length) {
    // 看有没有retried的(已重试待确认)
    let retried = [];
    try { retried = await fetch('/api/migrate-failures?status=retried').then(r=>r.json()); } catch(e) {}
    if (!retried.length) { list.innerHTML = '<div style="color:#3ddc84;padding:20px;text-align:center">✅ 暂无失败记录</div>'; return; }
    rows = retried;
  } else {
    // 同时拉retried显示在下面
    try {
      const retried = await fetch('/api/migrate-failures?status=retried').then(r=>r.json());
      rows = rows.concat(retried);
    } catch(e) {}
  }
  list.innerHTML = rows.map(r => mfRowHtml(r)).join('');
}

function mfRowHtml(r) {
  const statusColor = r.status === 'pending' ? '#ff5567' : '#3ddc84';
  const statusText = r.status === 'pending' ? '⏳ 待处理' : '✓ 已重试成功';
  const actions = r.status === 'pending'
    ? `<button class="btn-sm" style="border-color:#ffa500;color:#ffa500" onclick="mfRetry(${r.id})">🔄 重试</button>
       <button class="btn-sm danger" onclick="mfDiscard(${r.id})">🗑 放弃</button>`
    : `<button class="btn-sm" style="border-color:#3ddc84;color:#3ddc84" onclick="mfConfirm(${r.id})">✅ 确认完结</button>
       <button class="btn-sm" onclick="mfReset(${r.id})">↶ 重置</button>`;
  return `<div class="mf-row" data-id="${r.id}" style="border-bottom:1px solid #1e2838;padding:10px 0">
    <div style="display:flex;align-items:flex-start;gap:8px">
      <input type="checkbox" class="mf-check" value="${r.id}" style="margin-top:4px">
      <div style="flex:1;min-width:0">
        <div style="font-size:.74rem;color:#c8dff5;font-family:monospace;word-break:break-all">📂 ${escHtml(r.src_path)}</div>
        <div style="font-size:.72rem;color:#40d0ff;font-family:monospace;word-break:break-all">→ ${escHtml(r.dst_path)}</div>
        <div style="font-size:.7rem;color:#ff5567;margin-top:3px">${escHtml(r.error || '无原因')}</div>
        <div style="font-size:.68rem;color:#507090;margin-top:2px">批次: ${r.migrate_batch} · 状态: <span style="color:${statusColor}">${statusText}</span></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">${actions}</div>
    </div>
  </div>`;
}

function mfToggleAll(cb) {
  document.querySelectorAll('#mf-list .mf-check').forEach(c => c.checked = cb.checked);
}

async function mfRetry(id) {
  try {
    const r = await fetch('/api/pc/migrate-retry', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}).then(r=>r.json());
    if (r.error) showToast('重试失败: ' + r.error, 'error');
    else if (r.success) showToast('重试成功，请确认完结', 'success');
    else showToast('重试又失败: ' + (r.newError || '未知'), 'error');
    mfLoadList();
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}

async function mfConfirm(id) {
  if (!confirm('确认完结：更新DB路径并标记resolved？')) return;
  try {
    const r = await fetch('/api/pc/migrate-confirm', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}).then(r=>r.json());
    if (r.error) showToast('失败: ' + r.error, 'error');
    else showToast('已完结', 'success');
    mfLoadList();
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}

async function mfDiscard(id) {
  if (!confirm('放弃这条记录？将从表中删除')) return;
  try {
    await fetch('/api/migrate-failures/delete', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[id]})});
    showToast('已放弃', 'success');
    mfLoadList();
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}

async function mfReset(id) {
  try {
    await fetch('/api/migrate-failures/update', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id, status:'pending'})});
    mfLoadList();
  } catch(e) {}
}

async function mfBatchRetry() {
  const ids = [...document.querySelectorAll('#mf-list .mf-check:checked')].map(c => parseInt(c.value));
  if (!ids.length) { showToast('请先勾选', 'error'); return; }
  for (const id of ids) {
    try { await fetch('/api/pc/migrate-retry', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); } catch(e) {}
  }
  showToast(`批量重试完成 ${ids.length} 条`, 'success');
  mfLoadList();
}

async function mfBatchDiscard() {
  const ids = [...document.querySelectorAll('#mf-list .mf-check:checked')].map(c => parseInt(c.value));
  if (!ids.length) { showToast('请先勾选', 'error'); return; }
  if (!confirm(`批量放弃 ${ids.length} 条记录？`)) return;
  await fetch('/api/migrate-failures/delete', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});
  showToast('已放弃', 'success');
  mfLoadList();
}


// ── NAS迁移目标树右键菜单 ─────────────────────────
function migCtxMenu(e, path, nid, depth) {
  e.preventDefault();
  // 移除已有菜单
  document.querySelectorAll('.mig-ctx-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'mig-ctx-menu';
  menu.style.cssText = `position:fixed;top:${e.clientY}px;left:${e.clientX}px;background:#1e2838;border:1px solid #2a3d55;border-radius:8px;padding:4px 0;z-index:99999;min-width:150px;box-shadow:0 4px 16px rgba(0,0,0,.5)`;
  menu.innerHTML = `
    <div class="mig-ctx-item" onclick="migMkdir('${path.replace(/'/g,"\\'")}','${nid}',${depth})" style="padding:8px 16px;cursor:pointer;font-size:.82rem;color:#c8dff5" onmouseover="this.style.background='#2a3d55'" onmouseout="this.style.background='transparent'">📁 新建文件夹</div>
    <div style="border-top:1px solid #2a3d55;margin:4px 0"></div>
    <div class="mig-ctx-item" onclick="migRename('${path.replace(/'/g,"\\'")}','${nid}',${depth})" style="padding:8px 16px;cursor:pointer;font-size:.82rem;color:#ffa500" onmouseover="this.style.background='#2a3d55'" onmouseout="this.style.background='transparent'">✏️ 重命名</div>
    <div style="border-top:1px solid #2a3d55;margin:4px 0"></div>
    <div class="mig-ctx-item" onclick="migDeleteDir('${path.replace(/'/g,"\\'")}','${nid}',${depth})" style="padding:8px 16px;cursor:pointer;font-size:.82rem;color:#ff5567" onmouseover="this.style.background='#2a3d55'" onmouseout="this.style.background='transparent'">🗑 删除此目录</div>
  `;
  document.body.appendChild(menu);
  // 点其他地方关闭
  const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 10);
}

async function migMkdir(parentPath, nid, depth) {
  document.querySelectorAll('.mig-ctx-menu').forEach(el => el.remove());
  const name = prompt('新文件夹名称：');
  if (!name || !name.trim()) return;
  try {
    const r = await fetch('/api/nas-dir/mkdir', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ parentPath, name: name.trim() })
    }).then(r=>r.json());
    if (r.error) { showToast('创建失败: ' + r.error, 'error'); return; }
    showToast('✅ 已创建: ' + name.trim(), 'success');
    // 刷新这个节点的子目录
    migRowRefresh(parentPath, 'dst', nid, depth);
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}

async function migDeleteDir(path, nid, depth) {
  document.querySelectorAll('.mig-ctx-menu').forEach(el => el.remove());
  // 先查询内容数量
  try {
    const r = await fetch('/api/nas-dir/delete', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ path })
    }).then(r=>r.json());
    if (r.error) { showToast('失败: ' + r.error, 'error'); return; }
    if (r.needConfirm) {
      if (!confirm(`该目录包含 ${r.fileCount} 个文件、${r.dirCount} 个子目录，确定删除？

⚠️ 此操作不可恢复！`)) return;
      // 二次确认后真正删除
      const r2 = await fetch('/api/nas-dir/delete', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ path, confirm: true })
      }).then(r=>r.json());
      if (r2.error) { showToast('删除失败: ' + r2.error, 'error'); return; }
    }
    showToast('✅ 已删除: ' + path.split('/').pop(), 'success');
    // 刷新父节点
    const parts = path.replace(/\/$/,'').split('/').filter(Boolean);
    if (parts.length > 1) {
      const parentPath = '/' + parts.slice(0,-1).join('/');
      const parentNid = 'mig_dst_' + btoa(unescape(encodeURIComponent(parentPath))).replace(/[^a-zA-Z0-9]/g,'');
      migRowRefresh(parentPath, 'dst', parentNid, depth - 1);
    }
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}


async function migRename(path, nid, depth) {
  document.querySelectorAll('.mig-ctx-menu').forEach(el => el.remove());
  const oldName = path.replace(/\/$/,'').split('/').filter(Boolean).pop();
  const newName = prompt('重命名为：', oldName);
  if (!newName || !newName.trim() || newName.trim() === oldName) return;
  try {
    const r = await fetch('/api/nas-dir/rename', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ targetPath: path, newName: newName.trim() })
    }).then(r=>r.json());
    if (r.error) { showToast('重命名失败: ' + r.error, 'error'); return; }
    showToast('✅ 已重命名，DB更新' + r.dbUpdated + '条', 'success');
    // 刷新父节点
    const parts = path.replace(/\/$/,'').split('/').filter(Boolean);
    if (parts.length > 1) {
      const parentPath = '/' + parts.slice(0,-1).join('/');
      const parentNid = 'mig_dst_' + btoa(unescape(encodeURIComponent(parentPath))).replace(/[^a-zA-Z0-9]/g,'');
      migRowRefresh(parentPath, 'dst', parentNid, depth - 1);
    }
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}