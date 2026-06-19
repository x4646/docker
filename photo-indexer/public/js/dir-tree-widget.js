// ── 通用目录树组件（viewer + 管理页共用） ──────────────
// new DirTreeWidget({ container, source:'pc'|'nas', mode:'single'|'batch', actions:[{label,icon,color,fn}], onSelect })
class DirTreeWidget {
  constructor(opt = {}) {
    this.container = typeof opt.container === 'string' ? document.getElementById(opt.container) : opt.container;
    this.source   = opt.source || 'nas';
    this.mode     = opt.mode   || 'single';   // single=viewer, batch=管理页
    this.actions  = opt.actions || [];        // [{label,icon,color,fn(path)}]
    this.onSelect = opt.onSelect || (() => {});
    this.rootsFn  = opt.rootsFn || null;
    this.selected = null;
  }

  async init() {
    this.container.innerHTML = '<div style="color:#507090;padding:12px">加载中...</div>';
    let roots = [];
    try {
      roots = this.rootsFn ? await this.rootsFn()
                           : await fetch(`/api/dir-tree?source=${this.source}`).then(r => r.json());
    }
    catch (e) { this.container.innerHTML = '<div style="color:#ff5567;padding:12px">加载失败</div>'; return; }
    if (!Array.isArray(roots) || !roots.length) {
      this.container.innerHTML = '<div style="color:#507090;padding:12px">（空）</div>'; return;
    }
    this.container.innerHTML = roots.map(r => this._rowHtml(r, 0)).join('');
    roots.forEach(r => this._loadStat(r.path));
  }

  _nid(path) {
    const fwd = path.replace(/\\/g, '/');
    return 'dt_' + this.source + '_' + btoa(unescape(encodeURIComponent(fwd))).replace(/[^a-zA-Z0-9]/g, '');
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
    const actBtns = this.actions.map((a, i) =>
      `<button class="btn-sm" style="${a.color?`border-color:${a.color};color:${a.color}`:''}" data-act="${i}" data-path="${esc}">${a.icon||''} ${a.label}</button>`
    ).join('');
    return `
    <div class="dtw-node" data-path="${fwd}">
      <div class="dtw-row" style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid #1a2433">
        ${guides}
        <span class="pc-toggle" data-toggle="${esc}" data-depth="${depth}" data-loaded="0">+</span>
        ${cb}
        <span class="dtw-name" data-select="${esc}" style="cursor:pointer;font-size:.82rem;color:#c8dff5;flex:1;min-width:0;word-break:break-all">
          ${isRoot ? (this.source==='pc'?'💻':'🗄') : '📁'} ${this._esc(node.name)}
          <small class="dtw-stat" id="${nid}_stat" style="color:#507090;margin-left:8px;font-size:.72rem">…</small>
        </span>
        <span class="dtw-actions" style="display:flex;gap:5px;flex-shrink:0">
          <button class="btn-sm" data-rowrefresh="${esc}" title="刷新此目录">🔄</button>
          ${actBtns}
        </span>
      </div>
      <div class="dtw-children" id="${nid}_ch" style="display:none"></div>
    </div>`;
  }

  _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  async _loadStat(path) {
    const nid = this._nid(path);
    const el = document.getElementById(nid + '_stat');
    if (!el) return;
    try {
      const st = await fetch(`/api/dir-stat?source=${this.source}&path=${encodeURIComponent(path)}`).then(r => r.json());
      if (st.inDb) {
        const total = st.dbTotal || 0, done = st.done || 0, pend = st.pending || 0, err = st.error || 0;
        let html = `总${total} <span style="color:#3ddc84">✅${done}</span> <span style="color:#ffa500">⏳${pend}</span>`;
        if (err > 0) html += ` <span style="color:#ff5567">❌${err}</span>`;
        el.innerHTML = html;
      } else if (st.realCount && st.realCount > 0) {
        el.innerHTML = `<span style="color:#a78bfa">📥 ${st.realCount}张待入库</span>`;
      } else if (st.realCount === null) {
        el.innerHTML = '<span style="color:#507090">未入库</span>';
      } else {
        el.innerHTML = '<span style="color:#507090">空</span>';
      }
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
        try { kids = await fetch(`/api/dir-tree?source=${this.source}&path=${encodeURIComponent(path)}`).then(r => r.json()); }
        catch (e) {}
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

  // 事件委托
  bind() {
    this.container.addEventListener('click', (e) => {
      const rr = e.target.closest('[data-rowrefresh]');
      if (rr) { this._rowRefresh(rr.dataset.rowrefresh); return; }
      const tg = e.target.closest('.pc-toggle');
      if (tg) { this._toggle(tg); return; }
      const act = e.target.closest('[data-act]');
      if (act) { const i = parseInt(act.dataset.act); this.actions[i].fn(act.dataset.path); return; }
      const nm = e.target.closest('.dtw-name');
      if (nm) { this._select(nm.dataset.select, nm); return; }
    });
  }

  getChecked() {
    return [...this.container.querySelectorAll('.dtw-check:checked')].map(c => c.value);
  }

  // 按关键词/状态筛选已渲染的顶层节点
  filter(opt = {}) {
    const kw = (opt.name || '').toLowerCase();
    this.container.querySelectorAll(':scope > .dtw-node').forEach(node => {
      const path = (node.dataset.path || '').toLowerCase();
      const show = !kw || path.includes(kw);
      node.style.display = show ? '' : 'none';
    });
  }
  clearFilter() {
    this.container.querySelectorAll(':scope > .dtw-node').forEach(n => n.style.display = '');
  }
  // 刷新指定路径的节点：重置loaded标志,若已展开则重新拉取子目录
  async refreshNode(path) {
    const fwd = path.replace(/\\/g, '/');
    const nid = this._nid(fwd);
    const tg = document.querySelector('[id="' + nid + '_tg"]');
    const ch = document.getElementById(nid + '_ch');
    if (!tg || !ch) return false; // 节点未渲染(可能还没展开到这一层)
    const wasOpen = ch.style.display !== 'none';
    tg.dataset.loaded = '0';
    ch.innerHTML = '';
    if (wasOpen) {
      ch.style.display = 'none';
      await this._toggle(tg); // 重新展开,触发重新拉取
    }
    this._loadStat(fwd);
    return true;
  }
  // 单行刷新：重新拉取该节点的子目录并重新渲染(不管之前是否展开过)
  async _rowRefresh(path) {
    const fwd = path.replace(/\\/g, '/');
    const nid = this._nid(fwd);
    const tg = document.getElementById(nid + '_tg');
    const ch = document.getElementById(nid + '_ch');
    if (!tg || !ch) return;
    // 找depth(从data-depth属性,row元素上)
    const row = tg.closest('.dtw-row');
    const depth = row ? parseInt(row.querySelector('.pc-toggle').dataset.depth || '0') : 0;
    tg.textContent = '\u00b7';
    let kids = [];
    try { kids = await fetch(`/api/dir-tree?source=${this.source}&path=${encodeURIComponent(fwd)}`).then(r => r.json()); }
    catch(e) {}
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

// ── 通用目录操作（组件actions用，PC/NAS通吃，走统一接口） ──
async function dtwWriteMd5(path) {
  try {
    const r = await fetch('/api/pc/write-md5', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ path })
    });
    const d = await r.json();
    if (d.error) showToast('打MD5失败: ' + d.error, 'error');
    else showToast('已启动打MD5: ' + path, 'success');
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}

async function dtwProcess(path) {
  try {
    const r = await fetch('/api/pc/process-dir', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ path })
    });
    const d = await r.json();
    if (d.error) { showToast('处理失败: ' + d.error, 'error'); return; }
    showToast(d.status === 'running' ? '已开始处理' : '已加入队列', 'success');
    if (typeof openProcessModal === 'function') openProcessModal();
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}

async function dtwCleanOrphan(path) {
  if (!confirm('清理孤立记录？\n' + path + '\n\n检查DB记录对应文件是否存在，删除文件已不存在的记录(连带缩略图)。不删实际文件。')) return;
  try {
    const r = await fetch('/api/pc/clean-orphan', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ pcPath: path })
    });
    const d = await r.json();
    if (d.error) showToast('清理失败: ' + d.error, 'error');
    else showToast(`清理完成: 检查${d.total||0} 孤立${d.orphan||0} 删除${d.deleted||0}`, 'success');
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}
