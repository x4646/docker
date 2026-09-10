/**
 * 通用文件浏览器组件
 * 支持：单选目录、单选文件、多选文件
 */
class FileBrowser {
  constructor(options = {}) {
    this.mode      = options.mode     || 'dir';    // dir | file | multi
    this.source    = options.source   || 'nas';    // nas | pc
    this.filter    = options.filter   || null;     // ['.mp3', '.jpg']
    this.onSelect  = options.onSelect || null;
    this.onConfirm = options.onConfirm|| null;
    this.title     = options.title    || '选择路径';

    this.currentPath = null;
    this.roots       = [];
    this.selected    = new Set();
    this.el          = null;
  }

  // ── 打开 ──────────────────────────────────────────────
  async open() {
    this._createModal();
    document.body.appendChild(this.el);
    await this._loadRoots();
    this.el.classList.add('show');
  }

  close() {
    if (this.el) {
      this.el.classList.remove('show');
      setTimeout(() => { if (this.el) { this.el.remove(); this.el = null; } }, 300);
    }
  }

  // ── 创建Modal ─────────────────────────────────────────
  _createModal() {
    this.el = document.createElement('div');
    this.el.className = 'fb-overlay';
    this.el.innerHTML = `
      <div class="fb-modal">
        <div class="fb-header">
          <span class="fb-title">${this.title}</span>
          <button class="fb-close" onclick="this.closest('.fb-overlay')._fb.close()">✕</button>
        </div>
        <div class="fb-breadcrumb" id="fb-breadcrumb"></div>
        <div class="fb-body">
          <div class="fb-sidebar" id="fb-sidebar"></div>
          <div class="fb-main">
            <div class="fb-toolbar">
              <input class="fb-search" placeholder="搜索..." oninput="this.closest('.fb-overlay')._fb._onSearch(this.value)">
              ${this.mode === 'dir' ? '<span class="fb-hint">点击目录选择，双击进入</span>' : ''}
              ${this.mode === 'multi' ? '<span class="fb-hint">Ctrl+点击多选</span>' : ''}
            </div>
            <div class="fb-list" id="fb-list"></div>
          </div>
        </div>
        <div class="fb-footer">
          <div class="fb-selected-path" id="fb-selected-path">未选择</div>
          <div class="fb-actions">
            <button class="fb-btn-cancel" onclick="this.closest('.fb-overlay')._fb.close()">取消</button>
            <button class="fb-btn-confirm" onclick="this.closest('.fb-overlay')._fb._confirm()">确认</button>
          </div>
        </div>
      </div>`;
    this.el._fb = this;
  }

  // ── 加载根目录 ────────────────────────────────────────
  async _loadRoots() {
    const r    = await fetch(`/api/browser/roots?source=${this.source}`);
    this.roots = await r.json();
    const sidebar = this.el.querySelector('#fb-sidebar');
    sidebar.innerHTML = this.roots.map(root => `
      <div class="fb-root-item" onclick="this.closest('.fb-overlay')._fb._navigate('${root.path}')">
        📁 ${root.name}
      </div>`).join('');
    if (this.roots.length) await this._navigate(this.roots[0].path);
  }

  // ── 导航到目录 ────────────────────────────────────────
  async _navigate(path) {
    this.currentPath = path;
    const filterStr  = this.filter ? this.filter.join(',') : '';
    const url        = `/api/browser/list?path=${encodeURIComponent(path)}&source=${this.source}${filterStr ? '&filter='+filterStr : ''}`;

    const r    = await fetch(url);
    const data = await r.json();

    this._renderBreadcrumb(path, data.roots);
    this._renderList(data.items);

  }

  // ── 渲染面包屑 ────────────────────────────────────────
  _renderBreadcrumb(path, roots) {
    const root = roots.find(r => path.startsWith(r.path));
    if (!root) return;

    const rel   = path.substring(root.path.length);
    const parts = rel.split('/').filter(Boolean);
    const crumbs = [{ name: root.name, path: root.path }];
    let cur = root.path;
    parts.forEach(p => { cur += '/' + p; crumbs.push({ name: p, path: cur }); });

    const bc = this.el.querySelector('#fb-breadcrumb');
    bc.innerHTML = crumbs.map((c, i) =>
      i < crumbs.length - 1
        ? `<span class="fb-crumb" onclick="this.closest('.fb-overlay')._fb._navigate('${c.path}')">${c.name}</span><span class="fb-sep">›</span>`
        : `<span class="fb-crumb active">${c.name}</span>`
    ).join('');
  }

  // ── 渲染文件列表 ──────────────────────────────────────
  _renderList(items, searchVal = '') {
    this._allItems = items;
    const filtered = searchVal
      ? items.filter(i => i.name.toLowerCase().includes(searchVal.toLowerCase()))
      : items;

    const list = this.el.querySelector('#fb-list');
    list.innerHTML = filtered.map(item => {
      const icon     = item.type === 'dir' ? '📁' : this._fileIcon(item.ext);
      const size     = item.type === 'file' ? `<span class="fb-size">${this._formatSize(item.size)}</span>` : '';
      const selected = this.selected.has(item.path) ? 'selected' : '';
      return `
        <div class="fb-item ${item.type} ${selected}"
             data-path="${item.path}" data-type="${item.type}"
             onclick="this.closest('.fb-overlay')._fb._onItemClick(this, event)"
             ondblclick="this.closest('.fb-overlay')._fb._onItemDblClick(this)">
          <span class="fb-icon">${icon}</span>
          <span class="fb-name">${item.name}</span>
          ${size}
        </div>`;
    }).join('') || '<div class="fb-empty">空目录</div>';
  }

  // ── 点击处理 ──────────────────────────────────────────
  _onItemClick(el, event) {
    const path = el.dataset.path;
    const type = el.dataset.type;

    if (this.mode === 'multi' && type === 'file') {
      if (event.ctrlKey || event.metaKey) {
        if (this.selected.has(path)) this.selected.delete(path);
        else this.selected.add(path);
      } else {
        this.selected.clear();
        this.selected.add(path);
      }
      this._refreshSelected();
    } else if (this.mode === 'file' && type === 'file') {
      this._setSelected(path);
    } else if (this.mode === 'dir' && type === 'dir') {
      this._setSelected(path);
    }
  }

  _onItemDblClick(el) {
    if (el.dataset.type === 'dir') this._navigate(el.dataset.path);
  }

  _setSelected(path) {
    this.selected.clear();
    this.selected.add(path);
    this._refreshSelected();
  }

  _refreshSelected() {
    // 更新列表高亮
    this.el.querySelectorAll('.fb-item').forEach(el => {
      el.classList.toggle('selected', this.selected.has(el.dataset.path));
    });
    // 更新底部显示
    const paths = [...this.selected];
    const display = paths.length === 1
      ? paths[0]
      : `已选 ${paths.length} 项`;
    this.el.querySelector('#fb-selected-path').textContent = display || '未选择';
    if (this.onSelect) this.onSelect(this.mode === 'multi' ? paths : paths[0]);
  }

  // ── 搜索 ──────────────────────────────────────────────
  _onSearch(val) {
    if (this._allItems) this._renderList(this._allItems, val);
  }

  // ── 确认 ──────────────────────────────────────────────
  _confirm() {
    const paths = [...this.selected];
    if (!paths.length) { alert('请先选择'); return; }
    if (this.onConfirm) this.onConfirm(this.mode === 'multi' ? paths : paths[0]);
    this.close();
  }

  // ── 工具函数 ──────────────────────────────────────────
  _fileIcon(ext) {
    const icons = { '.jpg':' 🖼', '.jpeg':'🖼', '.png':'🖼', '.gif':'🖼', '.heic':'🖼',
                    '.mp3':'🎵', '.flac':'🎵', '.aac':'🎵', '.wav':'🎵', '.m4a':'🎵', '.ogg':'🎵',
                    '.mp4':'🎬', '.mov':'🎬', '.pdf':'📄', '.zip':'📦' };
    return icons[ext] || '📄';
  }

  _formatSize(bytes) {
    if (!bytes) return '';
    if (bytes > 1024*1024) return (bytes/1024/1024).toFixed(1) + 'MB';
    if (bytes > 1024)      return (bytes/1024).toFixed(0) + 'KB';
    return bytes + 'B';
  }
}
