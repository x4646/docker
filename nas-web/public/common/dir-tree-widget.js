// ── 通用目录树控件（viewer + 管理页共用，纯控件+全注入） ──────────────
// 基本功能(内核): 异步懒加载、展开/收起、竖线层级、节点渲染、单节点刷新、事件委托
// 扩展功能(注入): rootsFn / childrenFn / statFn / renderStat / onSelect / contextMenu / rowActions / mode / icons
class DirTreeWidget {
  constructor(opt = {}) {
    this.container = typeof opt.container === 'string' ? document.getElementById(opt.container) : opt.container;
    this.source   = opt.source || 'nas';
    this.mode     = opt.mode   || 'single';
    this.instanceId = opt.instanceId || this.source;
    this.rootsFn      = opt.rootsFn      || null;
    this.childrenFn   = opt.childrenFn   || null;
    this.statFn       = opt.statFn       || null;
    this.renderStat   = opt.renderStat   || null;
    this.onSelect     = opt.onSelect     || (() => {});
    this.contextMenu  = opt.contextMenu  || null;
    this.rowActions   = opt.rowActions   || opt.actions || [];
    this.icons        = opt.icons        || {};
    this.showRefresh  = opt.showRefresh !== false;
    this.showFamilyCheck = !!opt.showFamilyCheck;   // 是否启用成人/家庭背景色标注(标记操作走顶部工具栏, 见 dtwBatchSetCategory)
    this.showHoverCard = !!opt.showHoverCard;        // 是否启用悬浮详情卡片
    this.getEnabledFeatures = opt.getEnabledFeatures || (() => null);   // 顶部功能筛选栏当前勾选(null=全部)
    this.enabledFeatures = null;                     // 顶部功能筛选栏勾选的功能集合(null=全部显示)
    this.selected = null;
    this._notIn = {};      // path -> 该节点(扫盘统计到的)待入库数
    this._rootPaths = [];  // 根目录路径集合
    // 统计限并发队列(B方案:目录先显示,统计后台慢慢算,点击优先)
    this._statQueue = [];        // 待统计的 path 队列
    this._statRunning = 0;       // 当前并发数
    this._statMax = 3;           // 最大并发
    this._statSeen = new Set();  // 已入队/已处理,避免重复
    // 展开状态记忆(每个 instanceId 独立存一份, 避免多个树互相覆盖)
    this._expandKey = 'dtw_expand_' + this.instanceId;
  }
  _loadExpanded() {
    try { return JSON.parse(localStorage.getItem(this._expandKey) || '{}') || {}; }
    catch (e) { return {}; }
  }
  _saveExpanded(map) {
    try { localStorage.setItem(this._expandKey, JSON.stringify(map)); } catch (e) {}
  }
  _setExpanded(path, open) {
    const fwd = path.replace(/\\/g, '/');
    const m = this._loadExpanded();
    if (open) m[fwd] = 1; else delete m[fwd];
    this._saveExpanded(m);
  }
  async _fetchChildren(path) {
    if (this.childrenFn) return await this.childrenFn(path);
    return await apiFetch(`/api/dir-tree?source=${this.source}&path=${encodeURIComponent(path)}`);
  }
  async _fetchRoots() {
    if (this.rootsFn) return await this.rootsFn();
    return await apiFetch(`/api/dir-tree?source=${this.source}`);
  }
  // forceReal=true: 强制扫盘拿真实数(慢,只在"精确统计"手动触发时用)。
  // 默认走DB快速路径, 不再每个节点都递归扫盘。
  async _fetchStat(path, forceReal) {
    if (this.statFn) return await this.statFn(path, forceReal);
    return await apiFetch(`/api/dir-stat?source=${this.source}&path=${encodeURIComponent(path)}${forceReal ? '&real=1' : ''}`);
  }
  // 本地缓存优先: 有LocalCache就用, 没有(旧页面没引入脚本)就直接走网络, 不影响功能
  _ck(kind, path) {
    return window.LocalCache ? LocalCache.key('dtw', this.source, kind, path) : null;
  }
  async _cacheGet(kind, path) {
    const k = this._ck(kind, path);
    if (!k) return undefined;
    try { return await LocalCache.get(k); } catch (e) { return undefined; }
  }
  _cacheSet(kind, path, value) {
    const k = this._ck(kind, path);
    if (k) { try { LocalCache.set(k, value); } catch (e) {} }
  }
  _defaultRenderStat(st) {
    if (!st) return '';
    const real = st.realCount != null ? st.realCount : (st.dbTotal||0);
    if (st.inDb) {
      const done = st.done||0, pend = st.pending||0, err = st.errorCount||0, md5 = st.md5||0;
      let html = `总${real} <span style="color:#40d0ff">🔑${md5}</span> <span style="color:#3ddc84">✅${done}</span> <span style="color:#ffa500">⏳${pend}</span>`;
      const notIn = real - (st.dbTotal||0); if (notIn > 0) html += ` <span style="color:#a78bfa">📥${notIn}待入库</span>`;
      if (err > 0) html += ` <span style="color:#ff5567">❌${err}</span>`;
      return html;
    } else if (st.realCount && st.realCount > 0) {
      return `<span style="color:#a78bfa">📥 ${st.realCount}张待入库</span>`;
    } else if (st.realCount === null) {
      return '<span style="color:#507090">未入库</span>';
    }
    return '<span style="color:#507090">📭 空</span>';
  }
  // 从stat里提取待入库数(供累加)
  _extractNotIn(st) {
    if (!st) return 0;
    if (st.inDb) { const real = st.realCount != null ? st.realCount : (st.dbTotal||0); return Math.max(0, real - (st.dbTotal||0)); }
    if (st.realCount && st.realCount > 0) return st.realCount;
    return 0;
  }
  // 渲染根目录列表(缓存命中/网络返回都调这个, 逻辑只写一份)
  _renderRoots(roots) {
    this._notIn = {};
    this._statQueue = []; this._statRunning = 0; this._statSeen = new Set();  // 刷新重置统计队列
    this._rootPaths = roots.map(r => r.path.replace(/\\/g, '/'));
    this.container.innerHTML = roots.map(r => this._rowHtml(r, 0)).join('');
    // 根目录不自动扫盘:显示统计按钮(点击才算)。子目录展开后会累加到根。
    if (this.statFn !== false) this._rootPaths.forEach(p => this._renderRootStatBtn(p));
    this._restoreExpanded();
    if (this.showFamilyCheck) this._syncFamilyChecks();
    if (this.showHoverCard) this._bindDetailButton();
  }
  async init() {
    // 缓存优先: 目录结构几乎不变, 先读本地缓存秒开, 后台再去服务器校验/修正。
    const cached = await this._cacheGet('roots', '');
    if (cached && Array.isArray(cached) && cached.length) {
      this._renderRoots(cached);
    } else {
      this.container.innerHTML = '<div style="color:#507090;padding:12px">加载中...</div>';
    }
    let roots = [];
    try { roots = await this._fetchRoots(); }
    catch (e) {
      if (!cached || !cached.length) this.container.innerHTML = '<div style="color:#ff5567;padding:12px">加载失败</div>';
      return;
    }
    if (!Array.isArray(roots) || !roots.length) {
      if (!cached || !cached.length) this.container.innerHTML = '<div style="color:#507090;padding:12px">（空）</div>';
      return;
    }
    this._cacheSet('roots', '', roots);
    if (!cached || !(window.LocalCache && LocalCache.equal(cached, roots))) this._renderRoots(roots);
  }
  // ── 详情弹层: 点击"ℹ"按钮打开, 带关闭按钮, 点遮罩也能关 ──────
  // (曾经做过悬停自动显示, 鼠标移到卡片本身上时经常判定不稳定导致提前消失,
  //  卡片元素挂在 document.body 下和树容器是两棵独立DOM树, mouseover/mouseout
  //  在两者之间传递的时机很难保证, 干脆换成点击触发, 交互上更可靠)
  _bindDetailButton() {
    if (this._detailBound) return;
    this._detailBound = true;
    this.container.addEventListener('click', (e) => {
      const btn = e.target.closest('.dtw-info-btn');
      if (!btn) return;
      e.stopPropagation();
      const path = btn.getAttribute('data-infopath');
      if (path) this._openDetailModal(path);
    });
  }
  _ensureDetailModalEl() {
    let modal = document.getElementById('dtw-detailmodal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'dtw-detailmodal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;' +
      'background:rgba(0,0,0,.55);align-items:center;justify-content:center';
    modal.innerHTML =
      '<div id="dtw-detailbox" style="min-width:280px;max-width:420px;max-height:70vh;overflow-y:auto;' +
      'padding:16px 18px;border-radius:10px;background:#141d29;border:1px solid #2a3d55;' +
      'box-shadow:0 14px 44px rgba(0,0,0,.6);font-size:.78rem;color:#c8dff5;position:relative">' +
      '<span id="dtw-detailclose" style="position:absolute;top:10px;right:12px;cursor:pointer;' +
      'color:#8aa8c8;font-size:.9rem;line-height:1">&#10005;</span>' +
      '<div id="dtw-detailcontent">加载中…</div></div>';
    document.body.appendChild(modal);
    // 点遮罩(而不是内容框)关闭
    modal.addEventListener('click', (e) => { if (e.target === modal) this._closeDetailModal(); });
    modal.querySelector('#dtw-detailclose').addEventListener('click', () => this._closeDetailModal());
    return modal;
  }
  _closeDetailModal() {
    const modal = document.getElementById('dtw-detailmodal');
    if (modal) modal.style.display = 'none';
  }
  async _openDetailModal(path) {
    const modal = this._ensureDetailModalEl();
    const content = modal.querySelector('#dtw-detailcontent');
    modal.dataset.curPath = path;
    content.innerHTML = '<div style="color:#507090">加载中…</div>';
    modal.style.display = 'flex';

    try {
      const [stat, errSum, famCheck] = await Promise.all([
        this._fetchStat(path).catch(() => null),
        apiFetch('/api/errors/summary?path=' + encodeURIComponent(path), {showError:false}).catch(() => null),
        apiFetch('/api/dir-category/check?path=' + encodeURIComponent(path), {showError:false}).catch(() => null)
      ]);
      if (modal.dataset.curPath !== path) return;   // 期间用户点了别的目录, 丢弃这次结果
      this._lastDetailData = { path, stat, errSum, famCheck };
      content.innerHTML = this._detailHtml(path, stat, errSum, famCheck);
    } catch (e) {
      if (modal.dataset.curPath === path) content.innerHTML = '<div style="color:#ff5567">加载失败</div>';
    }
  }
  // 功能筛选栏变化时调用: 若详情层正开着, 用缓存的数据按新筛选立即重绘(不重新请求接口)
  refreshHoverFilter() {
    const modal = document.getElementById('dtw-detailmodal');
    if (!modal || modal.style.display === 'none' || !this._lastDetailData) return;
    const d = this._lastDetailData;
    const content = modal.querySelector('#dtw-detailcontent');
    if (content) content.innerHTML = this._detailHtml(d.path, d.stat, d.errSum, d.famCheck);
  }
  _detailHtml(path, stat, errSum, famCheck) {
    const esc = (s) => this._esc(String(s == null ? '' : s));
    const row = (label, val) => val == null ? '' :
      `<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0">
        <span style="color:#507090">${label}</span><span>${val}</span></div>`;

    let h = `<div style="font-weight:700;color:#f0f6ff;margin:0 20px 8px 0;word-break:break-all">${esc(path)}</div>`;

    if (famCheck) {
      const isFamily = famCheck.category === 'family';
      h += `<div style="margin-bottom:8px">
        <span style="padding:2px 9px;border-radius:10px;font-size:.7rem;
          background:${isFamily ? 'rgba(255,255,255,.15)' : 'rgba(255,95,168,.18)'};
          color:${isFamily ? '#f0f6ff' : '#ff5fa8'}">${isFamily ? '家庭内容' : '成人内容'}</span></div>`;
    }

    if (stat) {
      h += row('照片', stat.photos != null ? stat.photos : (stat.total != null ? stat.total : null));
      h += row('视频', stat.videos);
      if (stat.done != null) h += row('已完成', stat.done);
      if (stat.pending != null) h += row('待处理', stat.pending);
      if (stat.notIn != null && stat.notIn > 0) h += row('未入库', stat.notIn);
    }

    if (errSum) {
      const labels = { photo_process: '图片处理', md5_write: '打MD5', clip_tag: 'CLIP标签', feat_extract: '特征提取', video_shots: '视频抽帧' };
      const enabled = this.getEnabledFeatures();
      let errItems = Object.keys(errSum).filter(k => errSum[k] > 0);
      if (enabled) errItems = errItems.filter(k => enabled.indexOf(k) >= 0);
      if (errItems.length) {
        h += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #223145">';
        h += '<div style="color:#ff5567;font-size:.72rem;margin-bottom:3px">错误</div>';
        errItems.forEach(k => { h += row(labels[k] || k, `<span style="color:#ff5567">${errSum[k]}</span>`); });
        h += '</div>';
      } else if (enabled) {
        h += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #223145;color:#507090;font-size:.72rem">当前筛选的功能里无错误</div>';
      }
    }
    return h;
  }
  // 拉一次已标记为家庭的目录列表, 给当前已渲染的行标注 成人/家庭 背景色。
  // 默认(未标记)= 成人; 标记过的(直接或继承)= 家庭。改用行背景色区分, 不再用每行单独的
  // checkbox —— 标记操作走顶部工具栏 + 现有的批量选中(dtw-check), 见 admin.js。
  async _syncFamilyChecks() {
    try {
      const list = await apiFetch('/api/dir-category/list');
      this._familySet = new Set(list);
    } catch (e) { this._familySet = this._familySet || new Set(); }
    this._applyFamilyChecks(this.container);
  }
  _applyFamilyChecks(root) {
    const fs = this._familySet || new Set();
    root.querySelectorAll('[data-catpath]').forEach(rowEl => {
      const p = rowEl.dataset.catpath;
      const isFamily = fs.has(p) || Array.from(fs).some(fp => p.indexOf(fp + '/') === 0);
      rowEl.classList.toggle('dtw-row-family', isFamily);
      rowEl.classList.toggle('dtw-row-adult', !isFamily);
    });
  }
  // 根目录的stat位:显示"📊统计"按钮 + 累加显示区
  _renderRootStatBtn(path) {
    const nid = this._nid(path);
    const el = document.getElementById(nid + '_stat');
    if (!el) return;
    const fwd = path.replace(/\\/g, '/').replace(/'/g, "\\'");
    el.innerHTML = `<span class="dtw-rootstat" id="${nid}_rootsum" style="color:#a78bfa">展开子目录后累加…</span> <a href="javascript:void(0)" data-statbtn="${fwd}" style="color:#40d0ff;text-decoration:underline;margin-left:6px">📊精确统计</a>`;
  }
  // 把某节点的待入库累加到所有祖先根目录的累加区
  _bubbleNotIn(path, notIn) {
    const fwd = path.replace(/\\/g, '/');
    this._notIn[fwd] = notIn;
    // 找属于哪个根,更新该根的累加区(累加该根下所有已统计节点)
    for (const rp of this._rootPaths) {
      if (fwd === rp || fwd.startsWith(rp + '/')) {
        let sum = 0;
        for (const k in this._notIn) { if (k === rp || k.startsWith(rp + '/')) sum += this._notIn[k]; }
        const sumEl = document.getElementById(this._nid(rp) + '_rootsum');
        if (sumEl) sumEl.textContent = sum > 0 ? `📥${sum}待入库(展开累加)` : '展开子目录后累加…';
        break;
      }
    }
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
      ? `<input type="checkbox" class="dtw-check" value="${fwd}" onchange="dtwCascadeCheck(this)" style="margin-top:4px;flex-shrink:0">` : '';
    const rootIcon  = this.icons.root  || (this.source==='pc'?'💻':'🗄');
    const childIcon = this.icons.child || '📁';
    const icon = isRoot ? rootIcon : childIcon;
    const actBtns = this.rowActions.map((a, i) =>
      `<button class="btn-sm" style="${a.color?`border-color:${a.color};color:${a.color}`:''}" data-act="${i}" data-path="${esc}">${a.icon||''} ${a.label}</button>`
    ).join('');
    const refreshBtn = this.showRefresh ? `<button class="btn-sm" data-rowrefresh="${esc}" title="刷新此目录">🔄</button>` : '';
    const infoBtn = this.showHoverCard ? `<button class="btn-sm dtw-info-btn" data-infopath="${esc}" title="查看详情">ℹ</button>` : '';
    const ctxAttr = this.contextMenu ? `data-ctx="${esc}"` : '';
    // family/adult 背景色由 _applyFamilyChecks 异步查完后再设(渲染时还不知道), id 便于之后精确定位这一行
    return `
    <div class="dtw-node" data-path="${fwd}">
      <div class="dtw-row" id="${nid}_row" data-catpath="${esc}" style="display:flex;align-items:center;gap:6px;padding:6px 0;border-bottom:1px solid #1a2433">
        ${guides}
        <span class="pc-toggle" data-toggle="${esc}" data-depth="${depth}" data-loaded="0">+</span>
        ${cb}
        <span class="dtw-name" data-select="${esc}" ${ctxAttr} style="cursor:pointer;font-size:.82rem;color:#c8dff5;flex:1;min-width:0;word-break:break-all">
          ${icon} ${this._esc(node.name)}
          <small class="dtw-stat" id="${nid}_stat" style="color:#507090;margin-left:8px;font-size:.72rem">${this.statFn===false?'':'…'}</small>
        </span>
        <span class="dtw-actions" style="display:flex;gap:5px;flex-shrink:0">
          ${infoBtn}
          ${refreshBtn}
          ${actBtns}
        </span>
      </div>
      <div class="dtw-children" id="${nid}_ch" style="display:none"></div>
    </div>`;
  }
  _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  // 入队统计(不立即发请求);priority=true 插队到最前(点击优先)
  _loadStat(path, priority) {
    if (this.statFn === false) return;
    const fwd = path.replace(/\\/g, '/');
    // 根目录不自动扫盘(给按钮)
    if (this._rootPaths.indexOf(fwd) >= 0) { this._renderRootStatBtn(fwd); return; }
    if (priority) {
      // 插队:移到队首(若已在队列先移除)
      const i = this._statQueue.indexOf(fwd);
      if (i >= 0) this._statQueue.splice(i, 1);
      this._statQueue.unshift(fwd);
      this._statSeen.add(fwd);
    } else {
      if (this._statSeen.has(fwd)) return;  // 已排过队/算过,不重复
      this._statSeen.add(fwd);
      this._statQueue.push(fwd);
    }
    this._pumpStat();
  }
  // 泵:在并发上限内取队首执行
  _pumpStat() {
    while (this._statRunning < this._statMax && this._statQueue.length) {
      const fwd = this._statQueue.shift();
      this._statRunning++;
      this._runStat(fwd).finally(() => { this._statRunning--; this._pumpStat(); });
    }
  }
  async _runStat(fwd) {
    const nid = this._nid(fwd);
    const el = document.getElementById(nid + '_stat');
    if (!el) return;  // 节点已不在(目录收起/刷新),跳过
    // 缓存优先:数字先出缓存值,后台修正(从缓存值"跳"到真实值,而不是先空白等待)
    const cached = await this._cacheGet('stat', fwd);
    if (cached) {
      const elc = document.getElementById(nid + '_stat');
      if (elc) elc.innerHTML = this.renderStat ? this.renderStat(cached) : this._defaultRenderStat(cached);
      this._bubbleNotIn(fwd, this._extractNotIn(cached));
    }
    try {
      const st = await this._fetchStat(fwd);
      this._cacheSet('stat', fwd, st);
      if (!cached || !(window.LocalCache && LocalCache.equal(cached, st))) {
        const el2 = document.getElementById(nid + '_stat');  // 重新取,防期间DOM变化
        if (el2) el2.innerHTML = this.renderStat ? this.renderStat(st) : this._defaultRenderStat(st);
        this._bubbleNotIn(fwd, this._extractNotIn(st));
      }
    } catch (e) { if (!cached && el) el.textContent = ''; }
  }
  // 点"📊精确统计":对该根目录强制扫盘统计(可能慢), 绕过缓存
  async _forceStatRoot(path) {
    const fwd = path.replace(/\\/g, '/');
    const nid = this._nid(fwd);
    const sumEl = document.getElementById(nid + '_rootsum');
    if (sumEl) sumEl.textContent = '统计中…';
    try {
      const st = await this._fetchStat(fwd, true);
      this._cacheSet('stat', fwd, st);
      const el = document.getElementById(nid + '_stat');
      if (el) el.innerHTML = (this.renderStat ? this.renderStat(st) : this._defaultRenderStat(st));
    } catch (e) { if (sumEl) sumEl.textContent = '统计失败'; }
  }
  // 渲染子目录列表(缓存命中/网络返回/后台校验修正都调这个, 逻辑只写一份)
  _renderChildren(ch, kids, depth) {
    if (Array.isArray(kids) && kids.length) {
      ch.innerHTML = kids.map(k => this._rowHtml(k, depth + 1)).join('');
      kids.forEach(k => this._loadStat(k.path));
      if (this.showFamilyCheck) this._applyFamilyChecks(ch);
    } else {
      ch.innerHTML = `<div style="color:#507090;font-size:.7rem;padding:3px 0 3px ${(depth+1)*18}px">（无子目录）</div>`;
    }
  }
  async _toggle(toggleEl) {
    const path  = toggleEl.dataset.toggle;
    const depth = parseInt(toggleEl.dataset.depth);
    const nid   = this._nid(path);
    const ch    = document.getElementById(nid + '_ch');
    if (!ch) return;
    if (ch.style.display === 'none') {
      if (toggleEl.dataset.loaded === '0') {
        const cached = await this._cacheGet('children', path);
        if (cached && Array.isArray(cached)) {
          // 缓存优先:立即渲染展开,不等网络。后台再校验修正,不阻塞。
          this._renderChildren(ch, cached, depth);
          toggleEl.dataset.loaded = '1';
          this._fetchChildren(path).then(kids => {
            if (!Array.isArray(kids)) return;
            this._cacheSet('children', path, kids);
            if (!(window.LocalCache && LocalCache.equal(cached, kids))) this._renderChildren(ch, kids, depth);
          }).catch(() => {});
        } else {
          toggleEl.textContent = '·';
          let kids = [];
          try { kids = await this._fetchChildren(path); } catch (e) {}
          this._renderChildren(ch, kids, depth);
          if (Array.isArray(kids)) this._cacheSet('children', path, kids);
          toggleEl.dataset.loaded = '1';
        }
      }
      ch.style.display = 'block';
      toggleEl.textContent = '−';
      this._setExpanded(path, true);
    } else {
      ch.style.display = 'none';
      toggleEl.textContent = '+';
      this._setExpanded(path, false);
    }
  }
  // 按记忆的展开状态自动展开(init 后调用一次), 静默失败不影响正常使用
  async _restoreExpanded() {
    const m = this._loadExpanded();
    const paths = Object.keys(m);
    if (!paths.length) return;
    // 按路径深度从浅到深展开, 保证父节点先展开、子节点的 toggle 元素才存在
    paths.sort((a, b) => a.split('/').length - b.split('/').length);
    for (const p of paths) {
      const nid = this._nid(p);
      const tg = this.container.querySelector('.pc-toggle[data-toggle="' + p.replace(/"/g, '\\"') + '"]');
      if (tg && tg.dataset.loaded === '0') {
        try { await this._toggle(tg); } catch (e) { /* 目录可能已不存在, 忽略 */ }
      }
    }
  }
  _select(path, nameEl) {
    this.selected = path;
    this._loadStat(path, true);  // 点击的目录:统计插队优先
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
    // 先固定初始位置渲染出来, 拿到真实尺寸后再做边界检测调整, 避免菜单超出屏幕右侧/底部导致点不到
    menu.style.cssText = `position:fixed;top:${e.clientY}px;left:${e.clientX}px;background:#1e2838;border:1px solid #2a3d55;border-radius:8px;padding:4px 0;z-index:99999;min-width:150px;box-shadow:0 4px 16px rgba(0,0,0,.5);visibility:hidden`;
    menu.innerHTML = items.map((it, i) => it.sep
      ? '<div style="border-top:1px solid #2a3d55;margin:4px 0"></div>'
      : `<div data-ctxitem="${i}" style="padding:8px 16px;cursor:pointer;font-size:.82rem;color:${it.color||'#c8dff5'}" onmouseover="this.style.background='#2a3d55'" onmouseout="this.style.background='transparent'">${it.icon||''} ${it.label}</div>`
    ).join('');
    document.body.appendChild(menu);

    // 边界检测: 菜单实际尺寸出来后, 若会超出视口就往反方向弹(靠右/靠下时贴着鼠标位置往左上展开)
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const margin = 6;   // 离屏幕边缘留一点间距, 不要贴死
    let left = e.clientX, top = e.clientY;
    if (left + rect.width  > vw - margin) left = Math.max(margin, vw - rect.width - margin);
    if (top  + rect.height > vh - margin) top  = Math.max(margin, vh - rect.height - margin);
    menu.style.left = left + 'px';
    menu.style.top  = top + 'px';
    menu.style.visibility = 'visible';

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
      const sb = e.target.closest('[data-statbtn]');
      if (sb) { this._forceStatRoot(sb.dataset.statbtn); return; }
      const rr = e.target.closest('[data-rowrefresh]');
      if (rr) { this._rowRefresh(rr.dataset.rowrefresh); return; }
      const tg = e.target.closest('.pc-toggle');
      if (tg) { this._toggle(tg); return; }
      const act = e.target.closest('[data-act]');
      if (act) { const i = parseInt(act.dataset.act); this.rowActions[i].fn(act.dataset.path); return; }
      const nm = e.target.closest('.dtw-name');
      if (nm) { this._select(nm.dataset.select, nm); return; }
    });
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
    try { kids = await this._fetchChildren(fwd); } catch(e) { if(typeof showToast==="function")showToast("加载失败: "+e.message,"error"); }
    this._renderChildren(ch, kids, depth);
    if (Array.isArray(kids)) this._cacheSet('children', fwd, kids);
    ch.style.display = 'block';
    tg.dataset.loaded = '1';
    tg.textContent = '\u2212';
    this._loadStat(fwd);
  }
  refresh() { this.init(); }
}
window.DirTreeWidget = DirTreeWidget;

// 已实例化的树注册表(用 instanceId 找回), 供全局函数(如 dtwSetFamily)刷新用
window._dtwInstances = window._dtwInstances || {};
const _origInit = DirTreeWidget.prototype.init;
DirTreeWidget.prototype.init = async function (...args) {
  window._dtwInstances[this.instanceId] = this;
  return _origInit.apply(this, args);
};

// 批量标记选中的目录为 家庭/成人。供顶部工具栏按钮调用, 复用现有的批量选中(dtw-check)。
// widget: DirTreeWidget 实例(mode='batch'); family: true=标记家庭, false=标记成人(即取消家庭标记)
async function dtwBatchSetCategory(widget, family) {
  if (!widget || typeof widget.getChecked !== 'function') return;
  const checked = widget.getChecked();
  if (!checked.length) { if (typeof showToast === 'function') showToast('请先勾选目录', 'error'); return; }
  let ok = 0, fail = 0;
  for (const path of checked) {
    try {
      const r = await fetch('/api/dir-category/set', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path, family: family })
      }).then(r => r.json());
      if (r.error) fail++; else ok++;
    } catch (e) { fail++; }
  }
  if (typeof showToast === 'function') {
    showToast(`已标记为${family ? '家庭' : '成人'}: 成功 ${ok} 个${fail ? ', 失败 ' + fail + ' 个' : ''}`, fail ? 'error' : 'success');
  }
  Object.values(window._dtwInstances).forEach(t => { if (t.showFamilyCheck) t._syncFamilyChecks(); });
}
window.dtwBatchSetCategory = dtwBatchSetCategory;

// ── 管理页专用操作(actions注入用，PC/NAS通吃) ──
async function dtwWriteMd5(path) {
  try {
    const isNas = path.startsWith('/share/');
    if (isNas) {
      // NAS路径: 用真正在NAS本地执行、不依赖PC的 /api/md5 接口
      const r = await fetch('/api/md5', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path }) });
      const d = await r.json();
      if (d.error) { showToast('打MD5失败: ' + d.error, 'error'); return; }
      if (d.taskId && typeof ProgressModal !== 'undefined') {
        showToast('NAS打MD5已开始', 'success');
        ProgressModal.open({ title: '🔑 打MD5进度', taskId: d.taskId });
      } else {
        showToast('已启动打MD5: ' + path, 'success');
      }
    } else {
      const r = await fetch('/api/pc/write-md5', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path }) });
      const d = await r.json();
      if (d.error) { showToast('打MD5失败: ' + d.error, 'error'); return; }
      showToast('已启动打MD5(PC): ' + path, 'success');
      if (typeof openProcessModal === 'function') openProcessModal();
    }
  } catch(e) { showToast('失败: ' + e.message, 'error'); }
}
async function dtwProcess(path) {
  try {
    const isNasPath = path.startsWith('/share/');
    const url = isNasPath ? '/api/process/nas' : '/api/process';
    const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ path }) });
    const d = await r.json();
    if (d.error) { showToast('处理失败: ' + d.error, 'error'); return; }
    if (d.routed === 'nas' && d.taskId && typeof ProgressModal !== 'undefined') {
      showToast('NAS处理已开始', 'success');
      ProgressModal.open({ title: '⚙ NAS处理进度', taskId: d.taskId });
    } else {
      showToast('已开始处理(PC)', 'success');
      if (typeof openProcessModal === 'function') openProcessModal();
    }
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
function dtwCascadeCheck(cb) {
  var node = cb.closest(".dtw-node");
  if (!node) return;
  node.querySelectorAll(".dtw-check").forEach(function(c) { c.checked = cb.checked; });
}

// ══ 视频操作(目录树右键菜单用)═══════════════════════

// 扫描该目录下的视频文件入库
async function dtwVideoScan(path) {
  try {
    showToast('正在扫描视频...', 'info');
    const r = await fetch('/api/video/scan-dir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path })
    });
    const d = await r.json();
    if (d.error) { showToast('扫描失败: ' + d.error, 'error'); return; }
    if (!d.scanned) {
      showToast('该目录下没有视频文件', 'error');
      return;
    }
    showToast('扫描 ' + d.scanned + ' 个视频, 新增 ' + d.added + ' 个' +
              (d.skipped ? (', 已存在 ' + d.skipped) : ''), 'success');
  } catch (e) { showToast('失败: ' + e.message, 'error'); }
}

// 把该目录的视频加入抽帧队列, 并给出 PC 端命令
async function dtwVideoShots(path) {
  try {
    const st = await fetch('/api/video/dir-stat?path=' + encodeURIComponent(path))
                 .then(function (r) { return r.json(); });
    if (st.error) { showToast(st.error, "error"); return; }

    if (!st.videos) {
      if (st.onDisk) {
        showToast('该目录有 ' + st.onDisk + ' 个视频但尚未入库, 请先「扫描视频入库」', 'error');
      } else {
        showToast('该目录下没有视频', 'error');
      }
      return;
    }

    var msg = "目录: " + path + "\n" +
              "已入库视频: " + st.videos + " 个\n" +
              "已抽帧: " + st.shotDone + "  待处理: " + st.shotPending + "  失败: " + st.shotFailed + "\n\n" +
              "确定把未完成的加入抽帧队列?";
    if (!confirm(msg)) return;

    const r = await fetch('/api/video/queue-dir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path })
    });
    const d = await r.json();
    if (d.error) { showToast('入队失败: ' + d.error, 'error'); return; }

    dtwShowVideoCmd(path, d.queued, d.total);
  } catch (e) { showToast('失败: ' + e.message, 'error'); }
}

// 弹窗: 显示 PC 端命令 + 实时进度
function dtwShowVideoCmd(dir, queued, total) {
  var old = document.getElementById("dtw-vcmd");
  if (old) old.remove();

  var cmd = "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\tools\\video_thumbs.ps1 -Dir \"" + dir + "\"";

  var m = document.createElement("div");
  m.id = "dtw-vcmd";
  m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;" +
                    "display:flex;align-items:center;justify-content:center";
  m.innerHTML =
    '<div style="background:#161d28;border:1px solid #2a3d55;border-radius:14px;' +
    'padding:24px 28px;min-width:560px;max-width:720px">' +
      '<div style="font-size:1rem;font-weight:700;color:#f0f6ff;margin-bottom:6px">🎞 视频抽帧</div>' +
      '<div style="font-size:.78rem;color:#8fa8c4;margin-bottom:16px;word-break:break-all">' +
        dir + '</div>' +
      '<div style="font-size:.82rem;color:#c8dff5;margin-bottom:14px">' +
        '已加入队列 <b style="color:#40d0ff">' + queued + '</b> 个 / 该目录共 ' + total + ' 个' +
      '</div>' +
      '<div style="font-size:.74rem;color:#507090;margin-bottom:6px">' +
        '抽帧在 PC 上执行。复制下面命令到 PowerShell 运行:</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:16px">' +
        '<input id="dtw-vcmd-txt" readonly value="' + cmd.replace(/"/g, "&quot;") + '" ' +
          'style="flex:1;background:#0e1620;border:1px solid #2a3d55;border-radius:6px;' +
          'color:#40d0ff;padding:8px 10px;font-family:monospace;font-size:.72rem">' +
        '<button id="dtw-vcmd-copy" style="padding:8px 14px;border-radius:6px;background:#40d0ff;' +
          'color:#000;border:none;cursor:pointer;font-weight:700;font-size:.76rem">复制</button>' +
      '</div>' +
      '<div style="font-size:.74rem;color:#507090;margin-bottom:5px">进度</div>' +
      '<div style="height:6px;background:#1e2838;border-radius:99px;overflow:hidden">' +
        '<div id="dtw-vcmd-bar" style="height:100%;width:0%;background:#40d0ff;transition:width .4s"></div>' +
      '</div>' +
      '<div id="dtw-vcmd-stat" style="font-size:.74rem;color:#8fa8c4;margin-top:7px">等待 PC 端开始…</div>' +
      '<button id="dtw-vcmd-close" style="width:100%;padding:10px;border-radius:7px;' +
        'background:#2a3d55;color:#c8dff5;border:none;cursor:pointer;font-weight:700;margin-top:16px">' +
        '关闭(后台继续)</button>' +
    '</div>';
  document.body.appendChild(m);

  var timer = null;
  var stop = function () { if (timer) clearInterval(timer); m.remove(); };
  document.getElementById("dtw-vcmd-close").onclick = stop;
  document.getElementById("dtw-vcmd-copy").onclick = function () {
    var inp = document.getElementById("dtw-vcmd-txt");
    inp.select();
    try { document.execCommand("copy"); showToast("命令已复制", "success"); }
    catch (e) { showToast("复制失败, 请手动选中", "error"); }
  };

  var poll = function () {
    fetch("/api/video/progress?dir=" + encodeURIComponent(dir))
      .then(function (r) { return r.json(); })
      .then(function (p) {
        var bar = document.getElementById("dtw-vcmd-bar");
        var st  = document.getElementById("dtw-vcmd-stat");
        if (!bar || !st) { if (timer) clearInterval(timer); return; }
        var pct = p.total ? Math.round(p.done / p.total * 100) : 0;
        bar.style.width = pct + "%";
        st.textContent = "已完成 " + p.done + " / " + p.total +
                         "   待处理 " + p.pending + "   失败 " + p.failed + "   (" + pct + "%)";
        if (p.pending === 0 && timer) {
          clearInterval(timer); timer = null;
          st.textContent += "   ✓ 全部完成";
          bar.style.background = "#3ddc84";
        }
      }).catch(function () {});
  };
  poll();
  timer = setInterval(poll, 2500);
}

window.dtwVideoScan  = dtwVideoScan;
window.dtwVideoShots = dtwVideoShots;
