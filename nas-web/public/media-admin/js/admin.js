let playlists  = [];
let currentPl  = null;
let dispatching = false;
let dispatchTimer = null;

// ── 初始化 ────────────────────────────────────────────
async function init() {
  await Promise.all([loadNasDirs(), loadPlaylists(), loadMusicSettings(), loadBrowserRoots()]);
}

function switchTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('[id^="page-"]').forEach(p => p.style.display = 'none');
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('page-' + tab).style.display = 'block';
  if (tab === 'pc') { loadPcRoots(); }
  if (tab === 'dirs') { loadNasDirs(); }
  if (tab === 'roles') { loadRoles(); }
  if (tab === 'settings') { loadTagVocabStatus(); }
}

function openAddDirBrowser() {
  const browser = new FileBrowser({
    mode:   'dir',
    source: 'nas',
    title:  '选择NAS文件夹',
    onConfirm: async (path) => {
      const name = prompt('给这个文件夹起个名字：', path.replace(/\/$/,'').split('/').filter(Boolean).pop());
      if (!name) return;
      await apiFetch('/api/browser/roots', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, path, source: 'nas' }),
      });
      loadNasDirs();
      if (typeof loadBrowserRoots === 'function') loadBrowserRoots();
      showToast('文件夹已添加', 'success');
    }
  });
  browser.open();
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
        <button class="btn-sm" onclick="event.stopPropagation();renamePlaylist(${p.id})">改名</button>
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
function escHtml(s) { if(s==null)return "";return String(s).replace(/&/g,"\&amp;").replace(/</g,"\&lt;").replace(/>/g,"\&gt;").replace(/"/g,"\&quot;").replace(/'/g,"\&#39;").replace(/\//g,"\&#47;"); }
function escJs(s)   { return String(s).replace(/'/g,"\\'"); }
function showToast(msg, type='success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.style.cssText = 'display:flex;align-items:center;gap:10px;padding-right:10px';
  const span = document.createElement('span');
  span.textContent = msg;
  span.style.flex = '1';
  t.appendChild(span);
  if (type === 'error') {
    // 错误toast不自动消失，加关闭按钮
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.style.cssText = 'background:none;border:none;color:inherit;cursor:pointer;font-size:1rem;padding:0;flex-shrink:0';
    btn.onclick = () => t.remove();
    t.appendChild(btn);
  } else {
    setTimeout(() => t.remove(), 3000);
  }
  document.body.appendChild(t);
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
    <button class="btn-sm" style="border-color:#a78bfa;color:#a78bfa" onclick="cleanCacheModal()">🗑️ 清理遗孤缓存</button>
    <button class="btn-sm" style="border-color:#40d0ff;color:#40d0ff" onclick="showTagProgress()">🏷️ 打标进度</button>
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
  const _pcRoots = dtaMakeRoots('pc');
  pcTreeWidget = new DirTreeWidget({
    container: 'pc-tree-mount',
    source: 'pc',
    mode: 'batch',
    rootsFn: _pcRoots.fn,
    contextMenu: (path) => buildDirContextMenu(pcTreeWidget, 'pc', path, {
      rootSet: _pcRoots.set, rootIdMap: _pcRoots.map
    })
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
    });
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
      const children = await apiFetch('/api/pc/dir-children?path=' + encodeURIComponent(path), {showError:false});
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
  const children = await apiFetch('/api/pc/dir-children?path=' + encodeURIComponent(path), {showError:false});
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
  await apiFetch('/api/pc-roots/' + idx, {
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
  document.getElementById('cfg-sync-port').value    = cfg.sync_port   || 3040;
}

async function saveSysConfig() {
  const cfg = {
    nas_ip:       document.getElementById('cfg-nas-ip').value.trim(),
    nas_smb_host: document.getElementById('cfg-smb-host').value.trim(),
    pipe_port:    parseInt(document.getElementById('cfg-pipe-port').value),
    indexer_port: parseInt(document.getElementById('cfg-indexer-port').value),
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
 } catch(e) { if(typeof showToast==="function")showToast("失败: "+e.message,"error"); }
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
    btn.onclick = () => { modal.remove(); loadPcRoots(); };
  }
}

async function cleanCacheModal() {
  const btn = event.target;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '扫描中...';
  let dry;
  try {
    const r = await fetch('/api/nas/clean-cache', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ dryRun: true })
    });
    dry = await r.json();
  } catch(e) {
    showToast('失败: ' + e.message, 'error');
    btn.disabled = false; btn.textContent = orig;
    return;
  }
  btn.disabled = false; btn.textContent = orig;

  if (dry.skipped) {
    let msg = dry.reason;
    if (dry.mismatches && dry.mismatches.length) {
      msg += '\n' + dry.mismatches.map(m => m.path + ': 磁盘' + m.real + ' / DB' + m.dbTotal).join('\n');
    }
    alert(msg);
    return;
  }
  if (!dry.deleted) {
    showToast(`扫描了 ${dry.scanned} 个缓存文件，没有遗孤`, 'success');
    return;
  }
  if (!confirm(`发现遗孤缓存文件 ${dry.deleted} 个（共 ${dry.freedMB} MB）\n扫描总数 ${dry.scanned}\n\n确认删除？这些是DB里已经没有对应记录的缩略图/预览图。`)) return;

  btn.disabled = true; btn.textContent = '清理中...';
  try {
    const r = await fetch('/api/nas/clean-cache', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({})
    });
    const d = await r.json();
    if (d.skipped) showToast(d.reason, 'error');
    else showToast(`清理完成：删除 ${d.deleted} 个文件，释放 ${d.freedMB} MB`, 'success');
  } catch(e) {
    showToast('失败: ' + e.message, 'error');
  }
  btn.disabled = false; btn.textContent = orig;
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
 } catch(e) { if(typeof showToast==="function")showToast("失败: "+e.message,"error"); }
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
    loadPcRoots(); 
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
    status = await apiFetch('/api/pc/worker-status', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
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
      st = await apiFetch('/api/pc/dir-children?path=' + encodeURIComponent(path) + '&self=1');
 } catch(e) { if(typeof showToast==="function")showToast("失败: "+e.message,"error"); }
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

// 显示某目录的错误详情: 按当前功能筛选栏选中的类型分组查询(不再局限于图片处理一种)
// FEATURE_LABELS 与 error-center.js 里的 FEATURES 保持一致
const FEATURE_LABELS = { photo_process: "图片处理", md5_write: "打MD5", clip_tag: "CLIP打标签", feat_extract: "特征提取", video_shots: "视频抽帧" };

async function showDirErrors(path, singleFeature) {
  const fwd = path.replace(/\\/g, '/').replace(/\/$/, '');
  // 指定了单一功能类型(来自筛选结果列表里点某个具体的 ❌功能名)时只查这一个;
  // 否则按筛选栏当前勾选查(未筛选/全选=全部5种)
  const features = singleFeature ? [singleFeature] :
    ((typeof _nasEnabledFeatures !== 'undefined' && _nasEnabledFeatures) ? _nasEnabledFeatures : Object.keys(FEATURE_LABELS));
  let groups = [];
  let rows = [];   // 兼容旧的"全部重新处理"按钮, 只收集图片处理类的id
  try {
    for (const feat of features) {
      const r = await fetch('/api/errors/list?path=' + encodeURIComponent(fwd) + '&feature=' + feat + '&limit=200').then(r => r.json());
      if (r.items && r.items.length) groups.push({ feature: feat, label: FEATURE_LABELS[feat] || feat, items: r.items });
      if (feat === 'photo_process' && r.items) rows = r.items;
    }
  } catch(e) { showToast('查询失败: ' + e.message, 'error'); return; }

  const modal = document.createElement('div');
  modal.id = 'err-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center';
  const totalCount = groups.reduce((a, g) => a + g.items.length, 0);
  const items = groups.map(g => `
    <div style="margin:14px 0 8px;font-size:.76rem;font-weight:700;color:#ff5567">${g.label} (${g.items.length})</div>
    ${g.items.map(r => `
      <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #1e2838">
        <div style="font-size:.74rem;color:#c8dff5;font-family:monospace;word-break:break-all;margin-bottom:3px">${r.path}</div>
        <div style="font-size:.7rem;color:#ff5567">${(r.error||'无记录').replace(/</g,'&lt;')}</div>
      </div>`).join('')}
  `).join('') || '<div style="color:#3ddc84">无错误</div>';

  modal.innerHTML = '<div style="background:#161d28;border:1px solid #2a3d55;border-radius:14px;padding:24px 28px;min-width:520px;max-width:720px;max-height:82vh;overflow:auto">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'
    + '<span style="font-size:1rem;font-weight:700;color:#f0f6ff">❌ 错误详情 (' + totalCount + ')</span>'
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
      _allDirsCache = await apiFetch('/api/pc/all-dirs');
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
    loadPcRoots(); 
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
    <button class="btn-sm" style="border-color:#a78bfa;color:#a78bfa" onclick="cleanCacheModal()">🗑️ 清理遗孤缓存</button>
    <button class="btn-sm" style="border-color:#40d0ff;color:#40d0ff" onclick="showTagProgress()">🏷️ 打标进度</button>
    <button class="btn-sm" style="border-color:#3ddc84;color:#3ddc84" onclick="batchProcessNas()">⚙ 批量处理</button>
    <button class="btn-sm" style="border-color:#c084fc;color:#c084fc" onclick="batchClipTagNas()">🎨 批量打标签</button>
    <button class="btn-sm" style="border-color:#ff5567;color:#ff5567" onclick="killAllWorkers()">⛔ 停止</button>
    <button class="btn-sm" style="border-color:#ff5567;color:#ff5567" onclick="openErrorListModal()">📋 错误清单</button>
    <span style="width:1px;height:18px;background:#2a3d55;margin:0 2px"></span>
    <button class="btn-sm" style="border-color:#f0f6ff;color:#f0f6ff" onclick="dtwBatchSetCategory(nasTreeWidget,true)">👨‍👩‍👧 标记家庭</button>
    <button class="btn-sm" style="border-color:#ff5fa8;color:#ff5fa8" onclick="dtwBatchSetCategory(nasTreeWidget,false)">🔞 标记成人</button>
    <button class="btn-sm" style="margin-left:auto" onclick="loadNasDirs()">🔄 刷新</button>
  </div>
  <div id="nas-feature-filter" style="display:flex;align-items:center;gap:10px;padding:6px 0 10px;flex-wrap:wrap;font-size:.74rem;color:#8fa8c4">加载功能列表…</div>
  <div style="display:flex;align-items:center;gap:8px;padding:8px 0;flex-wrap:wrap;border-bottom:1px solid #2a3d55;margin-bottom:8px">
    <input id="nas-filter-name" placeholder="目录名关键词" style="padding:5px 8px;border-radius:6px;border:1px solid #2a3d55;background:#0f1620;color:#c8dff5;font-size:.78rem;width:140px">
    <select id="nas-filter-status" style="padding:5px 8px;border-radius:6px;border:1px solid #2a3d55;background:#0f1620;color:#c8dff5;font-size:.78rem">
      <option value="all">全部状态</option>
      <option value="pending">有未处理</option>
      <option value="error">有错误</option>
      <option value="done">已完成</option>
    </select>
    <input id="nas-filter-min" type="number" placeholder="最小张数" style="padding:5px 8px;border-radius:6px;border:1px solid #2a3d55;background:#0f1620;color:#c8dff5;font-size:.78rem;width:90px">
    <button class="btn-sm" style="border-color:#40d0ff;color:#40d0ff" onclick="applyNasFilter()">🔍 筛选</button>
    <button class="btn-sm" onclick="clearNasFilter()">✕ 清空</button>
    <span id="nas-filter-count" style="font-size:.74rem;color:#507090"></span>
  </div>
  <div id="nas-tree-mount"></div>`;
  list.innerHTML = toolbar;
  const _nasRoots = dtaMakeRoots('nas');
  nasTreeWidget = new DirTreeWidget({
    container: 'nas-tree-mount',
    source: 'nas',
    mode: 'batch',
    showFamilyCheck: true,   // 家庭/成人 背景色标注
    showHoverCard: true,     // 悬浮详情卡片(停留1秒显示)
    getEnabledFeatures: () => _nasEnabledFeatures,
    rootsFn: _nasRoots.fn,
    contextMenu: (path) => buildDirContextMenu(nasTreeWidget, 'nas', path, {
      rootSet: _nasRoots.set, rootIdMap: _nasRoots.map
    })
  });
  nasTreeWidget.bind();
  nasTreeWidget.init();
  _loadNasFeatureFilter();
}

// 功能错误筛选栏: 勾选后只在悬浮卡片里显示这些功能的错误统计(不勾选=全部显示)
let _nasEnabledFeatures = null;   // null = 全部
async function _loadNasFeatureFilter() {
  const box = document.getElementById('nas-feature-filter');
  if (!box) return;
  let list = [];
  try { list = await apiFetch('/api/errors/features'); }
  catch (e) { box.textContent = ''; return; }
  if (!Array.isArray(list) || !list.length) { box.textContent = ''; return; }
  box.innerHTML = '<span style="color:#507090">按功能筛选错误显示:</span>' +
    list.map(f => `<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer">
      <input type="checkbox" class="nas-feat-cb" value="${f.key}" checked onchange="_onNasFeatureToggle()">${f.label}</label>`).join('') +
    '<button class="btn-sm" style="padding:2px 8px" onclick="_nasFeatureAll(true)">全选</button>' +
    '<button class="btn-sm" style="padding:2px 8px" onclick="_nasFeatureAll(false)">全不选</button>';
}
function _onNasFeatureToggle() {
  const boxes = Array.from(document.querySelectorAll('.nas-feat-cb'));
  const checked = boxes.filter(b => b.checked).map(b => b.value);
  // 全选或全不选都视为"不筛选"(全部显示), 只有部分勾选时才生效筛选
  _nasEnabledFeatures = (checked.length === 0 || checked.length === boxes.length) ? null : checked;
  if (nasTreeWidget) nasTreeWidget.refreshHoverFilter();
  // 筛选结果列表正显示着(状态=错误时才会显示这个列表)的话, 功能类型一变就得重新筛一次,
  // 因为"哪些目录该进列表"本身就是按功能类型决定的, 不会自动更新
  const resultBox = document.getElementById('nas-filter-result');
  if (resultBox && resultBox.style.display !== 'none' &&
      document.getElementById('nas-filter-status') &&
      document.getElementById('nas-filter-status').value === 'error') {
    applyNasFilter();
  }
}
function _nasFeatureAll(on) {
  document.querySelectorAll('.nas-feat-cb').forEach(b => { b.checked = on; });
  _onNasFeatureToggle();
}


// NAS批量操作（读nasTreeWidget勾选）
function batchWriteMd5Nas() { _batchRun(nasTreeWidget, dtwWriteMd5); }
function batchProcessNas() { _batchRun(nasTreeWidget, dtwProcess); }
function batchCleanOrphanNas() { _batchRun(nasTreeWidget, dtwCleanOrphan); }
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
    items = await apiFetch(url);
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
      const r = await apiFetch('/api/pc-roots');
      roots = r.map(d => ({ name: d.name, path: d.path }));
    } else {
      const r = await apiFetch('/api/nas/ls?path=/share');
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
      ${side==='src'?'<input type="checkbox" class="mig-src-check" value="'+esc+'" onchange="migCascadeCheck(this)" style="flex-shrink:0;cursor:pointer;width:14px;height:14px">':''}
      <span onclick="${side==='src'?'migSrcToggleCheck(event,\''+esc+'\')':"migSelect('"+esc+"','"+side+"')"}" oncontextmenu="${side==='dst'?'migCtxMenu(event,\''+esc+'\',\''+nid+'\','+depth+');return false;':''}" style="cursor:pointer;font-size:.82rem;color:#c8dff5;flex:1;word-break:break-all" id="${nid}_nm">${depth===0?(side==='src'?'💻':'🗄'):'📁'} ${escHtml(node.name)}</span>
      <button class="btn-sm" onclick="migRowRefresh('${esc}','${side}','${nid}',${depth})" title="刷新此目录" style="padding:2px 6px;font-size:.7rem">🔄</button>
    </div>
    <div class="mig-children" id="${nid}_ch" style="display:none"></div>
  </div>`;
}

// 点目录名切换checkbox
function migCascadeCheck(cb) {
  const node = cb.closest(".mig-node");
  if (!node) return;
  node.querySelectorAll(".mig-src-check").forEach(function(c) { c.checked = cb.checked; });
}

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
      });
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
  console.log("[pipeline] start", migGetChecked(), _migDst); console.log("[pipeline] 到达模态创建前");
  const srcs = migGetChecked();
  if (!srcs.length) { showToast('请先勾选要迁移的目录', 'error'); return; }
  if (!_migDst) { showToast('请先选择目标目录', 'error'); return; }
  const goBtn = document.getElementById('mig-go');
  if (goBtn) goBtn.disabled = true;
  // 弹出进度模态
  document.getElementById('mig-progress-modal')?.remove();
  const progModal = document.createElement('div');
  progModal.id = 'mig-progress-modal';
  progModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:10000;display:flex;align-items:center;justify-content:center';
  const taskListHtml = srcs.map(src => {
    const name = src.split('/').pop().split('\\').pop();
    const tid = 'mpt_' + btoa(unescape(encodeURIComponent(src))).replace(/[^a-zA-Z0-9]/g,'').slice(0,16);
    return `<div id="${tid}" style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #1a2433;font-size:.8rem">
      <span id="${tid}_icon" style="width:22px;text-align:center">⏳</span>
      <span style="flex:1;color:#c8dff5;word-break:break-all">${name}</span>
      <span id="${tid}_status" style="color:#507090;font-size:.72rem;flex-shrink:0;margin-left:8px">等待中</span>
    </div>`;
  }).join('');
  progModal.innerHTML = `<div style="background:#1e2838;border:1px solid #2a3d55;border-radius:12px;padding:24px 28px;min-width:480px;max-width:620px;width:90%;max-height:85vh;display:flex;flex-direction:column">
    <div style="font-size:1rem;font-weight:700;color:#f0f6ff;margin-bottom:14px">📦 迁移流水线 (${srcs.length} 个目录)</div>
    <div style="margin-bottom:12px;padding:10px 12px;background:#0f1620;border-radius:8px;flex-shrink:0">
      <div style="font-size:.7rem;color:#507090;margin-bottom:4px">当前</div>
      <div id="mprog-cur-name" style="font-size:.85rem;color:#40d0ff;font-weight:700;margin-bottom:4px;word-break:break-all">初始化...</div>
      <div id="mprog-cur-step" style="font-size:.78rem;color:#c8dff5">等待中</div>
      <div style="margin-top:8px;height:3px;background:#1a2433;border-radius:99px;overflow:hidden">
        <div id="mprog-bar" style="height:100%;width:0%;background:#40d0ff;border-radius:99px;transition:width .3s ease"></div>
      </div>
      <div id="mprog-count" style="font-size:.7rem;color:#507090;margin-top:3px">0 / 0</div>
    </div>
    <div style="font-size:.7rem;color:#507090;margin-bottom:6px">任务列表</div>
    <div id="mig-pipeline-log" style="flex:1;overflow-y:auto;font-size:.78rem">${taskListHtml}</div>
  </div>`;

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
    const list = document.getElementById('mig-pipeline-log');
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
    const name = src.split("/").pop();
    const dst = _migDst + "/" + name;
    const tid = "mpt_" + btoa(unescape(encodeURIComponent(src))).replace(/[^a-zA-Z0-9]/g,"").slice(0,16);
    const setStatus = (msg, color="#507090") => {
      const iconEl = document.getElementById(tid + "_icon");
      const statusEl = document.getElementById(tid + "_status");
      if (iconEl) iconEl.textContent = color==="#ff5567" ? "❌" : color==="#3ddc84" ? "✅" : color==="#ffa500" ? "⚠️" : "⏳";
      if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color; }
      // 同步更新顶部当前任务
      mprogSetCur(name, msg, color);
    };
    // Step0: 校验
    const isPcSrc = /^[A-Za-z]:/.test(src);
    mprogSetCur(name, '🔍 校验中...', '#507090'); mprogAddItem(name, '⏳', '#507090');
    setStatus('🔍 校验中...', '#507090');
    try {
      const checkApi = isPcSrc ? '/api/pc/migrate-check' : '/api/nas-migrate-check';
      const chk = await apiFetch(checkApi, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ srcPath: src, dstRoot: _migDst })
      });
      if (!chk.ok) { setStatus('❌ 校验失败: ' + chk.error, '#ff5567'); continue; }
      if (chk.hasConflict) { setStatus('⚠️ ' + chk.conflictCount + '个同名文件将跳过，继续迁移...', '#ffa500'); }
      setStatus('✅ 校验通过 共' + (chk.total||0) + '个文件', '#3ddc84'); mprogSetBar(0, chk.total||0);
    } catch(e) { setStatus('❌ 校验异常: ' + e.message, '#ff5567'); continue; }

    // Step1: 迁移
    setStatus('📦 迁移中...', '#40d0ff');
    try {
      if (isPcSrc) {
        // PC→NAS：弹CMD跑migrate_photos.py
        setStatus('📦 启动迁移CMD...', '#40d0ff');
        const startR = await apiFetch('/api/pc/run-migrate', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ srcPath: src, dstRoot: _migDst })
        });
        if (!startR.ok) throw new Error(startR.error || '迁移启动失败');
        setStatus('📦 迁移已在CMD窗口启动', '#3ddc84');
      } else {
        // NAS→NAS：直接mv
        const r = await apiFetch('/api/nas-migrate', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ srcPath: src, dstRoot: _migDst })
        });
        if (!r.ok) throw new Error(r.error || '迁移失败');
      }
      setStatus('✅ 迁移完成', '#3ddc84'); mprogSetCur(name, '✅ 迁移完成', '#3ddc84');
    } catch(e) {
      setStatus('❌ 迁移失败: ' + e.message, '#ff5567');
      await apiFetch('/api/migrate-failures', { method:'POST', headers:{'Content-Type':'application/json'},
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
      });
      if (r.error) throw new Error(r.error);
      setStatus('✅ MD5完成', '#3ddc84'); mprogSetCur(name, '✅ MD5完成', '#3ddc84');
    } catch(e) {
      setStatus('⚠️ MD5失败: ' + e.message + ' (已迁移)', '#ffa500');
      await apiFetch('/api/migrate-failures', { method:'POST', headers:{'Content-Type':'application/json'},
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
      });
      if (r.error) throw new Error(r.error);
      setStatus('✅ 全部完成', '#3ddc84'); mprogSetCur(name, '✅ 全部完成', '#3ddc84'); mprogAddItem(name, '✅', '#3ddc84');
    } catch(e) {
      setStatus('⚠️ 处理失败: ' + e.message + ' (已迁移+MD5)', '#ffa500');
      await apiFetch('/api/migrate-failures', { method:'POST', headers:{'Content-Type':'application/json'},
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
      const r = await apiFetch('/api/pc/browse?path=' + encodeURIComponent(path));
      items = (Array.isArray(r)?r:[]).filter(it => it.type === 'dir').map(d=>({name:d.name,path:d.path}));
    } else {
      const r = await apiFetch('/api/nas/ls?path=' + encodeURIComponent(path));
      items = (r.dirs||[]);
    }
 } catch(e) { if(typeof showToast==="function")showToast("失败: "+e.message,"error"); }
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
          const items = await apiFetch('/api/pc/browse?path=' + encodeURIComponent(path));
          dirs = (Array.isArray(items)?items:[]).filter(it => it.type === 'dir').map(d=>({name:d.name,path:d.path}));
        } else {
          const r = await apiFetch('/api/nas/ls?path=' + encodeURIComponent(path));
          dirs = (r.dirs||[]);
        }
 } catch(e) { if(typeof showToast==="function")showToast("失败: "+e.message,"error"); }
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
    });
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
    const r = await apiFetch('/api/pc/migrate', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ srcPath: _migSrc, dstRoot: _migDst })
    });
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
    st = await apiFetch('/api/pc/migrate-status', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
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
    const r = await apiFetch('/api/migrate-failures/count');
    const btn = document.getElementById('mig-fail-btn');
    const span = document.getElementById('mig-fail-count');
    if (!btn || !span) return;
    if (r.count > 0) {
      span.textContent = r.count;
      btn.style.display = '';
    } else {
      btn.style.display = 'none';
    }
 } catch(e) { if(typeof showToast==="function")showToast("失败: "+e.message,"error"); }
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
  try { rows = await apiFetch('/api/migrate-failures?status=pending'); }
  catch(e) { list.innerHTML = '<span style="color:#ff5567">加载失败</span>'; return; }
  if (!rows.length) {
    // 看有没有retried的(已重试待确认)
    let retried = [];
    try { retried = await apiFetch('/api/migrate-failures?status=retried'); } catch(e) { if(typeof showToast==="function")showToast("失败: "+e.message,"error"); }
    if (!retried.length) { list.innerHTML = '<div style="color:#3ddc84;padding:20px;text-align:center">✅ 暂无失败记录</div>'; return; }
    rows = retried;
  } else {
    // 同时拉retried显示在下面
    try {
      const retried = await apiFetch('/api/migrate-failures?status=retried');
      rows = rows.concat(retried);
 } catch(e) { if(typeof showToast==="function")showToast("失败: "+e.message,"error"); }
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
    const r = await apiFetch('/api/pc/migrate-retry', {method:'POST', body:{id}});
    if (r.error) showToast('重试失败: ' + r.error, 'error');
    else if (r.success) showToast('重试成功，请确认完结', 'success');
    else showToast('重试又失败: ' + (r.newError || '未知'), 'error');
    mfLoadList();
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}

async function mfConfirm(id) {
  if (!confirm('确认完结：更新DB路径并标记resolved？')) return;
  try {
    const r = await apiFetch('/api/pc/migrate-confirm', {method:'POST', body:{id}});
    if (r.error) showToast('失败: ' + r.error, 'error');
    else showToast('已完结', 'success');
    mfLoadList();
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}

async function mfDiscard(id) {
  if (!confirm('放弃这条记录？将从表中删除')) return;
  try {
    await apiFetch('/api/migrate-failures/delete', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[id]})});
    showToast('已放弃', 'success');
    mfLoadList();
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}

async function mfReset(id) {
  try {
    await fetch('/api/migrate-failures/update', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id, status:'pending'})});
    mfLoadList();
 } catch(e) { if(typeof showToast==="function")showToast("失败: "+e.message,"error"); }
}

async function mfBatchRetry() {
  const ids = [...document.querySelectorAll('#mf-list .mf-check:checked')].map(c => parseInt(c.value));
  if (!ids.length) { showToast('请先勾选', 'error'); return; }
  for (const id of ids) {
    try { await fetch('/api/pc/migrate-retry', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})}); } catch(e) { if(typeof showToast==="function")showToast("失败: "+e.message,"error"); }
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
    });
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
    const r = await apiFetch('/api/nas-dir/delete', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ path })
    });
    if (r.error) { showToast('失败: ' + r.error, 'error'); return; }
    if (r.needConfirm) {
      if (!confirm(`该目录包含 ${r.fileCount} 个文件、${r.dirCount} 个子目录，确定删除？

⚠️ 此操作不可恢复！`)) return;
      // 二次确认后真正删除
      const r2 = await apiFetch('/api/nas-dir/delete', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ path, confirm: true })
      });
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
    const r = await apiFetch('/api/nas-dir/rename', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ targetPath: path, newName: newName.trim() })
    });
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

// ── NAS目录筛选（基于 /api/nas/all-dirs，对等PC）──────────────
let _nasAllDirsCache = null;

async function applyNasFilter() {
  const name   = (document.getElementById('nas-filter-name').value || '').trim().toLowerCase();
  const status = document.getElementById('nas-filter-status').value;
  const minCnt = parseInt(document.getElementById('nas-filter-min').value) || 0;
  const countEl = document.getElementById('nas-filter-count');

  if (countEl) countEl.textContent = '加载中...';
  if (!_nasAllDirsCache) {
    try {
      _nasAllDirsCache = await apiFetch('/api/nas/all-dirs');
    } catch(e) { if (countEl) countEl.textContent = '加载失败'; return; }
  }

  // 先按名字/最小数量做基础过滤(和功能类型无关的维度)
  let candidates = _nasAllDirsCache.filter(d => {
    if (name && !d.name.toLowerCase().includes(name) && !d.path.toLowerCase().includes(name)) return false;
    if (minCnt && d.total < minCnt) return false;
    if (status === 'pending' && d.pending <= 0) return false;
    if (status === 'done'    && !(d.total > 0 && d.done === d.total)) return false;
    return true;
  });

  // 状态="错误"时, 是否进入结果列表要看"该目录在被勾中的功能类型上是否有错误",
  // 不能再用笼统的 d.error(只统计了图片处理这一种), 否则会把只有其它功能类型错误、
  // 或者根本没有被选中的功能类型错误的目录也混进来
  // 注意: 不能把几千个候选目录路径塞进 POST body 传给后端做归类 —— 会撞上 TS 核心里
  // 全局 express.json() 的默认 100KB 限制(冻结区改不了, 而且它在路由自己的 json()
  // 中间件之前就处理请求体, 路由自己设的 limit 完全没用)。改成 GET 拿原始失败路径列表
  // (体积小得多, 就几千条路径字符串), 前端自己做"最长前缀匹配"把每条错误路径归到目录。
  let errByDir = {};
  let matched = candidates;
  if (status === 'error') {
    if (!candidates.length) { matched = []; }
    else {
      const feats = (typeof _nasEnabledFeatures !== 'undefined' && _nasEnabledFeatures) ? _nasEnabledFeatures : null;
      let rawPaths = {};
      try {
        const qs = feats ? ('?features=' + feats.join(',')) : '';
        rawPaths = await apiFetch('/api/errors/raw-paths' + qs);
      } catch (e) { rawPaths = {}; }

      // 前端做最长前缀匹配: 候选目录按路径长度降序排, 每条错误路径归到能匹配到的最长(最精确)的那个目录
      const sortedCand = candidates.slice().sort((a, b) => b.path.length - a.path.length);
      candidates.forEach(d => { errByDir[d.path] = {}; });
      Object.keys(rawPaths).forEach(feat => {
        rawPaths[feat].forEach(p => {
          const best = sortedCand.find(d => p === d.path || p.indexOf(d.path + '/') === 0);
          if (best) errByDir[best.path][feat] = (errByDir[best.path][feat] || 0) + 1;
        });
      });

      // 只保留"在勾中的功能类型上确实有错误"的目录
      matched = candidates.filter(d => {
        const feErr = errByDir[d.path] || {};
        return Object.keys(feErr).some(k => feErr[k] > 0);
      });
    }
  }
  matched.sort((a,b) => b.total - a.total);

  const list = document.getElementById('dir-list');
  if (countEl) countEl.textContent = `匹配 ${matched.length} 个目录`;

  // errByDir 已在上面按 candidates 查过了(用于决定哪些目录该进 matched), 这里直接复用不用重查
  const FEAT_LABEL = { photo_process: '图片处理', md5_write: '打MD5', clip_tag: 'CLIP', feat_extract: '特征提取', video_shots: '视频抽帧' };

  const resultHtml = matched.map(d => {
    let errHtml = '';
    if (status === 'error') {
      const feErr = errByDir[d.path] || {};
      errHtml = Object.keys(feErr).filter(k => feErr[k] > 0).map(k =>
        ` <span style="color:#ff5567;cursor:pointer;text-decoration:underline" onclick="showDirErrors('${d.path.replace(/'/g,"\\'")}', '${k}')">❌${FEAT_LABEL[k]||k}${feErr[k]}</span>`
      ).join('');
    }
    return `
    <div class="nas-dir-row" data-path="${d.path}" style="border-bottom:1px solid #1a2433">
      <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0">
        <input type="checkbox" class="nas-filter-check" value="${d.path}" style="margin-top:4px;flex-shrink:0">
        <div style="flex:1;min-width:0">
          <strong>📁 ${escHtml(d.name)}</strong>
          <small style="color:#507090;margin-left:8px;font-family:monospace;font-size:.7rem">${escHtml(d.path)}</small>
          <div style="font-size:.72rem;margin-top:2px">总${d.total} <span style="color:#3ddc84">✅${d.done}</span> <span style="color:#ffa500">⏳${d.pending}</span>${errHtml}</div>
        </div>
      </div>
    </div>`;
  }).join('') || '<div style="color:#507090;padding:20px;text-align:center">无匹配目录</div>';

  let resultBox = document.getElementById('nas-filter-result');
  if (!resultBox) {
    resultBox = document.createElement('div');
    resultBox.id = 'nas-filter-result';
    list.appendChild(resultBox);
  }
  const mount = document.getElementById('nas-tree-mount');
  if (mount) mount.style.display = 'none';
  resultBox.innerHTML = resultHtml;
  resultBox.style.display = 'block';
}

function clearNasFilter() {
  const n=document.getElementById('nas-filter-name'); if(n) n.value='';
  const s=document.getElementById('nas-filter-status'); if(s) s.value='all';
  const m=document.getElementById('nas-filter-min'); if(m) m.value='';
  const c=document.getElementById('nas-filter-count'); if(c) c.textContent='';
  const rb=document.getElementById('nas-filter-result'); if(rb) rb.style.display='none';
  const mount=document.getElementById('nas-tree-mount'); if(mount) mount.style.display='block';
}

// ── 角色管理 ──────────────────────────────────────────
let rolesCache = [];
let rolesRootsCache = [];

async function loadRoles() {
  const r = await fetch('/api/roles');
  rolesCache = await r.json();
  renderRolesList();
}

async function loadAllRootsForRoles() {
  const r = await fetch('/api/browser/roots?source=nas');
  rolesRootsCache = await r.json();
}

function renderRolesList() {
  const box = document.getElementById('roles-list');
  if (!box) return;
  if (!rolesCache.length) {
    box.innerHTML = '<div style="padding:20px;color:#507090">还没有角色,点下方"新建角色"创建一个</div>';
    return;
  }
  box.innerHTML = rolesCache.map(r => `
    <div class="role-card" style="border:1px solid #263548;border-radius:8px;padding:14px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="font-size:1.4rem">${r.icon || '👤'}</span>
        <span style="font-weight:700;font-size:1rem">${escHtmlR(r.name)}</span>
        <span style="margin-left:auto;display:flex;gap:6px">
          <button class="btn-sm" onclick="openEditRole('${r.id}')">✏️ 编辑</button>
          <button class="btn-sm" style="border-color:#ff5567;color:#ff5567" onclick="deleteRole('${r.id}','${escJsR(r.name)}')">🗑 删除</button>
        </span>
      </div>
      <div style="font-size:.78rem;color:#8fa8c4">
        可见根目录: ${r.allowed_roots.length ? r.allowed_roots.map(p => `<span style="display:inline-block;background:#182535;border-radius:4px;padding:2px 8px;margin:2px">${escHtmlR(p)}</span>`).join('') : '<span style="color:#ff8080">(无,该角色看不到任何目录)</span>'}
      </div>
    </div>
  `).join('');
}

function escHtmlR(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escJsR(s) { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

async function openCreateRole() {
  await loadAllRootsForRoles();
  openRoleModal(null);
}

async function openEditRole(id) {
  await loadAllRootsForRoles();
  const role = rolesCache.find(r => r.id === id);
  if (!role) return;
  openRoleModal(role);
}

function openRoleModal(role) {
  const isEdit = !!role;
  const name = role ? role.name : '';
  const icon = role ? (role.icon || '👤') : '👤';
  const allowed = role ? role.allowed_roots : [];

  const rootsHtml = rolesRootsCache.map(r => {
    const checked = allowed.includes(r.path) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer">
      <input type="checkbox" class="role-root-cb" value="${escHtmlR(r.path)}" ${checked}>
      <span>${escHtmlR(r.name)}</span>
      <small style="color:#507090">${escHtmlR(r.path)}</small>
    </label>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:#101820;border:1px solid #263548;border-radius:10px;padding:24px;width:480px;max-height:80vh;overflow-y:auto">
      <div style="font-size:1.1rem;font-weight:700;margin-bottom:16px">${isEdit ? '✏️ 编辑角色' : '➕ 新建角色'}</div>
      <div style="margin-bottom:12px">
        <label style="font-size:.8rem;color:#8fa8c4">名称</label>
        <input id="role-name-input" value="${escHtmlR(name)}" style="width:100%;padding:8px;margin-top:4px;background:#182535;border:1px solid #263548;border-radius:6px;color:#f0f6ff">
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:.8rem;color:#8fa8c4">图标(emoji)</label>
        <input id="role-icon-input" value="${escHtmlR(icon)}" style="width:100%;padding:8px;margin-top:4px;background:#182535;border:1px solid #263548;border-radius:6px;color:#f0f6ff">
      </div>
      <div style="margin-bottom:16px">
        <label style="font-size:.8rem;color:#8fa8c4">可见根目录(勾选允许看到的)</label>
        <div style="margin-top:6px;max-height:220px;overflow-y:auto;border:1px solid #263548;border-radius:6px;padding:8px">
          ${rootsHtml || '<div style="color:#507090">没有可选目录</div>'}
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn-sm" onclick="this.closest('div[style*=fixed]').remove()">取消</button>
        <button class="btn-sm" style="border-color:#40d0ff;color:#40d0ff" onclick="saveRole('${isEdit ? role.id : ''}')">保存</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function saveRole(id) {
  const name = document.getElementById('role-name-input').value.trim();
  if (!name) { showToast('请输入角色名称', 'error'); return; }
  const icon = document.getElementById('role-icon-input').value.trim();
  const allowed_roots = Array.from(document.querySelectorAll('.role-root-cb:checked')).map(cb => cb.value);

  const body = { name, icon, allowed_roots };
  try {
    const url = id ? `/api/roles/${id}` : '/api/roles';
    const method = id ? 'PUT' : 'POST';
    const r = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) { showToast('保存失败: ' + d.error, 'error'); return; }
    showToast(id ? '角色已更新' : '角色已创建', 'success');
    document.querySelectorAll('div[style*="position:fixed"]').forEach(el => { if (el.innerHTML.includes('角色')) el.remove(); });
    loadRoles();
  } catch (e) { showToast('失败: ' + e.message, 'error'); }
}

async function deleteRole(id, name) {
  if (!confirm(`删除角色「${name}」？\n该角色将无法再登录使用。`)) return;
  try {
    const r = await fetch(`/api/roles/${id}`, { method: 'DELETE' });
    const d = await r.json();
    if (d.error) { showToast('删除失败: ' + d.error, 'error'); return; }
    showToast('已删除', 'success');
    loadRoles();
  } catch (e) { showToast('失败: ' + e.message, 'error'); }
}

// ── 添加NAS根目录 - 复用迁移模块的目录树模式(/api/nas/ls) ──
let _addRootSelected = '';

function openAddRootBrowser() {
  _addRootSelected = '';
  const modal = document.createElement('div');
  modal.id = 'addroot-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.78);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `<div style="background:#161d28;border:1px solid #2a3d55;border-radius:14px;padding:22px 26px;width:480px;max-width:94vw;display:flex;flex-direction:column;max-height:82vh">
    <div style="font-size:1rem;font-weight:700;color:#f0f6ff;margin-bottom:14px">📁 选择NAS根目录</div>
    <div style="padding:10px;background:#0f1620;border-radius:8px;border:1px solid #2a3d55;margin-bottom:12px">
      <div style="font-size:.7rem;color:#507090;margin-bottom:4px">已选</div>
      <div id="addroot-show" style="font-size:.78rem;color:#3ddc84;font-family:monospace;word-break:break-all;min-height:18px">点下方文件夹名选择</div>
    </div>
    <div id="addroot-tree" style="flex:1;overflow:auto;border:1px solid #2a3d55;border-radius:8px;padding:6px;min-height:280px"></div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button id="addroot-confirm" style="flex:1;padding:9px;border-radius:7px;background:#3ddc84;color:#000;border:none;cursor:pointer;font-weight:700">确定</button>
      <button id="addroot-close" class="btn-sm danger">取消</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  document.getElementById('addroot-close').onclick = () => modal.remove();
  document.getElementById('addroot-confirm').onclick = async () => {
    if (!_addRootSelected) { showToast('请先选择一个目录', 'error'); return; }
    const name = prompt('给这个目录起个名字：', _addRootSelected.split('/').filter(Boolean).pop());
    if (!name) return;
    await fetch('/api/browser/roots', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path: _addRootSelected, source: 'nas' }),
    });
    loadBrowserRoots();
    showToast('根目录已添加', 'success');
    modal.remove();
  };
  addRootTreeInit();
}

async function addRootTreeInit() {
  const box = document.getElementById('addroot-tree');
  box.innerHTML = '加载中...';
  let dirs = [];
  try {
    const r = await apiFetch('/api/nas/ls?path=/share');
    dirs = (r.dirs || []);
  } catch (e) { box.innerHTML = '<span style="color:#ff5567">加载失败</span>'; return; }
  if (!dirs.length) { box.innerHTML = '<div style="color:#507090;padding:12px">（空）</div>'; return; }
  box.innerHTML = dirs.map(d => addRootNodeHtml(d, 0)).join('');
}

function addRootNodeHtml(node, depth) {
  const fwd = node.path.replace(/\\/g, '/');
  const nid = 'addroot_' + btoa(unescape(encodeURIComponent(fwd))).replace(/[^a-zA-Z0-9]/g, '');
  let guides = '';
  for (let i = 0; i < depth; i++) guides += '<span class="pc-guide"></span>';
  const esc = fwd.replace(/'/g, "\\'");
  return `<div class="addroot-node">
    <div style="display:flex;align-items:center;gap:4px;padding:4px 0">
      ${guides}
      <span class="pc-toggle" onclick="addRootToggle('${esc}','${nid}',${depth})" data-loaded="0" id="${nid}_tg">+</span>
      <span onclick="addRootSelect('${esc}')" style="cursor:pointer;font-size:.82rem;color:#c8dff5;flex:1;word-break:break-all" id="${nid}_nm">${depth === 0 ? '🗄' : '📁'} ${escHtml(node.name)}</span>
    </div>
    <div class="addroot-children" id="${nid}_ch" style="display:none"></div>
  </div>`;
}

async function addRootToggle(path, nid, depth) {
  const tg = document.getElementById(nid + '_tg');
  const ch = document.getElementById(nid + '_ch');
  if (!ch) return;
  if (ch.style.display === 'none') {
    if (tg.dataset.loaded === '0') {
      tg.textContent = '\u00b7';
      let dirs = [];
      try {
        const r = await fetch('/api/nas/ls?path=' + encodeURIComponent(path)).then(r => r.json());
        dirs = (r.dirs || []);
      } catch (e) {}
      ch.innerHTML = dirs.length
        ? dirs.map(d => addRootNodeHtml(d, depth + 1)).join('')
        : '<div style="color:#507090;font-size:.7rem;padding:2px 0 2px ' + ((depth + 1) * 18) + 'px">（无子目录）</div>';
      tg.dataset.loaded = '1';
    }
    ch.style.display = 'block';
    tg.textContent = '\u2212';
  } else {
    ch.style.display = 'none';
    tg.textContent = '+';
  }
}

function addRootSelect(path) {
  const fwd = path.replace(/\\/g, '/');
  _addRootSelected = fwd;
  document.getElementById('addroot-show').textContent = fwd;
  document.querySelectorAll('#addroot-tree [id$="_nm"]').forEach(el => el.style.background = 'transparent');
  const nid = 'addroot_' + btoa(unescape(encodeURIComponent(fwd))).replace(/[^a-zA-Z0-9]/g, '');
  const nmEl = document.getElementById(nid + '_nm');
  if (nmEl) nmEl.style.background = '#182535';
}

// ── 标签词表管理 (JSON导入) ──
async function loadTagVocabStatus() {
  try {
    const r = await apiFetch('/api/tag-vocab/full');
    const el = document.getElementById('tag-vocab-status');
    if (el) el.textContent = `当前词表: ${r.length} 个标签`;
    const ta = document.getElementById('tag-vocab-json');
    if (ta && !ta.dataset.userEdited) {
      const obj = {};
      r.forEach(row => { obj[row.tag] = row.en || ''; });
      ta.value = JSON.stringify(obj, null, 2);
    }
  } catch (e) {}
}

async function importTagVocab() {
  const text = document.getElementById('tag-vocab-json').value.trim();
  if (!text) { showToast('请先粘贴JSON', 'error'); return; }
  let vocab;
  try {
    vocab = JSON.parse(text);
  } catch (e) {
    showToast('JSON格式错误: ' + e.message, 'error');
    return;
  }
  if (typeof vocab !== 'object' || Array.isArray(vocab)) {
    showToast('格式应为 {"标签":"英文描述", ...} 这种对象', 'error');
    return;
  }
  try {
    const r = await fetch('/api/tag-vocab/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vocab })
    });
    const d = await r.json();
    if (d.error) { showToast('导入失败: ' + d.error, 'error'); return; }
    showToast(`导入成功: 共${d.count}个标签`, 'success');
    loadTagVocabStatus();
  } catch (e) { showToast('失败: ' + e.message, 'error'); }
}


let _tagProgressTimer = null;
async function showTagProgress() {
  document.getElementById('tag-progress-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'tag-progress-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:10000;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `<div style="background:#1e2838;border:1px solid #2a3d55;border-radius:12px;padding:24px 28px;min-width:360px;max-width:480px;width:90%">
    <div style="font-size:1rem;font-weight:700;color:#f0f6ff;margin-bottom:16px">🏷️ 打标进度</div>
    <div id="tag-progress-body">加载中...</div>
    <button onclick="clearInterval(_tagProgressTimer);document.getElementById('tag-progress-modal').remove()" style="margin-top:16px;padding:8px 20px;border-radius:6px;background:#40d0ff;color:#000;border:none;cursor:pointer;font-weight:700">关闭</button>
  </div>`;
  document.body.appendChild(modal);

  const render = async () => {
    try {
      const d = await apiFetch('/api/tags/progress');
      const bar = (label, done, total, color) => {
        const pct = total > 0 ? (done/total*100) : 0;
        const pctStr = pct === 0 ? '0' : (pct < 0.1 ? pct.toFixed(2) : pct.toFixed(1));
        return `<div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;font-size:.82rem;color:#c8dff5;margin-bottom:4px">
            <span>${label}</span><span>${done} / ${total} (${pctStr}%)</span>
          </div>
          <div style="height:8px;background:#0f1620;border-radius:99px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${color};transition:width .3s"></div>
          </div>
        </div>`;
      };
      const body = document.getElementById('tag-progress-body');
      if (body) {
        body.innerHTML =
          bar('CLIP标签 (clip_status)', d.clipDone, d.total, '#40d0ff') +
          bar('VLM标签 (vlm_status)', d.vlmDone, d.total, '#3ddc84') +
          bar('AI描述 (ai_status)', d.aiDone, d.total, '#a78bfa') +
          bar('特征提取 (feat_status)', d.featDone, d.total, '#ffa500') +
          `<div style="font-size:.72rem;color:#507090;margin-top:8px">已处理照片总数: ${d.total}</div>` +
          (d.tagCounts && Object.keys(d.tagCounts).length
            ? `<div style="font-size:.72rem;color:#507090;margin-top:4px">photo_tags按来源: ${Object.entries(d.tagCounts).map(([k,v])=>k+'='+v).join(', ')}</div>`
            : '');
      }
    } catch(e) {
      const body = document.getElementById('tag-progress-body');
      if (body) body.innerHTML = '<span style="color:#ff5567">加载失败: ' + e.message + '</span>';
    }
  };
  render();
  _tagProgressTimer = setInterval(render, 3000);
}


let _clipLiveTimer = null;
function closeClipLiveModal() {
  clearInterval(_clipLiveTimer);
  _clipLiveTimer = null;
  document.getElementById('clip-live-modal')?.remove();
}
async function openClipLiveModal(dirPath) {
  closeClipLiveModal();
  const modal = document.createElement('div');
  modal.id = 'clip-live-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:10000;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `<div style="background:#161d28;border:1px solid #2a3d55;border-radius:14px;padding:22px 26px;min-width:480px;max-width:640px;width:92%;max-height:82vh;display:flex;flex-direction:column">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span style="font-size:1rem;font-weight:700;color:#f0f6ff">🎨 CLIP提取进度</span>
      <span id="clv-status" style="font-size:.74rem;color:#507090">连接中...</span>
    </div>
    <div id="clv-dir" style="font-size:.74rem;color:#507090;margin-bottom:10px;word-break:break-all"></div>
    <div id="clv-dirqueue" style="font-size:.72rem;color:#8aa8c8;margin-bottom:8px;word-break:break-all"></div>
    <div style="height:10px;background:#0f1620;border-radius:99px;overflow:hidden;margin-bottom:8px">
      <div id="clv-bar" style="height:100%;width:0%;background:#40d0ff;transition:width .4s"></div>
    </div>
    <div id="clv-nums" style="font-size:.78rem;color:#c8dff5;margin-bottom:12px"></div>
    <div id="clv-current" style="font-size:.82rem;color:#3ddc84;margin-bottom:8px;min-height:1.2em"></div>
    <div style="font-size:.72rem;color:#507090;margin-bottom:4px">待处理队列(本批):</div>
    <div id="clv-queue" style="flex:1;overflow:auto;background:#0f1620;border-radius:8px;padding:8px 12px;font-size:.74rem;color:#8aa8c8;font-family:monospace;min-height:120px;max-height:300px"></div>
    <button onclick="closeClipLiveModal()" style="margin-top:14px;padding:9px;border-radius:7px;background:#40d0ff;color:#000;border:none;cursor:pointer;font-weight:700">关闭(后台继续处理)</button>
  </div>`;
  document.body.appendChild(modal);

  const render = async () => {
    try {
      const d = await apiFetch('/api/clip/live-status');
      const td = await apiFetch('/api/clip/target-dir').catch(() => ({}));
      const st = document.getElementById('clv-status');
      if (!st) return;
      const map = { idle: '⏸ PC待命中', running: '▶ 处理中', done: '✅ 本目录已完成', stale: '⚠ PC失联(30秒无上报)', stopped: '⏹ PC已停止' };
      st.textContent = map[d.status] || d.status;
      st.style.color = d.status === 'running' ? '#3ddc84' : (d.status === 'stale' || d.status === 'stopped') ? '#ff5567' : '#507090';
      document.getElementById('clv-dir').textContent = '目标: ' + (d.dir || dirPath || '(未设置)');
      const dq = (td.dirQueue || []);
      const dqEl = document.getElementById('clv-dirqueue');
      if (dqEl) dqEl.textContent = dq.length > 1 ? ('目录队列(' + dq.length + '): ' + dq.map(x => x.split('/').pop()).join(' → ')) : '';
      const finished = d.done + d.err;
      const scopeTotal = finished + (d.pendingInScope || 0) + (d.queue ? d.queue.length : 0) + (d.current ? 1 : 0);
      const pct = scopeTotal > 0 ? Math.min(100, Math.round(finished / scopeTotal * 100)) : 0;
      document.getElementById('clv-bar').style.width = pct + '%';
      document.getElementById('clv-nums').textContent =
        `本次会话完成 ${d.done} · 失败 ${d.err} · 范围内剩余 ${d.pendingInScope ?? '?'} (${pct}%)`;
      document.getElementById('clv-current').textContent = d.current ? ('正在处理: ' + d.current) : '';
      const q = document.getElementById('clv-queue');
      q.innerHTML = (d.queue && d.queue.length)
        ? d.queue.map(n => '<div>' + n + '</div>').join('')
        : '<div style="color:#385068">(空)</div>';
    } catch (e) {}
  };
  render();
  _clipLiveTimer = setInterval(render, 2000);
}


async function batchClipTagNas() {
  if (!nasTreeWidget) return;
  const checked = nasTreeWidget.getChecked();
  if (!checked.length) { showToast('请先勾选目录', 'error'); return; }
  const nasOnly = checked.filter(p => p.startsWith('/share/'));
  if (!nasOnly.length) { showToast('CLIP打标签仅支持NAS目录', 'error'); return; }
  try {
    const r = await fetch('/api/clip/set-target-dir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: nasOnly })
    });
    const d = await r.json();
    if (d.error) { showToast('提交失败: ' + d.error, 'error'); return; }
    if (d.allDone) { showToast('所选目录均已全部提取过,无需处理', 'success'); return; }
    showToast('已提交 ' + (d.dirQueue ? d.dirQueue.length : 0) + ' 个目录到CLIP队列', 'success');
    if (typeof openClipLiveModal === 'function') openClipLiveModal(nasOnly[0]);
  } catch (e) { showToast('失败: ' + e.message, 'error'); }
}


// ── 歌曲选择器 ────────────────────────────────────────
let _pickerSel = {};      // path -> {path,name}
let _pickerSongs = [];    // 当前列表
let _pickerAll = null;    // 全库缓存(搜索用)
let _pickerDir = '/share/Media/音乐';

function openSongPicker() {
  if (!currentPl) { showToast('请先打开一个歌单', 'error'); return; }
  _pickerSel = {};
  _pickerDir = '/share/Media/音乐';
  document.getElementById('song-picker-title').textContent = '添加歌曲到「' + currentPl.name + '」';
  document.getElementById('song-search').value = '';
  document.getElementById('song-picker-modal').classList.add('show');
  loadPickerTree();
  loadPickerSongs();
  updatePickerCount();
}
function closeSongPicker() {
  document.getElementById('song-picker-modal').classList.remove('show');
}

async function loadPickerTree() {
  const wrap = document.getElementById('song-picker-tree');
  wrap.innerHTML = '<div style="font-size:.74rem;color:#507090;padding:6px">加载中…</div>';
  try {
    const d = await fetch('/api/music/browse?path=' + encodeURIComponent('/share/Media/音乐')).then(r => r.json());
    const rows = [{ name: '🎵 全部音乐', path: d.root }].concat((d.dirs || []).map(x => ({ name: '📁 ' + x.name, path: x.path })));
    wrap.innerHTML = rows.map(r =>
      '<div class="sidebar-item" style="font-size:.78rem;padding:5px 8px;cursor:pointer" onclick="pickerSelectDir(\'' + escJs(r.path) + '\')">' + escHtml(r.name) + '</div>'
    ).join('');
  } catch (e) { wrap.innerHTML = '<div style="color:#c66;font-size:.74rem;padding:6px">加载失败</div>'; }
}

function pickerSelectDir(path) {
  _pickerDir = path;
  document.getElementById('song-picker-dir').textContent = path;
  document.getElementById('song-search').value = '';
  loadPickerSongs();
}

async function loadPickerSongs() {
  const listEl = document.getElementById('song-picker-list');
  const rec = document.getElementById('song-picker-recursive').checked;
  listEl.innerHTML = '<div style="font-size:.74rem;color:#507090;padding:8px">加载中…</div>';
  try {
    let songs;
    if (rec) {
      const d = await fetch('/api/music/scan?path=' + encodeURIComponent(_pickerDir)).then(r => r.json());
      songs = d.songs || [];
    } else {
      const d = await fetch('/api/music/browse?path=' + encodeURIComponent(_pickerDir)).then(r => r.json());
      songs = d.files || [];
    }
    _pickerSongs = songs;
    renderPickerSongs(songs);
  } catch (e) { listEl.innerHTML = '<div style="color:#c66;font-size:.74rem;padding:8px">加载失败</div>'; }
}

function renderPickerSongs(songs) {
  const listEl = document.getElementById('song-picker-list');
  const inPl = new Set((currentPl && currentPl.songs || []).map(s => s.path));
  if (!songs.length) { listEl.innerHTML = '<div style="font-size:.74rem;color:#507090;padding:8px">此处没有音频文件</div>'; return; }
  listEl.innerHTML = songs.map(s => {
    const has = inPl.has(s.path);
    const checked = _pickerSel[s.path] ? 'checked' : '';
    return '<label style="display:flex;align-items:center;gap:8px;padding:5px 10px;font-size:.78rem;color:' + (has ? '#507090' : '#c8dff5') + ';cursor:pointer">' +
      '<input type="checkbox" ' + checked + ' ' + (has ? 'disabled' : '') + ' onchange="pickerToggle(\'' + escJs(s.path) + '\', \'' + escJs(s.name) + '\', this.checked)">' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(s.name) + (has ? ' (已在歌单)' : '') + '</span></label>';
  }).join('');
}

function pickerToggle(path, name, checked) {
  if (checked) _pickerSel[path] = { path, name };
  else delete _pickerSel[path];
  updatePickerCount();
}

function pickerSelectAll(on) {
  const inPl = new Set((currentPl && currentPl.songs || []).map(s => s.path));
  if (on) _pickerSongs.forEach(s => { if (!inPl.has(s.path)) _pickerSel[s.path] = s; });
  else _pickerSel = {};
  renderPickerSongs(_pickerSongs);
  updatePickerCount();
}

function updatePickerCount() {
  document.getElementById('song-picker-count').textContent = Object.keys(_pickerSel).length;
}

async function filterPickerSongs() {
  const kw = document.getElementById('song-search').value.trim().toLowerCase();
  if (!kw) { renderPickerSongs(_pickerSongs); return; }
  if (!_pickerAll) {
    try {
      const d = await fetch('/api/music/scan?path=' + encodeURIComponent('/share/Media/音乐')).then(r => r.json());
      _pickerAll = d.songs || [];
    } catch (e) { _pickerAll = []; }
  }
  renderPickerSongs(_pickerAll.filter(s => s.name.toLowerCase().includes(kw)));
}

async function confirmAddSongs() {
  const songs = Object.values(_pickerSel);
  if (!songs.length) { showToast('还没选歌', 'error'); return; }
  try {
    const r = await fetch('/api/playlists/' + currentPl.id + '/add-songs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songs })
    }).then(r => r.json());
    if (r.error) { showToast('添加失败: ' + r.error, 'error'); return; }
    showToast('已添加 ' + r.added + ' 首, 歌单共 ' + r.total + ' 首', 'success');
    closeSongPicker();
    await loadPlaylists();
    currentPl = playlists.find(p => p.id === currentPl.id);
    renderSongList();
  } catch (e) { showToast('失败: ' + e.message, 'error'); }
}

// ── 歌单改名 ────────────────────────────────────────
// PUT /api/playlists/:id 是整体覆盖(name + songs),
// 所以必须先取最新 songs 一起回传, 否则会抹掉别处刚加的歌
async function renamePlaylist(id) {
  const pl = (playlists || []).find(function (p) { return p.id === id; });
  if (!pl) return;
  const input = prompt('歌单新名称', pl.name);
  if (input === null) return;
  const nm = String(input).trim();
  if (!nm) { showToast('名称不能为空', 'error'); return; }
  if (nm === pl.name) return;
  try {
    const fresh = await fetch('/api/playlists').then(function (r) { return r.json(); });
    const cur = (fresh || []).find(function (p) { return p.id === id; });
    if (!cur) { showToast('歌单已不存在', 'error'); await loadPlaylists(); return; }
    const res = await fetch('/api/playlists/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nm, songs: cur.songs || [] })
    });
    if (!res.ok) { showToast('改名失败: HTTP ' + res.status, 'error'); return; }
    await loadPlaylists();
    // 若正打开着这个歌单的编辑弹窗, 同步标题
    if (typeof currentPl !== 'undefined' && currentPl && currentPl.id === id) {
      currentPl.name = nm;
      const t = document.getElementById('edit-pl-title');
      if (t) t.textContent = nm;
    }
    showToast('已改名为 ' + nm, 'success');
  } catch (e) { showToast('改名失败', 'error'); }
}

// apiFetch 已挪到 /common/api-fetch.js (photo/viewer/videoer三个页面共用,
// 之前只在这里定义导致viewer/videoer页面里依赖它的dir-tree-widget.js调用报错)
