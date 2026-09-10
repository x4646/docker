// ── 目录树右键菜单 + 删除/重算 共用逻辑(viewer + 管理页共用,只写一份) ──
// 用法:contextMenu: (path) => buildDirContextMenu(treeInstance, source, path, opts)
//   treeInstance : DirTreeWidget 实例(viewer: window.dirTree/window.pcTree;管理页: nasTreeWidget/pcTreeWidget)
//   source       : 'nas' | 'pc'
//   path         : 当前节点路径
//   opts.onView  : 可选,(path)=>void;传了则菜单顶部加「查看此目录图片」(viewer用,管理页不传)
//   opts.rootSet : Set,根目录路径集合(判断根/子)
//   opts.rootIdMap: {path:id|idx},根目录的删除标识(nas用browser_roots的id,pc用pc-roots的idx)
//
// 依赖(两个页面都已加载 dir-tree-widget.js,这些全局函数都在):
//   dtwWriteMd5 / dtwProcess / dtwCleanOrphan / showToast

function _dtaNorm(p) { return String(p).replace(/\\/g, '/').replace(/\/$/, ''); }

// 包装 rootsFn:加载根目录时自动建立 rootSet + rootIdMap,挂到返回的 ctx 上。
// 用法:
//   const nasRoots = dtaMakeRoots('nas');
//   new DirTreeWidget({ rootsFn: nasRoots.fn, contextMenu:(p)=>buildDirContextMenu(tree,'nas',p,{rootSet:nasRoots.set,rootIdMap:nasRoots.map,onView}) })
// nas: 读 /api/browser/roots?source=nas,删除标识用 id
// pc : 读 /api/pc-roots,删除标识用数组 idx
function dtaMakeRoots(source, extraMap) {
  const ctx = { set: new Set(), map: {} };
  ctx.fn = async () => {
    ctx.set = new Set();
    ctx.map = {};
    let list = [];
    if (source === 'nas') {
      list = await fetch('/api/browser/roots?source=nas').then(r => r.json());
      (list || []).forEach(r => {
        const fwd = _dtaNorm(r.path);
        ctx.set.add(fwd); ctx.map[fwd] = r.id;
      });
    } else {
      list = await fetch('/api/pc-roots').then(r => r.json());
      (list || []).forEach((d, idx) => {
        const fwd = _dtaNorm(d.path);
        ctx.set.add(fwd); ctx.map[fwd] = idx;
      });
    }
    return (list || []).map(d => ({ name: d.name, path: String(d.path).replace(/\\/g, '/') }));
  };
  return ctx;
}
window.dtaMakeRoots = dtaMakeRoots;

// 统一构建右键菜单
function buildDirContextMenu(tree, source, path, opts) {
  opts = opts || {};
  const fwd = _dtaNorm(path);
  const isRoot = opts.rootSet ? opts.rootSet.has(fwd) : false;
  const items = [];

  if (typeof opts.onView === 'function') {
    items.push({ icon: '🔍', label: '查看此目录图片', action: () => opts.onView(path) });
    items.push({ sep: true });
  }

  items.push({ icon: '🔑', label: '打MD5',     action: () => dtwWriteMd5(path) });
  items.push({ icon: '⚙',  label: '处理',       action: () => dtwProcess(path) });
  items.push({ icon: '🎨', label: 'CLIP打标签', action: () => dtwClipTag(path) });
  items.push({ icon: '🧹', label: '清理孤立',   action: () => dtwCleanOrphan(path) });
  items.push({ icon: '🔄', label: '重算真实数', action: () => dtaRecalcReal(tree, source, path) });
  items.push({ sep: true });

  if (isRoot) {
    items.push({
      icon: '🧹', label: '逻辑删除(移出列表)', color: '#ffa500',
      action: () => dtaLogicalDelete(tree, source, fwd, opts.rootIdMap || {})
    });
  } else {
    items.push({
      icon: '🗑', label: '删除本地(物理删除)', color: '#ff5567',
      action: () => dtaPhysicalDelete(tree, source, path)
    });
  }
  return items;
}

// 重算真实数:点击目录 + 父级(real=1 强制扫盘;PC转发count-images)
async function dtaRecalcReal(tree, source, path) {
  const fwd = _dtaNorm(path);
  const targets = [fwd];
  const parent = fwd.replace(/\/[^/]+$/, '');
  const parentOk = source === 'pc' ? /[A-Za-z]:/.test(parent) : (parent.indexOf('/') > 0);
  if (parent && parent !== fwd && parentOk) targets.push(parent);
  let clickedCount = null;
  for (const t of targets) {
    try {
      const st = await fetch(`/api/dir-stat?source=${source}&path=${encodeURIComponent(t)}&real=1`).then(r => r.json());
      _dtaUpdateStatRow(tree, t, st);
      if (t === fwd && st && st.realCount != null) clickedCount = st.realCount;
    } catch (e) {}
  }
  if (typeof showToast === 'function') {
    const msg = clickedCount != null ? `已重算:真实图片 ${clickedCount} 张` : '已重算真实数';
    showToast(msg, 'success');
  }
}

// 把统计写回某目录行的 stat 标签(复用控件的渲染规则)
function _dtaUpdateStatRow(tree, path, st) {
  if (!tree || !st) return;
  const nid = tree._nid(_dtaNorm(path));
  const el = document.getElementById(nid + '_stat');
  if (!el) return;
  el.innerHTML = tree.renderStat ? tree.renderStat(st) : tree._defaultRenderStat(st);
}

// 逻辑删除:仅根目录,从列表移除(不碰磁盘/不碰DB记录)
//   nas → DELETE /api/browser/roots/:id    pc → DELETE /api/pc-roots/:idx
async function dtaLogicalDelete(tree, source, fwd, rootIdMap) {
  const key = rootIdMap[fwd];
  if (key == null) { if (typeof showToast === 'function') showToast('未找到该根目录', 'error'); return; }
  if (!confirm('逻辑删除（移出列表）：\n' + fwd + '\n\n仅从列表移除，磁盘文件和已入库记录都不动，下次不再加载。')) return;
  const url = source === 'nas' ? `/api/browser/roots/${key}` : `/api/pc-roots/${key}`;
  try {
    await fetch(url, { method: 'DELETE' });
    if (typeof showToast === 'function') showToast('已移出列表', 'success');
    if (typeof tree.refresh === 'function') tree.refresh();
  } catch (e) { if (typeof showToast === 'function') showToast('失败: ' + e.message, 'error'); }
}

// 物理删除:仅子目录,递归删磁盘+DB+缩略图
//   nas → /api/nas-dir/delete (两步确认)   pc → /api/photos/delete-dir (转发PC端删本地)
async function dtaPhysicalDelete(tree, source, path) {
  const fwd = _dtaNorm(path);
  if (source === 'nas') {
    // 第一步:不带confirm,后端返回内容数量
    let pre;
    try {
      pre = await fetch('/api/nas-dir/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fwd })
      }).then(r => r.json());
    } catch (e) { if (typeof showToast === 'function') showToast('失败: ' + e.message, 'error'); return; }
    if (pre.error) { if (typeof showToast === 'function') showToast('删除失败: ' + pre.error, 'error'); return; }
    if (pre.needConfirm) {
      if (!confirm('⚠ 物理删除（不可恢复）：\n' + fwd + '\n\n包含 ' + pre.fileCount + ' 个文件、' + pre.dirCount + ' 个子目录。\n将永久删除磁盘文件、文件夹及数据库记录！')) return;
      try {
        const r = await fetch('/api/nas-dir/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: fwd, confirm: true })
        }).then(r => r.json());
        if (r.error) { if (typeof showToast === 'function') showToast('删除失败: ' + r.error, 'error'); return; }
        if (typeof showToast === 'function') showToast(`已删除: 文件${r.fileCount} 目录${r.dirCount} DB${r.dbDeleted || 0}`, 'success');
      } catch (e) { if (typeof showToast === 'function') showToast('失败: ' + e.message, 'error'); return; }
    } else {
      if (typeof showToast === 'function') showToast('已删除空目录', 'success');
    }
  } else {
    // PC:走 delete-dir,转发PC端删本地原图
    if (!confirm('⚠ 物理删除（不可恢复）：\n' + fwd + '\n\n将删除PC本地的原图文件、整个文件夹，以及数据库记录和缩略图！')) return;
    try {
      const r = await fetch('/api/photos/delete-dir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirPath: fwd })
      }).then(r => r.json());
      if (r.error) { if (typeof showToast === 'function') showToast('删除失败: ' + r.error, 'error'); return; }
      if (typeof showToast === 'function') showToast(`已删除: 记录${r.deleted || 0}` + (r.pcDeleted ? ' · PC本地已删' : ' · PC端未响应'), 'success');
    } catch (e) { if (typeof showToast === 'function') showToast('失败: ' + e.message, 'error'); return; }
  }
  // 刷新父节点(目录消失)
  const parent = fwd.replace(/\/[^/]+$/, '');
  const parentOk = source === 'pc' ? /[A-Za-z]:/.test(parent) : (parent.indexOf('/') > 0);
  if (tree && parent && parentOk && typeof tree.refreshNode === 'function') {
    try { await tree.refreshNode(parent); } catch (e) { if (typeof tree.refresh === 'function') tree.refresh(); }
  } else if (tree && typeof tree.refresh === 'function') {
    tree.refresh();
  }
}

window.buildDirContextMenu = buildDirContextMenu;

// ── CLIP打标签: 设置目标目录(仅NAS支持, PC路径不适用) ──
async function dtwClipTag(path) {
  const isNas = path.startsWith('/share/');
  if (!isNas) { showToast('CLIP打标签目前仅支持NAS目录', 'error'); return; }
  try {
    const r = await fetch('/api/clip/set-target-dir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    const d = await r.json();
    if (d.error) { showToast('设置失败: ' + d.error, 'error'); return; }
    showToast('已设为CLIP目标目录: ' + path + '\n请在PC上运行 clip_batch.py 开始处理', 'success');
  } catch (e) { showToast('失败: ' + e.message, 'error'); }
}
