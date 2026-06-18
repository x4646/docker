/**
 * DirTree - 通用目录树控件
 *
 * 特性：
 * - 真正的树状结构（缩进+连接线）
 * - +/- 切换图标在每个目录前
 * - 节点引用缓存，updateStats(path, done, total)直接更新不重新加载
 * - 懒加载：默认只渲染传入的根目录，点击+展开时再fetch子目录
 * - 全量展开：expandAll(path) 一次性展开所有子目录
 *
 * 用法：
 *   const tree = new DirTree({
 *     container: document.getElementById('tree'),
 *     onSelect:  (path) => console.log('选中:', path),
 *     onContext: (path, event, statsSpan) => showMenu(...),
 *   });
 *   await tree.load([{path:'/share/Person', name:'Person', hasChildren:true}]);
 *   tree.updateStats('/share/Person', 39383, 49916);
 */
class DirTree {
  constructor(options = {}) {
    this.container  = options.container;
    this.onSelect   = options.onSelect   || (() => {});
    this.onContext  = options.onContext  || (() => {});
    this.apiBase    = options.apiBase    || '';
    this.indentSize = options.indentSize || 16;
    this.childrenFn = options.childrenFn || null;
    this.nodes      = new Map(); // path -> NodeRef
    this.activePath = null;
  }

  /**
   * 加载根目录列表（一级，不递归）
   */
  async load(roots) {
    this.container.innerHTML = '';
    this.nodes.clear();
    for (const root of roots) {
      this._renderNode(root, this.container, 0);
    }
  }

  /**
   * 渲染单个节点（不递归，子节点点击+时再加载）
   */
  _renderNode(node, container, depth) {
    // 节点容器（包含row+childContainer）
    const wrap = document.createElement('div');
    wrap.className = 'dt-node';
    wrap.dataset.path = node.path;

    // 目录行
    const row = document.createElement('div');
    row.className = 'dt-row';
    row.dataset.path = node.path;
    row.dataset.depth = depth;

    // 缩进（带竖线）
    for (let i = 0; i < depth; i++) {
      const guide = document.createElement('span');
      guide.className = 'dt-guide';
      row.appendChild(guide);
    }

    // 展开/收起按钮（+/-）
    const toggle = document.createElement('span');
    toggle.className = 'dt-toggle';
    toggle.textContent = node.hasChildren ? '+' : ' ';

    // 文件夹图标
    const icon = document.createElement('span');
    icon.className = 'dt-icon';
    icon.textContent = '📁';

    // 名称
    const name = document.createElement('span');
    name.className = 'dt-name';
    name.textContent = node.name;

    // 状态（done/total）
    const stats = document.createElement('span');
    stats.className = 'dt-stats';
    stats.textContent = '';

    row.appendChild(toggle);
    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(stats);

    // 子节点容器（默认收起）
    const childContainer = document.createElement('div');
    childContainer.className = 'dt-children';
    childContainer.style.display = 'none';

    wrap.appendChild(row);
    wrap.appendChild(childContainer);
    container.appendChild(wrap);

    // 保存节点引用
    const nodeRef = {
      wrap, row, toggle, icon, name, stats, childContainer,
      depth, path: node.path, loaded: false, hasChildren: !!node.hasChildren,
    };
    this.nodes.set(node.path, nodeRef);

    // 展开/收起：点击+/-
    toggle.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!nodeRef.hasChildren) return;
      const isOpen = childContainer.style.display !== 'none';
      if (isOpen) {
        childContainer.style.display = 'none';
        toggle.textContent = '+';
      } else {
        // 懒加载子节点
        if (!nodeRef.loaded) {
          toggle.textContent = '⟳';
          await this._loadChildren(node.path);
          nodeRef.loaded = true;
        }
        childContainer.style.display = 'block';
        toggle.textContent = '-';
      }
    });

    // 点击行：选中并触发onSelect
    row.addEventListener('click', () => {
      this._setActive(node.path);
      this.onSelect(node.path);
    });

    // 右键菜单
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._setActive(node.path);
      this.onContext(node.path, e, stats);
    });

    return nodeRef;
  }

  /**
   * 加载某节点的子目录（从API）
   */
  async _loadChildren(parentPath) {
    const parent = this.nodes.get(parentPath);
    if (!parent) return;
    try {
      let children;
      if (this.childrenFn) {
        children = await this.childrenFn(parentPath);
      } else {
        const url = `${this.apiBase}/api/dir-tree?source=nas&path=${encodeURIComponent(parentPath)}`;
        children = await fetch(url).then(r => r.json());
      }
      parent.childContainer.innerHTML = '';
      for (const c of children) {
        this._renderNode(c, parent.childContainer, parent.depth + 1);
      }
      // 如果children自带统计数据直接用，否则从dir-stats接口拿
      const hasStats = children.length > 0 && children[0].total !== undefined;
      if (hasStats) {
        for (const c of children) {
          if (this.has(c.path)) {
            this.updateStats(c.path, c.done||0, c.total||0, (c.total||0)-(c.done||0));
          }
        }
      } else {
        try {
          const stats = await fetch(`${this.apiBase}/api/dir-stats?path=${encodeURIComponent(parentPath)}`).then(r => r.json());
          for (const s of stats) {
            if (this.has(s.path)) {
              this.updateStats(s.path, s.done_files, s.total_files, s.pending_files);
            }
          }
        } catch(e) {}
      }
    } catch (e) {
      console.error('加载子目录失败', e);
    }
  }

  /**
   * 展开节点（如果未加载则加载）
   */
  async expand(path) {
    const node = this.nodes.get(path);
    if (!node || !node.hasChildren) return;
    if (!node.loaded) {
      await this._loadChildren(path);
      node.loaded = true;
    }
    node.childContainer.style.display = 'block';
    node.toggle.textContent = '-';
  }

  /**
   * 递归展开所有子目录
   */
  /**
   * 智能展开：只展开有未完成图片的目录
   * @param {string} path 起始目录
   * @param {Map} dirStatsMap path -> {total, done} 用于判断是否完成
   */
  async expandAll(path, dirStatsMap) {
    const node = this.nodes.get(path);
    if (!node) return;

    // 判断该目录是否需要展开：dirStatsMap里有数据且done<total
    let shouldExpand = true;
    if (dirStatsMap && dirStatsMap.has(path)) {
      const s = dirStatsMap.get(path);
      shouldExpand = s.done < s.total;
    }

    if (!shouldExpand) return; // 全部完成，不展开

    await this.expand(path);
    const children = [...node.childContainer.querySelectorAll(':scope > .dt-node')];
    for (const child of children) {
      await this.expandAll(child.dataset.path, dirStatsMap);
    }
  }

  /**
   * 收起节点
   */
  collapse(path) {
    const node = this.nodes.get(path);
    if (!node) return;
    node.childContainer.style.display = 'none';
    node.toggle.textContent = '+';
  }

  /**
   * 刷新节点的子目录（清空重新加载）
   */
  async refresh(path) {
    const node = this.nodes.get(path);
    if (!node) return;
    // 清除子节点缓存
    for (const [key, ref] of this.nodes) {
      if (key !== path && key.startsWith(path + '/')) {
        this.nodes.delete(key);
      }
    }
    node.loaded = false;
    node.childContainer.innerHTML = '';
    if (node.childContainer.style.display !== 'none') {
      await this._loadChildren(path);
      node.loaded = true;
    }
  }

  /**
   * 更新节点的统计数据
   *   updateStats(path, done, total)
   *   total=0 或 undefined 时只显示done
   */
  updateStats(path, done, total, pending) {
    const node = this.nodes.get(path);
    if (!node) return;
    done = done || 0;
    pending = pending || 0;
    let html = "";
    if (total && total > 0) {
      if (done < total) {
        html = `<span class="dt-stats-done">${done}</span><span class="dt-stats-sep">/</span><span class="dt-stats-total">${total}</span>`;
      } else {
        html = `<span class="dt-stats-done">${done}/${total}</span>`;
      }
    } else {
      html = `<span class="dt-stats-done">${done}</span>`;
    }
    if (pending > 0) {
      html += ` <span class="dt-stats-pending">⏳ ${pending}</span>`;
    }
    node.stats.innerHTML = html;
  }

  /**
   * 设置选中状态（高亮）
   */
  _setActive(path) {
    if (this.activePath) {
      const prev = this.nodes.get(this.activePath);
      if (prev) prev.row.classList.remove('active');
    }
    const node = this.nodes.get(path);
    if (node) {
      node.row.classList.add('active');
      this.activePath = path;
    }
  }

  /**
   * 获取所有已渲染节点的path
   */
  getAllPaths() {
    return [...this.nodes.keys()];
  }

  /**
   * 节点是否已渲染
   */
  has(path) {
    return this.nodes.has(path);
  }
}
