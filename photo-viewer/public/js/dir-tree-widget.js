// ── 通用目录树控件（viewer + 管理页共用，纯控件+全注入） ──────────────
// 基本功能(内核): 异步懒加载、展开/收起、竖线层级、节点渲染、单节点刷新、事件委托
// 扩展功能(注入): rootsFn / childrenFn / statFn / renderStat / onSelect / contextMenu / rowActions / mode / icons
class DirTreeWidget {
  constructor(opt = {}) {
    this.container = typeof opt.container === 'string' ? document.getElementById(opt.container) : opt.container;
    this.source   = opt.source || 'nas';
    this.mode     = opt.mode   || 'single';
    this.instanceId = opt.instanceId || this.source; // 多实例隔离(同页面PC+NAS共存时id不冲突)

    // ── 注入点 ──
    this.rootsFn      = opt.rootsFn      || null;  // () => [{name,path}]
    this.childrenFn   = opt.childrenFn   || null;  // (path) => [{name,path}]
    this.statFn       = opt.statFn       || null;  // (path) => statObj  (传null禁用统计)
    this.renderStat   = opt.renderStat   || null;  // (statObj) => htmlString
    this.onSelect     = opt.onSelect     || (() => {});
    this.contextMenu  = opt.contextMenu  || null;  // [{label,icon,color,action(path,node)}] 或 (path)=>[...]
    this.rowActions   = opt.rowActions   || opt.actions || []; // [{label,icon,color,fn(path)}]
    this.icons        = opt.icons        || {};    // {root, child} 自定义图标
    this.showRefresh  = opt.showRefresh !== false; // 默认显示行刷新按钮

    this.selected = null;
  }

  // ── 默认数据源(注入未提供时回退到这些) ──
  async _fetchChildren(path) {
    if (this.childrenFn) return await this.childrenFn(path);
    return await fetch(`/api/dir-tree?source=${this.source}&path=${encodeURIComponent(path)}`).then(r => r.json());
  }
  async _fetchRoots() {
    if (this.rootsFn) return await this.rootsFn();
    return await fetch(`/api/dir-tree?source=${this.source}`).then(r => r.json());
  }
  async _fetchStat(path) {
    if (this.statFn === null && this.hasOwnProperty('statFn') && this.statFn === null) {} // noop
    if (this.statFn) return await this.statFn(path);
    return await fetch(`/api/dir-stat?source=${this.source}&path=${encodeURIComponent(path)}`).then(r => r.json());
  }
  _defaultRenderStat(st) {
    if (!st) return '';
    if (st.inDb) {
      const total = st.dbTotal||0, done = st.done||0, pend = st.pending||0, err = st.error||0;
      let html = `总${total} <span style="color:#3ddc84">✅${done}</span> <span style="color:#ffa500">⏳${pend}</span>`;
      if (err > 0) html += ` <span style="color:#ff5567">❌${err}</span>`;
      return html;
    } else if (st.realCount && st.realCount > 0) {
      return `<span style="color:#a78bfa">📥 ${st.realCount}张待入库</span>`;
    } else if (st.realCount === null) {
      return '<span style="color:#507090">未入库</span>';
    }
    return '<span style="color:#507090">空</span>';
  }

  async init() {
    this.container.innerHTML = '<div style="color:#507090;padding:12px">加载中...</div>';
    let roots = [];
    try { roots = await this._fetchRoots(); }
    catch (e) { this.container.innerHTML = '<div style="color:#ff5567;padding:12px">加载失败</div>'; return; }
    if (!Array.isArray(roots) || !roots.length) {
      this.container.innerHTML = '<div style="color:#507090;padding:12px">（空）</div>'; return;
    }
    this.container.innerHTML = roots.map(r => this._rowHtml(r, 0)).join('');
    if (this.statFn !== false) roots.forEach(r => this._loadStat(r.path));
  }

  _nid(path) {
    const fwd = path.replace(/\\/g, '/');
    return 'dt_' + this.instanceId + '_' + btoa(unescape(encodeURIComponent(fwd))).replace(/[^a-zA-Z0-9]/g, '');
  }

  _rowHtml(node, depth) {
    const fwd  = node.path.replace(/\\/g, '/');
    const nid  = this._nid(fwd);
    const esc  = fwd.replace(/'/g, "\\'");
    const isRoot = depth === 0;
    let guides = '';
    for (let i = 0; i < depth; i++) guides += '<span class="pc-guide"></span>';
    const cb = this.mode === 'batch'
      ? `<input type="checkbox" class="dtw-check" value="${fwd}" style="margin-top:4px;flex-shrink:0">` : '';
    const rootIcon  = this.icons.root  || (this.source==='pc'?'💻':'🗄');
    const childIcon = this.icons.child || '📁';
    const icon = isRoot ? rootIcon : childIcon;
    const actBtns = this.rowActions.map((a, i) =>
      `<button class="btn-sm" style="${a.color?`border-color:${a.color};color:${a.color}`:''}" data-act="${i}" data-path="${esc}">${a.icon||''} ${a.label}</button>`
    ).join('');
    const refreshBtn = this.showRefresh ? `<button class="btn-sm" data-rowrefresh="${esc}" title="刷新此目录">🔄</button>` : '';
    const ctxAttr = this.contextMenu ? `data-ctx="${esc}"` : '';
    return `
    <div class="dtw-node" data-path="${fwd}">
      <div class="dtw-row" style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid #1a2433">
        ${guides}
        <span class="pc-toggle" data-toggle="${esc}" data-depth="${depth}" data-loaded="0">+</span>
        ${cb}
        <span class="dtw-name" data-select="${esc}" ${ctxAttr} style="cursor:pointer;font-size:.82rem;color:#c8dff5;flex:1;min-width:0;word-break:break-all">
          ${icon} ${this._esc(node.name)}
          <small class="dtw-stat" id="${nid}_stat" style="color:#507090;margin-left:8px;font-size:.72rem">${this.statFn===false?'':'…'}</small>
        </span>
        <span class="dtw-actions" style="display:flex;gap:5px;flex-shrink:0">
          ${refreshBtn}
          ${actBtns}
        </span>
      </div>
      <div class="dtw-children" id="${nid}_ch" style="display:none"></div>
    </div>`;
  }

  _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  async _loadStat(path) {
    if (this.statFn === false) return; // 显式禁用统计
    const nid = this._nid(path);
    const el = document.getElementById(nid + '_stat');
    if (!el) return;
    try {
      const st = await this._fetchStat(path);
      el.innerHTML = this.renderStat ? this.renderStat(st) : this._defaultRenderStat(st);
    } catch (e) { el.textContent = ''; }
  }

  async _toggle(toggleEl) {
    const path  = toggleEl.dataset.toggle;
    const depth = parseInt(toggleEl.dataset.depth);
    const nid   = this._nid(path);
    const ch    = document.getElementById(nid + '_ch');
    if (!ch) return;
    if (ch.style.display === 'none') {
      if (toggleEl.dataset.loaded === '0') {
        toggleEl.textContent = '·';
        let kids = [];
        try { kids = await this._fetchChildren(path); } catch (e) {}
        if (Array.isArray(kids) && kids.length) {
          ch.innerHTML = kids.map(k => this._rowHtml(k, depth + 1)).join('');
          kids.forEach(k => this._loadStat(k.path));
        } else {
          ch.innerHTML = `<div style="color:#507090;font-size:.7rem;padding:3px 0 3px ${(depth+1)*18}px">（无子目录）</div>`;
        }
        toggleEl.dataset.loaded = '1';
      }
      ch.style.display = 'block';
      toggleEl.textContent = '−';
    } else {
      ch.style.display = 'none';
      toggleEl.textContent = '+';
    }
  }

  _select(path, nameEl) {
    this.selected = path;
    this.container.querySelectorAll('.dtw-name').forEach(el => el.style.background = 'transparent');
    nameEl.style.background = 'rgba(64,208,255,.18)';
    this.onSelect(path);
  }

  _showContextMenu(e, path) {
    e.preventDefault();
    document.querySelectorAll('.dtw-ctx-menu').forEach(el => el.remove());
    let items = typeof this.contextMenu === 'function' ? this.contextMenu(path) : this.contextMenu;
    if (!items || !items.length) return;
    const menu = document.createElement('div');
    menu.className = 'dtw-ctx-menu';
    menu.style.cssText = `position:fixed;top:${e.clientY}px;left:${e.clientX}px;background:#1e2838;border:1px solid #2a3d55;border-radius:8px;padding:4px 0;z-index:99999;min-width:150px;box-shadow:0 4px 16px rgba(0,0,0,.5)`;
    menu.innerHTML = items.map((it, i) => it.sep
      ? '<div style="border-top:1px solid #2a3d55;margin:4px 0"></div>'
      : `<div data-ctxitem="${i}" style="padding:8px 16px;cursor:pointer;font-size:.82rem;color:${it.color||'#c8dff5'}" onmouseover="this.style.background='#2a3d55'" onmouseout="this.style.background='transparent'">${it.icon||''} ${it.label}</div>`
    ).join('');
    document.body.appendChild(menu);
    menu.addEventListener('click', (ev) => {
      const item = ev.target.closest('[data-ctxitem]');
      if (item) {
        const idx = parseInt(item.dataset.ctxitem);
        menu.remove();
        if (items[idx].action) items[idx].action(path);
      }
    });
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 10);
  }

  bind() {
    this.container.addEventListener('click', (e) => {
      const rr = e.target.closest('[data-rowrefresh]');
      if (rr) { this._rowRefresh(rr.dataset.rowrefresh); return; }
      const tg = e.target.closest('.pc-toggle');
      if (tg) { this._toggle(tg); return; }
      const act = e.target.closest('[data-act]');
      if (act) { const i = parseInt(act.dataset.act); this.rowActions[i].fn(act.dataset.path); return; }
      const nm = e.target.closest('.dtw-name');
      if (nm) { this._select(nm.dataset.select, nm); return; }
    });
    // 右键菜单(仅当配置了contextMenu)
    if (this.contextMenu) {
      this.container.addEventListener('contextmenu', (e) => {
        const nm = e.target.closest('[data-ctx]');
        if (nm) this._showContextMenu(e, nm.dataset.ctx);
      });
    }
  }

  getChecked() {
    return [...this.container.querySelectorAll('.dtw-check:checked')].map(c => c.value);
  }

  filter(opt = {}) {
    const kw = (opt.name || '').toLowerCase();
    this.container.querySelectorAll(':scope > .dtw-node').forEach(node => {
      const path = (node.dataset.path || '').toLowerCase();
      node.style.display = (!kw || path.includes(kw)) ? '' : 'none';
    });
  }
  clearFilter() {
    this.container.querySelectorAll(':scope > .dtw-node').forEach(n => n.style.display = '');
  }

  async refreshNode(path) {
    const fwd = path.replace(/\\/g, '/');
    const nid = this._nid(fwd);
    const tg = document.querySelector('[id="' + nid + '_tg"]') || document.querySelector(`.pc-toggle[data-toggle="${fwd.replace(/"/g,'\\"')}"]`);
    const ch = document.getElementById(nid + '_ch');
    if (!tg || !ch) return false;
    const wasOpen = ch.style.display !== 'none';
    tg.dataset.loaded = '0';
    ch.innerHTML = '';
    if (wasOpen) { ch.style.display = 'none'; await this._toggle(tg); }
    this._loadStat(fwd);
    return true;
  }

  async _rowRefresh(path) {
    const fwd = path.replace(/\\/g, '/');
    const nid = this._nid(fwd);
    const tg = document.querySelector(`.pc-toggle[data-toggle="${fwd.replace(/"/g,'\\"')}"]`);
    const ch = document.getElementById(nid + '_ch');
    if (!tg || !ch) return;
    const depth = parseInt(tg.dataset.depth || '0');
    tg.textContent = '\u00b7';
    let kids = [];
    try { kids = await this._fetchChildren(fwd); } catch(e) {}
    if (Array.isArray(kids) && kids.length) {
      ch.innerHTML = kids.map(k => this._rowHtml(k, depth + 1)).join('');
      kids.forEach(k => this._loadStat(k.path));
    } else {
      ch.innerHTML = `<div style="color:#507090;font-size:.7rem;padding:3px 0 3px ${(depth+1)*18}px">（无子目录）</div>`;
    }
    ch.style.display = 'block';
    tg.dataset.loaded = '1';
    tg.textContent = '\u2212';
    this._loadStat(fwd);
  }

  refresh() { this.init(); }
}
window.DirTreeWidget = DirTreeWidget;

// ── 管理页专用操作(actions注入用，PC/NAS通吃) ──
async function dtwWriteMd5(path) {
  try {
    const r = await fetch('/api/pc/write-md5', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path }) });
    const d = await r.json();
    if (d.error) showToast('打MD5失败: ' + d.error, 'error');
    else showToast('已启动打MD5: ' + path, 'success');
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}
async function dtwProcess(path) {
  try {
    const r = await fetch('/api/pc/process-dir', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path }) });
    const d = await r.json();
    if (d.error) { showToast('处理失败: ' + d.error, 'error'); return; }
    showToast(d.status === 'running' ? '已开始处理' : '已加入队列', 'success');
    if (typeof openProcessModal === 'function') openProcessModal();
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}
async function dtwCleanOrphan(path) {
  if (!confirm('清理孤立记录？\n' + path + '\n\n检查DB记录对应文件是否存在，删除文件已不存在的记录(连带缩略图)。不删实际文件。')) return;
  try {
    const isNas = path.startsWith('/share/');
    const api = isNas ? '/api/nas/clean-orphan' : '/api/pc/clean-orphan';
    const r = await fetch(api, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path }) });
    const d = await r.json();
    if (d.error) showToast('清理失败: ' + d.error, 'error');
    else showToast(`清理完成: 检查${d.total||0} 孤立${d.orphan||0} 删除${d.deleted||0}`, 'success');
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}
