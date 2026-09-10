// error_list_page.js — 独立的"错误清单"弹层, 不依赖目录树/筛选栏
//
// 打开方式: openErrorListModal()
// 布局: 顶部功能类型按钮(带数量) -> 搜索框 -> 分页清单(路径+错误文本+复制按钮)

let _errListState = { feature: null, q: '', offset: 0, limit: 50 };

async function openErrorListModal() {
  let modal = document.getElementById('errlist-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'errlist-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center';
    modal.innerHTML =
      '<div style="width:min(720px,92vw);max-height:84vh;display:flex;flex-direction:column;' +
      'background:#141d29;border:1px solid #2a3d55;border-radius:12px;overflow:hidden">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #2a3d55">' +
          '<span style="font-size:.94rem;font-weight:700;color:#f0f6ff">错误清单</span>' +
          '<span id="errlist-close" style="cursor:pointer;color:#8aa8c8;font-size:.9rem">&#10005;</span>' +
        '</div>' +
        '<div style="padding:12px 18px;border-bottom:1px solid #2a3d55">' +
          '<div id="errlist-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">加载中…</div>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<input id="errlist-q" placeholder="按路径关键词过滤" style="flex:1;max-width:280px;padding:6px 10px;' +
              'background:#0f1620;border:1px solid #2a3d55;border-radius:6px;color:#c8dff5;font-size:.78rem">' +
            '<span id="errlist-count" style="margin-left:auto;font-size:.78rem;color:#8aa8c8"></span>' +
          '</div>' +
        '</div>' +
        '<div id="errlist-body" style="flex:1;overflow-y:auto;padding:8px 0"></div>' +
        '<div style="display:flex;justify-content:center;padding:10px;border-top:1px solid #2a3d55">' +
          '<button id="errlist-more" class="btn-sm" style="display:none">加载更多</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeErrorListModal(); });
    document.getElementById('errlist-close').onclick = closeErrorListModal;
    document.getElementById('errlist-more').onclick = () => loadErrFeed(true);

    let qTimer = null;
    document.getElementById('errlist-q').addEventListener('input', (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => {
        _errListState.q = e.target.value.trim();
        _errListState.offset = 0;
        loadErrFeed(false);
      }, 300);
    });
  }
  modal.style.display = 'flex';
  await loadErrTabs();
}

function closeErrorListModal() {
  const modal = document.getElementById('errlist-modal');
  if (modal) modal.style.display = 'none';
}

async function loadErrTabs() {
  const tabsEl = document.getElementById('errlist-tabs');
  let counts;
  try { counts = await fetch('/api/errors/counts').then(r => r.json()); }
  catch (e) { tabsEl.textContent = '加载失败'; return; }

  const LABELS = { video_shots: '视频抽帧', md5_write: '打MD5', photo_process: '图片处理', clip_tag: 'CLIP打标签', feat_extract: '特征提取' };
  const ORDER = ['video_shots', 'md5_write', 'photo_process', 'clip_tag', 'feat_extract'];

  if (!_errListState.feature) {
    // 默认选中错误数最多的那一类, 没有任何错误就选第一个
    const withCount = ORDER.map(k => [k, counts[k] || 0]).sort((a, b) => b[1] - a[1]);
    _errListState.feature = withCount[0][1] > 0 ? withCount[0][0] : ORDER[0];
  }

  tabsEl.innerHTML = ORDER.map(k => {
    const on = k === _errListState.feature;
    return `<button class="btn-sm errlist-tab" data-feat="${k}" style="${on ?
      'background:#40d0ff;color:#04121c;border-color:#40d0ff;font-weight:700' :
      'color:#8aa8c8'}">${LABELS[k]} <span style="opacity:.75">${counts[k] || 0}</span></button>`;
  }).join('');
  tabsEl.querySelectorAll('.errlist-tab').forEach(btn => {
    btn.onclick = () => {
      if (_errListState.feature === btn.dataset.feat) return;   // 已经选中的再点一下不用重新加载
      _errListState.feature = btn.dataset.feat;
      _errListState.offset = 0;
      // 只需要重新高亮当前按钮组(不用重新拉一次 counts), 加载新类型的第一页
      tabsEl.querySelectorAll('.errlist-tab').forEach(b => {
        const active = b.dataset.feat === _errListState.feature;
        b.style.cssText = active ?
          'background:#40d0ff;color:#04121c;border-color:#40d0ff;font-weight:700' : 'color:#8aa8c8';
      });
      loadErrFeed(false);
    };
  });

  await loadErrFeed(false);
}

async function loadErrFeed(append) {
  const bodyEl = document.getElementById('errlist-body');
  const moreBtn = document.getElementById('errlist-more');
  const countEl = document.getElementById('errlist-count');
  if (!append) { _errListState.offset = 0; bodyEl.innerHTML = '<div style="padding:20px;text-align:center;color:#507090">加载中…</div>'; }

  const qs = new URLSearchParams({
    feature: _errListState.feature, q: _errListState.q,
    offset: String(_errListState.offset), limit: String(_errListState.limit)
  });
  let data;
  try { data = await fetch('/api/errors/feed?' + qs.toString()).then(r => r.json()); }
  catch (e) { bodyEl.innerHTML = '<div style="padding:20px;text-align:center;color:#ff5567">加载失败</div>'; return; }
  if (data.error) { bodyEl.innerHTML = '<div style="padding:20px;text-align:center;color:#ff5567">' + data.error + '</div>'; return; }

  if (countEl) countEl.textContent = `共 ${data.total} 条`;

  const rowsHtml = (data.items || []).map(it => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:9px 18px;border-bottom:1px solid #1a2433">
      <div style="min-width:0;flex:1">
        <div style="font-family:monospace;font-size:.72rem;color:#c8dff5;word-break:break-all">${escHtml(it.path)}</div>
        <div style="font-size:.7rem;color:#ff5567;margin-top:3px">${escHtml(it.error)}</div>
      </div>
      <button class="btn-sm errlist-copy" data-path="${escHtml(it.path)}" style="flex-shrink:0;padding:3px 10px;font-size:.7rem">复制路径</button>
    </div>`).join('');

  if (append) bodyEl.insertAdjacentHTML('beforeend', rowsHtml);
  else bodyEl.innerHTML = rowsHtml || '<div style="padding:24px;text-align:center;color:#3ddc84">没有错误 🎉</div>';

  bodyEl.querySelectorAll('.errlist-copy').forEach(btn => {
    btn.onclick = () => {
      navigator.clipboard.writeText(btn.dataset.path).then(() => {
        if (typeof showToast === 'function') showToast('已复制路径', 'success');
      }).catch(() => { if (typeof showToast === 'function') showToast('复制失败', 'error'); });
    };
  });

  const loadedSoFar = _errListState.offset + (data.items || []).length;
  _errListState.offset = loadedSoFar;
  moreBtn.style.display = loadedSoFar < data.total ? '' : 'none';
}
