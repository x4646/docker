/**
 * NAS Dashboard 主逻辑
 * 按钮面板（可拖拽排序）+ 管理页 + Emoji选择器
 */

let buttons      = [];
let modules      = [];
let emojis       = {};
let editingId    = null;
let dragSrcId    = null;
let panelDragSrc = null;
let isDragging   = false;
let currentEmojiTab = '';

// ── 顶部通知管理 ──────────────────────────────────────
const notifications = new Map();

function notify(id, icon, name, status) {
  const bar   = document.getElementById('notify-bar');
  const items = document.getElementById('notify-items');

  notifications.set(id, { icon, name, status });

  // 重新渲染所有通知
  items.innerHTML = Array.from(notifications.entries()).map(([nid, n]) => `
    <div class="notify-item ${n.status}" id="notify-${nid}">
      ${n.status === 'running' ? '⏳' : n.status === 'success' ? '✅' : '❌'}
      ${n.icon} ${n.name}
      ${n.status !== 'running' ? `<span onclick="dismissNotify('${nid}')" style="cursor:pointer;margin-left:4px;opacity:.6">✕</span>` : ''}
    </div>`).join('');

  bar.style.display = notifications.size ? 'flex' : 'none';

  // 成功/失败5秒后自动消失
  if (status !== 'running') {
    setTimeout(() => dismissNotify(id), 5000);
  }
}

function dismissNotify(id) {
  notifications.delete(id);
  const bar   = document.getElementById('notify-bar');
  const items = document.getElementById('notify-items');
  items.innerHTML = Array.from(notifications.entries()).map(([nid, n]) => `
    <div class="notify-item ${n.status}" id="notify-${nid}">
      ${n.status === 'running' ? '⏳' : n.status === 'success' ? '✅' : '❌'}
      ${n.icon} ${n.name}
      ${n.status !== 'running' ? `<span onclick="dismissNotify('${nid}')" style="cursor:pointer;margin-left:4px;opacity:.6">✕</span>` : ''}
    </div>`).join('');
  bar.style.display = notifications.size ? 'flex' : 'none';
}

// ── 初始化 ────────────────────────────────────────────
async function init() {
  await Promise.all([loadButtons(), loadModules(), loadEmojis()]);
  renderPanel();
  renderAdminList();
}

async function loadButtons() {
  const r = await fetch('/api/buttons');
  buttons = await r.json();
  buttons.sort((a, b) => (a.order || 0) - (b.order || 0));
}

async function loadModules() {
  const r = await fetch('/api/modules');
  modules = await r.json();
}

async function loadEmojis() {
  const r = await fetch('/emojis.json');
  emojis  = await r.json();
}

// ── 页面切换 ──────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('page-' + tab).style.display = 'block';
}

// ── 渲染按钮面板 ──────────────────────────────────────
function renderPanel() {
  const grid = document.getElementById('btn-grid');
  grid.innerHTML = buttons.map(btn => `
    <div class="dash-btn"
      id="btn-${btn.id}"
      draggable="true"
      ondragstart="onPanelDragStart(event,'${btn.id}')"
      ondragover="onPanelDragOver(event,'${btn.id}')"
      ondragleave="onPanelDragLeave(event,'${btn.id}')"
      ondrop="onPanelDrop(event,'${btn.id}')"
      ondragend="onPanelDragEnd()"
      onclick="executeBtn('${btn.id}')">
      <div class="btn-spinner"></div>
      <div class="btn-icon">${btn.icon || '⚙️'}</div>
      <div class="btn-name">${btn.name}</div>
    </div>`).join('');
}

// ── 面板拖拽 ──────────────────────────────────────────
function onPanelDragStart(e, id) {
  panelDragSrc = id; isDragging = true;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => document.getElementById('btn-' + id)?.classList.add('dragging'), 0);
}
function onPanelDragOver(e, id) {
  e.preventDefault();
  if (id !== panelDragSrc) document.getElementById('btn-' + id)?.classList.add('drag-over');
}
function onPanelDragLeave(e, id) {
  document.getElementById('btn-' + id)?.classList.remove('drag-over');
}
function onPanelDrop(e, targetId) {
  e.preventDefault(); e.stopPropagation();
  isDragging = false;
  document.getElementById('btn-' + targetId)?.classList.remove('drag-over');
  if (!panelDragSrc || panelDragSrc === targetId) return;
  const srcIdx = buttons.findIndex(b => b.id === panelDragSrc);
  const tgtIdx = buttons.findIndex(b => b.id === targetId);
  const [moved] = buttons.splice(srcIdx, 1);
  buttons.splice(tgtIdx, 0, moved);
  buttons.forEach((b, i) => b.order = i);
  saveOrder(); renderPanel(); renderAdminList();
}
function onPanelDragEnd() {
  isDragging = false;
  document.querySelectorAll('.dash-btn').forEach(el => el.classList.remove('dragging','drag-over'));
  panelDragSrc = null;
}

// ── 执行按钮 ──────────────────────────────────────────
async function executeBtn(id) {
  if (isDragging) return;
  const el  = document.getElementById('btn-' + id);
  const btn = buttons.find(b => b.id === id);
  if (!btn || !el) return;

  el.classList.add('loading');
  showResultLoading(btn.name);
  notify(id, btn.icon, btn.name, 'running');  // ← 加这行

  try {
    const r      = await fetch(`/api/execute/${id}`, { method: 'POST' });
    const result = await r.json();
    showResult(btn, result);
    // 根据结果更新通知
    notify(id, btn.icon, btn.name, result.type === 'error' ? 'error' : 'success');  // ← 加这行
  } catch(e) {
    showResult(btn, { type: 'error', data: e.message });
    notify(id, btn.icon, btn.name, 'error');  // ← 加这行
  } finally {
    el.classList.remove('loading');
  }
}

// ── 显示结果 ──────────────────────────────────────────
function showResultLoading(name) {
  document.getElementById('result-area').innerHTML = `
    <div class="result-title">⏳ ${name} 执行中...</div>
    <div class="result-empty">请稍等...</div>`;
}

function showResult(btn, result) {
  const area = document.getElementById('result-area');
  if (result.type === 'url') {
    window.open(result.data, '_blank');
    area.innerHTML = `<div class="result-title">🔗 已打开</div>
      <div class="result-empty"><a href="${result.data}" target="_blank" style="color:#40d0ff">${result.data}</a></div>`;
    return;
  }
  if (result.type === 'toast') {
        showToast(result.data, 'success');
        area.innerHTML = `<div class="result-title">✅ ${btn.name}</div><div class="result-empty">${result.data}</div>`;
        // 如果是重启自身，等待重新上线
        if (btn.command && btn.command.includes('restart-nas-dashboard')) {
          notify(btn.id, btn.icon, btn.name, 'running');
          waitForRestart(btn);
        }
        return;
  }
  if (result.type === 'error') {
    showToast(result.data, 'error');
    area.innerHTML = `<div class="result-title">❌ ${btn.name}</div><div class="result-text" style="color:#ff5567">${result.data}</div>`;
    return;
  }
  let content = '';
  if (result.type === 'text') {
      const html = escHtml(result.data).replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" style="color:#40d0ff">$1</a>'
      );
      content = `<div class="result-text">${html}</div>`;
  }
  if (result.type === 'table' && Array.isArray(result.data) && result.data.length) {
    const keys = Object.keys(result.data[0]);
    content = `<table class="result-table">
      <thead><tr>${keys.map(k => `<th>${k}</th>`).join('')}</tr></thead>
      <tbody>${result.data.map(row =>
        `<tr>${keys.map(k => `<td>${escHtml(String(row[k]??'-'))}</td>`).join('')}</tr>`
      ).join('')}</tbody></table>`;
  }
  if (result.type === 'card' && typeof result.data === 'object') {
    content = `<div class="result-card">${Object.entries(result.data).map(([k,v]) => `
      <div class="result-card-item">
        <div class="result-card-label">${k}</div>
        <div class="result-card-value">${escHtml(String(v))}</div>
      </div>`).join('')}</div>`;
  }
  const title = result.title ? `${btn.name} — ${result.title}` : btn.name;
  area.innerHTML = `<div class="result-title">${btn.icon} ${title}</div>${content}`;
}

// ── 管理页 ────────────────────────────────────────────
function renderAdminList() {
  const list = document.getElementById('btn-list');
  list.innerHTML = buttons.map(btn => `
    <div class="btn-item" id="item-${btn.id}" draggable="true"
      ondragstart="onDragStart(event,'${btn.id}')"
      ondragover="onDragOver(event,'${btn.id}')"
      ondragleave="onDragLeave(event,'${btn.id}')"
      ondrop="onDrop(event,'${btn.id}')"
      ondragend="onDragEnd()">
      <div class="drag-handle">⠿</div>
      <div class="btn-item-icon">${btn.icon||'⚙️'}</div>
      <div class="btn-item-info">
        <div class="btn-item-name">${btn.name}</div>
        <div class="btn-item-desc">${btn.type==='ssh'?'🖥 '+btn.command:'📦 '+(btn.module||'-')}</div>
      </div>
      <div class="btn-item-actions">
        <button class="btn-sm" onclick="editBtn('${btn.id}')">编辑</button>
        <button class="btn-sm danger" onclick="deleteBtn('${btn.id}')">删除</button>
      </div>
    </div>`).join('');
}

function onDragStart(e, id) {
  dragSrcId = id;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => document.getElementById('item-' + id)?.classList.add('dragging'), 0);
}
function onDragOver(e, id) {
  e.preventDefault();
  if (id !== dragSrcId) document.getElementById('item-' + id)?.classList.add('drag-over');
}
function onDragLeave(e, id) {
  document.getElementById('item-' + id)?.classList.remove('drag-over');
}
function onDrop(e, targetId) {
  e.preventDefault();
  document.getElementById('item-' + targetId)?.classList.remove('drag-over');
  if (!dragSrcId || dragSrcId === targetId) return;
  const srcIdx = buttons.findIndex(b => b.id === dragSrcId);
  const tgtIdx = buttons.findIndex(b => b.id === targetId);
  const [moved] = buttons.splice(srcIdx, 1);
  buttons.splice(tgtIdx, 0, moved);
  buttons.forEach((b, i) => b.order = i);
  saveOrder(); renderAdminList(); renderPanel();
}
function onDragEnd() {
  document.querySelectorAll('.btn-item').forEach(el => el.classList.remove('dragging','drag-over'));
  dragSrcId = null;
}

async function saveOrder() {
  await fetch('/api/buttons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buttons),
  });
}

// ── Emoji选择器 ───────────────────────────────────────
function toggleEmojiPicker() {
  const picker  = document.getElementById('emoji-picker');
  const overlay = document.getElementById('emoji-overlay');
  const isShow  = picker.classList.contains('show');
  if (isShow) {
    closeEmojiPicker();
  } else {
    renderEmojiTabs();
    picker.classList.add('show');
    overlay.classList.add('show');
    document.getElementById('emoji-search').value = '';
    document.getElementById('emoji-search').focus();
  }
}

function closeEmojiPicker() {
  document.getElementById('emoji-picker').classList.remove('show');
  document.getElementById('emoji-overlay').classList.remove('show');
}

function renderEmojiTabs() {
  const tabs = document.getElementById('emoji-tabs');
  const cats  = Object.keys(emojis);
  if (!currentEmojiTab) currentEmojiTab = cats[0];

  tabs.innerHTML = cats.map(cat => `
    <button class="emoji-tab ${cat === currentEmojiTab ? 'active' : ''}"
      onclick="selectEmojiTab('${cat}')">${cat}</button>`).join('');

  renderEmojiGrid(emojis[currentEmojiTab] || []);
}

function selectEmojiTab(cat) {
  currentEmojiTab = cat;
  document.querySelectorAll('.emoji-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  renderEmojiGrid(emojis[cat] || []);
  document.getElementById('emoji-search').value = '';
}

function renderEmojiGrid(list) {
  document.getElementById('emoji-grid').innerHTML = list.map(e => `
    <div class="emoji-item" onclick="selectEmoji('${e}')">${e}</div>`).join('');
}

function selectEmoji(emoji) {
  document.getElementById('form-icon').value      = emoji;
  document.getElementById('icon-preview').textContent = emoji;
  closeEmojiPicker();
}

function filterEmoji() {
  const q   = document.getElementById('emoji-search').value.trim();
  const all = Object.values(emojis).flat();
  renderEmojiGrid(q ? all : (emojis[currentEmojiTab] || []));
}

// ── Modal ─────────────────────────────────────────────
function openAddModal() {
  editingId = null;
  document.getElementById('modal-title').textContent   = '添加功能按钮';
  document.getElementById('form-name').value           = '';
  document.getElementById('form-icon').value           = '⚙️';
  document.getElementById('icon-preview').textContent  = '⚙️';
  document.getElementById('form-type').value           = 'module';
  document.getElementById('form-command').value        = '';
  document.getElementById('form-display').value        = 'table';
  renderModuleSelect('');
  onTypeChange();
  document.getElementById('modal').classList.add('show');
}

function editBtn(id) {
  const btn = buttons.find(b => b.id === id);
  if (!btn) return;
  editingId = id;
  document.getElementById('modal-title').textContent   = '编辑功能按钮';
  document.getElementById('form-name').value           = btn.name;
  document.getElementById('form-icon').value           = btn.icon || '⚙️';
  document.getElementById('icon-preview').textContent  = btn.icon || '⚙️';
  document.getElementById('form-type').value           = btn.type;
  document.getElementById('form-command').value        = btn.command || '';
  document.getElementById('form-display').value        = btn.display || 'table';
  renderModuleSelect(btn.module || '');
  onTypeChange();
  document.getElementById('modal').classList.add('show');
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

function onTypeChange() {
  const type = document.getElementById('form-type').value;
  document.getElementById('ssh-params').classList.toggle('show', type === 'ssh');
  document.getElementById('module-params').classList.toggle('show', type === 'module');
}

function renderModuleSelect(selected) {
  document.getElementById('form-module').innerHTML = modules.map(m =>
    `<option value="${m.key}" ${m.key===selected?'selected':''}>${m.icon} ${m.name}</option>`
  ).join('');
}

async function saveBtn() {
  const name    = document.getElementById('form-name').value.trim();
  const icon    = document.getElementById('form-icon').value.trim();
  const type    = document.getElementById('form-type').value;
  const display = document.getElementById('form-display').value;

  if (!name) { showToast('请输入按钮名称', 'error'); return; }

  const btn = {
    id:    editingId || String(Date.now()),
    name, icon, type, display,
    order: editingId ? buttons.find(b=>b.id===editingId)?.order : buttons.length,
  };

  if (type === 'ssh') {
    btn.command = document.getElementById('form-command').value.trim();
    if (!btn.command) { showToast('请输入命令', 'error'); return; }
  }
  if (type === 'module') {
    btn.module = document.getElementById('form-module').value;
    btn.params = {};
  }

  if (editingId) {
    buttons[buttons.findIndex(b=>b.id===editingId)] = btn;
  } else {
    buttons.push(btn);
  }

  await fetch('/api/buttons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buttons),
  });

  closeModal();
  renderPanel();
  renderAdminList();
  showToast(editingId ? '已更新' : '已添加', 'success');
}

async function deleteBtn(id) {
  if (!confirm('确认删除？')) return;
  buttons = buttons.filter(b => b.id !== id);
  await fetch('/api/buttons', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buttons),
  });
  renderPanel(); renderAdminList();
  showToast('已删除', 'success');
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showToast(msg, type='success') {
  const t = document.createElement('div');
  t.className   = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

async function waitForRestart(btn) {
  await new Promise(r => setTimeout(r, 3000)); // 等3秒
  let tries = 0;
  while (tries < 20) {
    try {
      const r = await fetch('/api/buttons');
      if (r.ok) {
        notify(btn.id, btn.icon, btn.name, 'success');
        showToast('✅ 控制面板已重启', 'success');
        return;
      }
    } catch(e) {}
    await new Promise(r => setTimeout(r, 1000));
    tries++;
  }
  notify(btn.id, btn.icon, btn.name, 'error');
}

document.addEventListener('DOMContentLoaded', init);
