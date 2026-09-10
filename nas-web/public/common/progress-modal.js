/*
 * progress-modal.js — 通用进度弹窗控件(公共,放 common/)
 * 任何返回 taskId 的异步任务都能用它显示「排队 + 当前任务文件级进度」。
 * 样式沿用项目深色主题。
 *
 * 用法:
 *   ProgressModal.open({ title:'⚙ NAS处理进度', taskId:'xxx' });
 *   ProgressModal.open({ title, taskId, endpoint:'/api/process/progress', interval:2000, onClose });
 *   ProgressModal.update({ queued, running, doneFiles, totalFiles, failFiles, status }); // 手动
 *   ProgressModal.close();
 *
 * 进度接口约定 GET {endpoint}/{taskId} 返回:
 *   { status:'running'|'done'|'error',
 *     queued:[dir,...],
 *     running:[{dir,done,total,current},...],
 *     totalFiles, doneFiles, failFiles }
 */
(function () {
  const ID = 'common-progress-modal';
  let timer = null;
  let opts = {};
  let _escHandler = null;

  function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

  function ensureDom(title) {
    let modal = document.getElementById(ID);
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = ID;
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:center;justify-content:center';
    modal.innerHTML =
      '<div style="background:#161d28;border:1px solid #2a3d55;border-radius:14px;padding:24px 28px;min-width:520px;max-width:680px;max-height:82vh;overflow:auto">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">'
      + '<span id="cpm-title" style="font-size:1rem;font-weight:700;color:#f0f6ff">' + esc(title || '进度') + '</span>'
      + '<span id="cpm-pool" style="font-size:.74rem;color:#507090">—</span>'
      + '</div>'
      + '<div id="cpm-list" style="font-size:.8rem;color:#507090">加载中...</div>'
      + '<div id="cpm-total" style="font-size:.78rem;color:#c8dff5;margin-top:12px;padding-top:10px;border-top:1px solid #1e2838"></div>'
      + '<button id="cpm-close" style="width:100%;padding:10px;border-radius:7px;background:#40d0ff;color:#000;border:none;cursor:pointer;font-weight:700;margin-top:14px">关闭（后台继续处理）</button>'
      + '</div>';
    document.body.appendChild(modal);
    document.getElementById('cpm-close').onclick = () => ProgressModal.close();
    // 仅「关闭」按钮可关闭(遮罩点击/ESC 不关,防误触中断查看)
    return modal;
  }

  function renderBar(pct, color) {
    return '<div style="height:5px;background:#1e2838;border-radius:99px;overflow:hidden;margin-bottom:3px">'
      + '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:99px;transition:width .4s"></div></div>';
  }

  function render(d) {
    const listEl = document.getElementById('cpm-list');
    const poolEl = document.getElementById('cpm-pool');
    const totEl  = document.getElementById('cpm-total');
    if (!listEl) return;
    d = d || {};
    const running = d.running || [];
    const queued  = d.queued  || [];

    if (poolEl) poolEl.textContent = '运行 ' + running.length + ' · 排队 ' + queued.length;

    if (!running.length && !queued.length) {
      if (d.status === 'error') {
        // #3 错误状态:红色显示,不能误显示成成功
        listEl.innerHTML = '<div style="color:#ff5567;padding:8px 0">❌ 处理出错' + (d.error ? ': ' + esc(d.error) : '') + '</div>';
      } else if (d.status === 'done') {
        // b 完成:显示结果汇总(成功/失败)
        const dn = d.doneFiles || 0, fl = d.failFiles || 0;
        listEl.innerHTML = '<div style="color:#3ddc84;padding:8px 0;font-size:.9rem">✅ 全部完成</div>'
          + '<div style="color:#c8dff5;font-size:.78rem">成功 ' + dn + ' 张'
          + (fl ? ' · <span style="color:#ff5567">失败 ' + fl + ' 张</span>' : '') + '</div>';
      } else {
        // #2 未开始/准备中(status还是running但还没填充)→ 不要显示"全部完成"
        listEl.innerHTML = '<div style="color:#507090;padding:8px 0">准备中…</div>';
      }
    } else {
      const rows = [];
      for (const r of running) {
        const total = r.total || 0, done = r.done || 0, pending = Math.max(0, total - done);
        const pct = total ? Math.round(done / total * 100) : 0;
        rows.push(
          '<div style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #1e2838">'
          + '<div style="display:flex;justify-content:space-between;margin-bottom:4px">'
          + '<span style="color:#40d0ff;font-family:monospace;font-size:.74rem;word-break:break-all">▶ ' + esc(r.dir) + '</span>'
          + '<span style="color:#3ddc84;flex-shrink:0;margin-left:8px">' + pct + '%</span>'
          + '</div>'
          + renderBar(pct, '#3ddc84')
          + '<div style="font-size:.7rem;color:#507090">'
          + (r.current ? '当前: ' + esc(r.current) + ' · ' : '')
          + '已处理 ' + done + ' / 待处理 ' + pending + ' · 共 ' + total + '</div>'
          + '</div>'
        );
      }
      if (queued.length) {
        rows.push('<div style="margin-bottom:6px;color:#ffa500;font-size:.74rem;font-family:monospace">⏳ 排队中: ' + queued.map(esc).join(', ') + '</div>');
      }
      listEl.innerHTML = rows.join('');
    }

    if (totEl) {
      if (d.totalFiles != null) {
        const pct = d.totalFiles ? Math.round((d.doneFiles || 0) / d.totalFiles * 100) : 0;
        totEl.innerHTML = '总进度: ' + (d.doneFiles || 0) + ' / ' + d.totalFiles + ' 文件 (' + pct + '%)'
          + (d.failFiles ? ' · <span style="color:#ff5567">失败 ' + d.failFiles + '</span>' : '');
      } else {
        totEl.innerHTML = '';
      }
    }
  }

  async function poll() {
    if (!opts.taskId) return;
    const base = opts.endpoint || '/api/process/progress';
    let d;
    try {
      d = await apiFetch(base + '/' + encodeURIComponent(opts.taskId));
    } catch (e) { return; }
    render(d);
    // 完成或出错 → 停止轮询(保留弹窗显示结果),按钮变"关闭"
    if (d && (d.status === 'done' || d.status === 'error')) {
      if (timer) { clearInterval(timer); timer = null; }
      const btn = document.getElementById('cpm-close');
      if (btn) { btn.textContent = '关闭'; btn.style.background = d.status === 'error' ? '#ff5567' : '#3ddc84'; }
    }
  }

  window.ProgressModal = {
    open(o) {
      opts = o || {};
      ensureDom(opts.title);
      const t = document.getElementById('cpm-title');
      if (t && opts.title) t.textContent = opts.title;
      if (timer) { clearInterval(timer); timer = null; }
      if (opts.taskId) {
        poll();
        timer = setInterval(poll, opts.interval || 2000);
      }
    },
    update(d) { ensureDom(opts.title); render(d); },
    close() {
      if (timer) { clearInterval(timer); timer = null; }
      if (_escHandler) { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
      const m = document.getElementById(ID);
      if (m) m.remove();
      const cb = opts.onClose;
      opts = {};
      if (typeof cb === 'function') { try { cb(); } catch (e) {} }
    }
  };
})();
