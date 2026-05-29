/**
 * NAS Sync 前端逻辑
 * 支持：单目录操作、批量同步、查看差异、弹出层操作
 */

let logFilter    = 'all';
let editingDirId = null;
let diffDirId    = null;
let filters      = {};

// ── 初始化 ────────────────────────────────────────────
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

// ── 状态 ──────────────────────────────────────────────
async function loadStatus() {
  try {
    const r = await fetch('/api/sync/status');
    const s = await r.json();
    document.getElementById('pc-status').textContent  = s.online ? '🟢 在线' : '🔴 离线';
    document.getElementById('pc-status').className    = 'stat-value ' + (s.online ? 'online' : 'offline');
    document.getElementById('pending-count').textContent = s.pendingCount || 0;
    document.getElementById('last-sync').textContent  = s.lastSync
      ? new Date(s.lastSync).toLocaleString('ja-JP') : '从未同步';
  } catch(e) {}
}

// ── 目录列表 ──────────────────────────────────────────
async function loadDirs() {
  const r    = await fetch('/api/config/dirs');
  const dirs = await r.json();
  const list = document.getElementById('dir-list');

  const modeLabel = { mirror:'单向镜像', bidirectional:'双向同步', addonly:'仅新增' };
  const modeClass = { mirror:'mirror',   bidirectional:'bidirectional', addonly:'addonly' };

  list.innerHTML = dirs.map(d => `
    <div class="dir-item ${d.enabled ? '' : 'disabled'}" id="dir-${d.id}">
      <label class="dir-toggle">
        <input type="checkbox" ${d.enabled ? 'checked' : ''} onchange="toggleDir('${d.id}')">
        <span class="slider"></span>
      </label>
      <div class="dir-paths">
        <div class="dir-nas">📁 ${escHtml(d.nas)}</div>
        <div class="dir-arrow">↓ → 💻 ${escHtml(d.pc)}</div>
        <div style="margin-top:4px">
          <span class="mode-badge ${modeClass[d.mode]}">${modeLabel[d.mode]||d.mode}</span>
        </div>
      </div>
      <div class="action-menu" id="menu-wrap-${d.id}">
        <button class="action-btn" onclick="toggleMenu('${d.id}')">操作 ▾</button>
        <div class="dropdown" id="menu-${d.id}">
          <div class="dropdown-item" onclick="syncDir('${d.id}');closeMenu('${d.id}')">▶️ 立即同步</div>
          <div class="dropdown-item" onclick="showDiff('${d.id}','${escJs(d.nas)}');closeMenu('${d.id}')">🔍 查看差异</div>
          <div class="dropdown-divider"></div>
          <div class="dropdown-item" onclick="editDir('${d.id}','${escJs(d.nas)}','${escJs(d.pc)}','${d.mode}');closeMenu('${d.id}')">✏️ 编辑</div>
          <div class="dropdown-item danger" onclick="deleteDir('${d.id}');closeMenu('${d.id}')">❌ 删除</div>
        </div>
      </div>
    </div>`).join('');
}

function toggleMenu(id) {
  document.querySelectorAll('.dropdown').forEach(d => {
    if (d.id !== 'menu-' + id) d.classList.remove('show');
  });
  document.getElementById('menu-' + id)?.classList.toggle('show');
}

function closeMenu(id) {
  document.getElementById('menu-' + id)?.classList.remove('show');
}

// 点击其他地方关闭菜单
document.addEventListener('click', (e) => {
  if (!e.target.closest('.action-menu')) {
    document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('show'));
  }
});

async function toggleDir(id) {
  await fetch(`/api/config/dirs/${id}/toggle`, { method: 'PATCH' });
  loadDirs();
}

async function deleteDir(id) {
  if (!confirm('确认删除此同步目录？')) return;
  await fetch(`/api/config/dirs/${id}`, { method: 'DELETE' });
  loadDirs();
  showToast('已删除', 'success');
}

// ── 单目录同步 ────────────────────────────────────────
async function syncDir(id) {
  document.getElementById('sync-modal-title').textContent = '同步中...';
  document.getElementById('sync-progress').style.width    = '0%';
  document.getElementById('sync-result').textContent      = '正在发送任务...';
  document.getElementById('sync-modal').classList.add('show');

  // 进度动画
  let progress = 0;
  const timer  = setInterval(() => {
    progress = Math.min(progress + 10, 90);
    document.getElementById('sync-progress').style.width = progress + '%';
  }, 300);

  try {
    const r      = await fetch('/api/sync/start', { method: 'POST' });
    const result = await r.json();
    clearInterval(timer);
    document.getElementById('sync-progress').style.width = '100%';
    document.getElementById('sync-modal-title').textContent = '✅ 同步完成';
    document.getElementById('sync-result').textContent =
      `已发送 ${result.sent} 个任务，跳过 ${result.skipped} 个`;
    loadStatus();
    loadLogs('log-list-status');
  } catch(e) {
    clearInterval(timer);
    document.getElementById('sync-modal-title').textContent = '❌ 同步失败';
    document.getElementById('sync-result').textContent = e.message;
  }
}

function closeSyncModal() {
  document.getElementById('sync-modal').classList.remove('show');
}

// ── 全部同步 ──────────────────────────────────────────
async function syncAll() {
  document.getElementById('sync-modal-title').textContent = '全部同步中...';
  document.getElementById('sync-progress').style.width    = '0%';
  document.getElementById('sync-result').textContent      = '正在同步所有目录...';
  document.getElementById('sync-modal').classList.add('show');

  let progress = 0;
  const timer  = setInterval(() => {
    progress = Math.min(progress + 5, 90);
    document.getElementById('sync-progress').style.width = progress + '%';
  }, 500);

  try {
    const r      = await fetch('/api/sync/start', { method: 'POST' });
    const result = await r.json();
    clearInterval(timer);
    document.getElementById('sync-progress').style.width    = '100%';
    document.getElementById('sync-modal-title').textContent = '✅ 全部同步完成';
    document.getElementById('sync-result').textContent =
      `已发送 ${result.sent} 个，跳过 ${result.skipped} 个`;
    loadStatus();
  } catch(e) {
    clearInterval(timer);
    document.getElementById('sync-modal-title').textContent = '❌ 失败';
    document.getElementById('sync-result').textContent = e.message;
  }
}

// ── 查看差异 ──────────────────────────────────────────
async function showDiff(id, nas) {
  diffDirId = id;
  document.getElementById("diff-modal-title").textContent = "🔍 差異：" + nas;
  document.getElementById("diff-content").innerHTML = "<div style=\"color:#507090;padding:20px;text-align:center\">⏳ 分析中...</div>";
  document.getElementById("diff-modal").classList.add("show");
  try {
    const r    = await fetch("/api/sync/diff/" + id);
    const diff = await r.json();
    if (!diff.ok) {
      document.getElementById("diff-content").innerHTML = "<div style=\"color:#ff5567;padding:20px;text-align:center\">❌ " + escHtml(diff.error) + "</div>";
      return;
    }
    const { toSync, updated, toDelete, summary } = diff;
    if (!summary.toSync && !summary.updated && !summary.toDelete) {
      document.getElementById("diff-content").innerHTML = "<div style=\"color:#3ddc84;padding:20px;text-align:center\">✅ 无差异</div>";
      return;
    }
    document.getElementById("diff-content").innerHTML =
      "<div style=\"color:#90b8d8;font-size:.8rem;margin-bottom:12px\">待同步：" + summary.toSync + " 个 | 需更新：" + summary.updated + " 个 | 多余：" + summary.toDelete + " 个</div>" +
      "<div class=\"diff-list\">" +
      toSync.map(f => "<div class=\"diff-item add\"><span>➕</span><span style=\"flex:1;font-family:monospace;font-size:.75rem\">" + escHtml(f.path) + "</span></div>").join("") +
      updated.map(f => "<div class=\"diff-item update\"><span>✏️</span><span style=\"flex:1;font-family:monospace;font-size:.75rem\">" + escHtml(f.path) + "</span></div>").join("") +
      toDelete.map(f => "<div class=\"diff-item remove\"><span>🗑️</span><span style=\"flex:1;font-family:monospace;font-size:.75rem\">" + escHtml(f.path) + "</span></div>").join("") +
      "</div>";
  } catch(e) {
    document.getElementById("diff-content").innerHTML = "<div style=\"color:#ff5567;padding:20px\">获取差异失败：" + e.message + "</div>";
  }
}
function closeDiffModal() {
  document.getElementById('diff-modal').classList.remove('show');
}

// ── 添加/编辑 Modal ───────────────────────────────────
function openAddDirModal() {
  editingDirId = null;
  document.getElementById('dir-modal-title').textContent = '添加同步目录';
  document.getElementById('dir-nas').value  = '';
  document.getElementById('dir-pc').value   = '';
  document.getElementById('dir-mode').value = 'mirror';
  document.getElementById('dir-modal').classList.add('show');
}

function editDir(id, nas, pc, mode) {
  editingDirId = id;
  document.getElementById('dir-modal-title').textContent = '编辑同步目录';
  document.getElementById('dir-nas').value  = nas;
  document.getElementById('dir-pc').value   = pc;
  document.getElementById('dir-mode').value = mode || 'mirror';
  document.getElementById('dir-modal').classList.add('show');
}

function closeDirModal() {
  document.getElementById('dir-modal').classList.remove('show');
}

async function saveDir() {
  const nas  = document.getElementById('dir-nas').value.trim();
  const pc   = document.getElementById('dir-pc').value.trim();
  const mode = document.getElementById('dir-mode').value;
  if (!nas || !pc) { showToast('请填写完整路径', 'error'); return; }

  if (editingDirId) {
    const dirs = await (await fetch('/api/config/dirs')).json();
    const dir  = dirs.find(d => d.id === editingDirId);
    await fetch(`/api/config/dirs/${editingDirId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ nas, pc, mode, enabled: dir?.enabled ?? true }),
    });
  } else {
    await fetch('/api/config/dirs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ nas, pc, mode }),
    });
  }

  closeDirModal();
  loadDirs();
  showToast('已保存', 'success');
}

// ── 过滤规则 ──────────────────────────────────────────
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
    <div class="tag">
      ${escHtml(item)}
      <span class="del" onclick="removeTag('${containerId}','${escJs(item)}')">✕</span>
    </div>`).join('');
}

function removeTag(containerId, item) {
  const map = { 'ext-tags':'excludeExt', 'dir-tags':'excludeDir', 'glob-tags':'excludeGlob' };
  const key = map[containerId];
  filters[key] = (filters[key] || []).filter(i => i !== item);
  renderTags(containerId, filters[key]);
}

function addTag(containerId, inputId) {
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  if (!value) return;
  const map = { 'ext-tags':'excludeExt', 'dir-tags':'excludeDir', 'glob-tags':'excludeGlob' };
  const key = map[containerId];
  if (!filters[key]) filters[key] = [];
  if (!filters[key].includes(value)) {
    filters[key].push(value);
    renderTags(containerId, filters[key]);
  }
  input.value = '';
}

async function saveFilters() {
  filters.minSize = (parseInt(document.getElementById('min-size').value) || 0) * 1024 * 1024;
  filters.maxSize = (parseInt(document.getElementById('max-size').value) || 500) * 1024 * 1024;
  await fetch('/api/config/filters', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(filters),
  });
  showToast('过滤规则已保存', 'success');
}

// ── 日志 ──────────────────────────────────────────────
async function loadLogs(containerId = 'log-list') {
  const q   = document.getElementById('log-search')?.value || '';
  const url = logFilter === 'all' ? `/api/log?q=${q}` : `/api/log?event=${logFilter}&q=${q}`;
  const r   = await fetch(url);
  const logs = await r.json();
  const list = document.getElementById(containerId);
  if (!list) return;

  const icons = { create:'➕', modify:'✏️', move:'🔀', delete:'🗑️' };
  if (!logs.length) {
    list.innerHTML = '<div class="log-empty">暂无变更记录</div>';
    return;
  }
  list.innerHTML = logs.map(l => `
    <div class="log-item">
      <div class="log-event">${icons[l.event]||'📄'}</div>
      <div class="log-path" title="${escHtml(l.path)}">${escHtml(l.path)}</div>
      <div class="log-status ${l.status}">${l.status}</div>
      <div class="log-time">${new Date(l.time).toLocaleTimeString('ja-JP')}</div>
    </div>`).join('');
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

// ── 工具 ──────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escJs(s) {
  return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className   = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', init);
