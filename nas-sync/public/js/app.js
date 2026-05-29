let logFilter    = 'all';
let editingDirId = null;
let filters      = {};
let allDirs      = [];
let currentDirId = null;
let diffDirId    = null;

async function init() {
  await Promise.all([loadStatus(), loadDirs(), loadFilters(), loadLogs('log-list-status')]);
  setInterval(loadStatus, 10000);
  setInterval(() => loadLogs('log-list-status'), 15000);
}

function switchTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('page-' + tab).style.display = 'block';
  if (tab === 'log') loadLogs('log-list');
}

async function loadStatus() {
  try {
    const r = await fetch('/api/sync/status');
    const s = await r.json();
    document.getElementById('pc-status').textContent     = s.online ? '🟢 在线' : '🔴 离线';
    document.getElementById('pc-status').className       = 'stat-value ' + (s.online ? 'online' : 'offline');
    document.getElementById('pending-count').textContent = s.pendingCount || 0;
    document.getElementById('last-sync').textContent     = s.lastSync
      ? new Date(s.lastSync).toLocaleString('ja-JP') : '从未同步';
  } catch(e) {}
}

async function loadDirs() {
  const r = await fetch('/api/config/dirs');
  allDirs  = await r.json();
  const list = document.getElementById('dir-list');
  const modeLabel = { mirror:'单向镜像', bidirectional:'双向同步', addonly:'仅新增' };
  const modeClass = { mirror:'mirror', bidirectional:'bidirectional', addonly:'addonly' };
  list.innerHTML = allDirs.map(d => `
    <div class="dir-item ${d.enabled ? '' : 'disabled'}">
      <label class="dir-toggle">
        <input type="checkbox" ${d.enabled ? 'checked' : ''} onchange="toggleDir('${d.id}')">
        <span class="slider"></span>
      </label>
      <div class="dir-paths">
        <div class="dir-nas">📁 ${escHtml(d.nas)}</div>
        <div class="dir-arrow">↓ → 💻 ${escHtml(d.pc)}</div>
        <div style="margin-top:4px">
          <span class="mode-badge ${modeClass[d.mode]||'mirror'}">${modeLabel[d.mode]||d.mode}</span>
        </div>
      </div>
      <button class="action-btn" onclick="openActionModal('${d.id}')">操作 ▾</button>
    </div>`).join('');
}

async function toggleDir(id) {
  await fetch(`/api/config/dirs/${id}/toggle`, { method: 'PATCH' });
  loadDirs();
}

function openActionModal(id) {
  currentDirId = id;
  const dir = allDirs.find(d => d.id === id);
  if (!dir) return;
  document.getElementById('action-modal-title').textContent = dir.nas;
  document.getElementById('action-modal').classList.add('show');
}

function closeActionModal() {
  document.getElementById('action-modal').classList.remove('show');
  currentDirId = null;
}

async function actionSyncDir() {
  closeActionModal();
  document.getElementById('sync-modal-title').textContent = '同步中...';
  document.getElementById('sync-progress').style.width    = '0%';
  document.getElementById('sync-result').textContent      = '正在发送任务...';
  document.getElementById('sync-modal').classList.add('show');
  let p = 0;
  const t = setInterval(() => { p = Math.min(p+10,90); document.getElementById('sync-progress').style.width=p+'%'; }, 300);
  try {
    const r      = await fetch('/api/sync/start', { method: 'POST' });
    const result = await r.json();
    clearInterval(t);
    document.getElementById('sync-progress').style.width    = '100%';
    document.getElementById('sync-modal-title').textContent = '✅ 同步完成';
    document.getElementById('sync-result').textContent      = `已发送 ${result.sent} 个，跳过 ${result.skipped} 个`;
    loadStatus();
  } catch(e) {
    clearInterval(t);
    document.getElementById('sync-modal-title').textContent = '❌ 失败';
    document.getElementById('sync-result').textContent      = e.message;
  }
}

async function actionShowDiff() {
  const id  = currentDirId;
  const dir = allDirs.find(d => d.id === id);
  closeActionModal();
  if (!dir) return;

  diffDirId = id;
  document.getElementById('diff-modal-title').textContent = `🔍 差异：${dir.nas}`;
  document.getElementById('diff-content').innerHTML =
    '<div style="color:#507090;padding:20px;text-align:center">⏳ 分析中...</div>';
  document.getElementById('diff-modal').classList.add('show');

  try {
    const r    = await fetch('/api/sync/diff/' + id);
    const diff = await r.json();
    if (!diff.ok) {
      document.getElementById('diff-content').innerHTML =
        `<div style="color:#ff5567;padding:20px;text-align:center">❌ ${escHtml(diff.error)}</div>`;
      return;
    }
    const { toSync, updated, toDelete, summary } = diff;
    if (!summary.toSync && !summary.updated && !summary.toDelete) {
      document.getElementById('diff-content').innerHTML =
        '<div style="color:#3ddc84;padding:20px;text-align:center">✅ 无差异</div>';
      return;
    }
    document.getElementById('diff-content').innerHTML =
      `<div style="color:#90b8d8;font-size:.8rem;margin-bottom:12px">
        待同步：${summary.toSync} 个 | 需更新：${summary.updated} 个 | 多余：${summary.toDelete} 个
      </div>` +
      '<div class="diff-list">' +
      toSync.map(f => `<div class="diff-item add"><span>➕</span><span style="flex:1;font-family:monospace;font-size:.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(f.path)}</span></div>`).join('') +
      updated.map(f => `<div class="diff-item update"><span>✏️</span><span style="flex:1;font-family:monospace;font-size:.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(f.path)}</span></div>`).join('') +
      toDelete.map(f => `<div class="diff-item remove"><span>🗑️</span><span style="flex:1;font-family:monospace;font-size:.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(f.path)}</span></div>`).join('') +
      '</div>';
  } catch(e) {
    document.getElementById('diff-content').innerHTML =
      `<div style="color:#ff5567;padding:20px">获取差异失败：${e.message}</div>`;
  }
}

function actionEditDir() {
  const dir = allDirs.find(d => d.id === currentDirId);
  closeActionModal();
  if (!dir) return;
  editingDirId = dir.id;
  document.getElementById('dir-modal-title').textContent = '编辑同步目录';
  document.getElementById('dir-nas').value  = dir.nas;
  document.getElementById('dir-pc').value   = dir.pc;
  document.getElementById('dir-mode').value = dir.mode || 'mirror';
  document.getElementById('dir-modal').classList.add('show');
}

async function actionDeleteDir() {
  const dir = allDirs.find(d => d.id === currentDirId);
  closeActionModal();
  if (!dir) return;
  if (!confirm(`确认删除：${dir.nas}？`)) return;
  await fetch(`/api/config/dirs/${dir.id}`, { method: 'DELETE' });
  loadDirs();
  showToast('已删除', 'success');
}

async function syncAll() {
  document.getElementById('sync-modal-title').textContent = '全部同步中...';
  document.getElementById('sync-progress').style.width    = '0%';
  document.getElementById('sync-result').textContent      = '正在同步所有目录...';
  document.getElementById('sync-modal').classList.add('show');
  let p = 0;
  const t = setInterval(() => { p = Math.min(p+5,90); document.getElementById('sync-progress').style.width=p+'%'; }, 500);
  try {
    const r      = await fetch('/api/sync/start', { method: 'POST' });
    const result = await r.json();
    clearInterval(t);
    document.getElementById('sync-progress').style.width    = '100%';
    document.getElementById('sync-modal-title').textContent = '✅ 全部同步完成';
    document.getElementById('sync-result').textContent      = `已发送 ${result.sent} 个，跳过 ${result.skipped} 个`;
    loadStatus();
  } catch(e) {
    clearInterval(t);
    document.getElementById('sync-modal-title').textContent = '❌ 失败';
    document.getElementById('sync-result').textContent      = e.message;
  }
}

function closeSyncModal() { document.getElementById('sync-modal').classList.remove('show'); }

function closeDiffModal() {
  document.getElementById('diff-modal').classList.remove('show');
  diffDirId = null;
}

async function syncFromDiff() {
  const id = diffDirId;
  closeDiffModal();

  document.getElementById('sync-modal-title').textContent = '同步中...';
  document.getElementById('sync-progress').style.width    = '0%';
  document.getElementById('sync-result').textContent      = '正在发送任务...';
  document.getElementById('sync-modal').classList.add('show');

  let p = 0;
  const t = setInterval(() => { p = Math.min(p+10,90); document.getElementById('sync-progress').style.width=p+'%'; }, 300);

  try {
    const url    = id ? '/api/sync/sync-diff/' + id : '/api/sync/start';
    const r      = await fetch(url, { method: 'POST' });
    const result = await r.json();
    clearInterval(t);
    document.getElementById('sync-progress').style.width    = '100%';
    document.getElementById('sync-modal-title').textContent = result.ok !== false ? '✅ 同步完成' : '❌ 失败';
    document.getElementById('sync-result').textContent      = result.ok !== false
      ? `已发送 ${result.sent||0} 个任务` : result.error;
  } catch(e) {
    clearInterval(t);
    document.getElementById('sync-modal-title').textContent = '❌ 失败';
    document.getElementById('sync-result').textContent      = e.message;
  }
}

function openAddDirModal() {
  editingDirId = null;
  document.getElementById('dir-modal-title').textContent = '添加同步目录';
  document.getElementById('dir-nas').value  = '';
  document.getElementById('dir-pc').value   = '';
  document.getElementById('dir-mode').value = 'mirror';
  document.getElementById('dir-modal').classList.add('show');
}

function closeDirModal() { document.getElementById('dir-modal').classList.remove('show'); }

async function saveDir() {
  const nas  = document.getElementById('dir-nas').value.trim();
  const pc   = document.getElementById('dir-pc').value.trim();
  const mode = document.getElementById('dir-mode').value;
  if (!nas || !pc) { showToast('请填写完整路径', 'error'); return; }
  if (editingDirId) {
    const dir = allDirs.find(d => d.id === editingDirId);
    await fetch(`/api/config/dirs/${editingDirId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nas, pc, mode, enabled: dir?.enabled ?? true }),
    });
  } else {
    await fetch('/api/config/dirs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nas, pc, mode }),
    });
  }
  closeDirModal();
  loadDirs();
  showToast('已保存', 'success');
}

async function loadFilters() {
  const r = await fetch('/api/config/filters');
  filters = await r.json();
  renderTags('ext-tags',  filters.excludeExt  || []);
  renderTags('dir-tags',  filters.excludeDir  || []);
  renderTags('glob-tags', filters.excludeGlob || []);
  document.getElementById('min-size').value = Math.round((filters.minSize || 0) / 1024 / 1024);
  document.getElementById('max-size').value = Math.round((filters.maxSize || 524288000) / 1024 / 1024);
}

function renderTags(containerId, items) {
  document.getElementById(containerId).innerHTML = items.map(item => `
    <div class="tag">${escHtml(item)}<span class="del" onclick="removeTag('${containerId}','${escJs(item)}')">✕</span></div>`).join('');
}

function removeTag(containerId, item) {
  const map = { 'ext-tags':'excludeExt', 'dir-tags':'excludeDir', 'glob-tags':'excludeGlob' };
  filters[map[containerId]] = (filters[map[containerId]] || []).filter(i => i !== item);
  renderTags(containerId, filters[map[containerId]]);
}

function addTag(containerId, inputId) {
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  if (!value) return;
  const map = { 'ext-tags':'excludeExt', 'dir-tags':'excludeDir', 'glob-tags':'excludeGlob' };
  const key = map[containerId];
  if (!filters[key]) filters[key] = [];
  if (!filters[key].includes(value)) { filters[key].push(value); renderTags(containerId, filters[key]); }
  input.value = '';
}

async function saveFilters() {
  filters.minSize = (parseInt(document.getElementById('min-size').value) || 0) * 1024 * 1024;
  filters.maxSize = (parseInt(document.getElementById('max-size').value) || 500) * 1024 * 1024;
  await fetch('/api/config/filters', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filters),
  });
  showToast('过滤规则已保存', 'success');
}

async function loadLogs(containerId = 'log-list') {
  const q    = document.getElementById('log-search')?.value || '';
  const url  = logFilter === 'all' ? `/api/log?q=${q}` : `/api/log?event=${logFilter}&q=${q}`;
  const r    = await fetch(url);
  const logs = await r.json();
  const list = document.getElementById(containerId);
  if (!list) return;
  const icons = { create:'➕', modify:'✏️', move:'🔀', delete:'🗑️' };
  list.innerHTML = logs.length
    ? logs.map(l => `<div class="log-item">
        <div class="log-event">${icons[l.event]||'📄'}</div>
        <div class="log-path" title="${escHtml(l.path)}">${escHtml(l.path)}</div>
        <div class="log-status ${l.status}">${l.status}</div>
        <div class="log-time">${new Date(l.time).toLocaleTimeString('ja-JP')}</div>
      </div>`).join('')
    : '<div class="log-empty">暂无变更记录</div>';
}

function setLogFilter(type, el) {
  logFilter = type;
  document.querySelectorAll('.log-filter').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  loadLogs('log-list');
}

async function clearLogs() {
  if (!confirm('确认清空所有日志？')) return;
  await fetch('/api/log', { method: 'DELETE' });
  loadLogs('log-list');
  showToast('日志已清空', 'success');
}

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escJs(s)   { return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }
function showToast(msg, type='success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', init);
