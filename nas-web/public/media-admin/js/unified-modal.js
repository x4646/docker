// ==========================================
// 统一模态框 + 统一进度弹窗 + 统一taskId轮询
// ==========================================

window.UnifiedModal = {
  ensure() {
    let el = document.getElementById("unified-modal");
    if (el) return el;
    el = document.createElement("div");
    el.id = "unified-modal";
    el.style.cssText = "display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);align-items:center;justify-content:center;padding:16px";
    // 2026-09-20: 原来min-width:300px, 加上外层16px padding, 在320px宽的小屏手机上会溢出——
    // 改用width:min(480px,92vw), 桌面不变, 窄屏自动收到视口的92%
    el.innerHTML = "<div id=\"unified-modal-box\" style=\"width:min(480px,92vw);box-sizing:border-box;max-height:85vh;overflow-y:auto;\">" +
      "<div id=\"unified-modal-head\" style=\"display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #2a3d55;\">" +
      "<span id=\"unified-modal-title\" style=\"font-weight:700;color:#40d0ff;font-size:.95rem;\"></span>" +
      "<span id=\"unified-modal-close\" style=\"cursor:pointer;color:#507090;font-size:1.1rem;line-height:1\">&#10005;</span>" +
      "</div>" +
      "<div id=\"unified-modal-body\" style=\"padding:16px;color:#c8dff5;font-size:.82rem;line-height:1.5;\"></div>" +
      "</div>";
    document.body.appendChild(el);
    el.addEventListener("click", e => { if (e.target === el) this.close(); });
    el.querySelector("#unified-modal-close").addEventListener("click", () => this.close());
    return el;
  },
  open(opt) {
    opt = opt || {};
    const el = this.ensure();
    document.getElementById("unified-modal-title").textContent = opt.title || "";
    document.getElementById("unified-modal-body").innerHTML = opt.content || "";
    this._onClose = opt.onClose;
    el.style.display = "flex";
  },
  close() {
    const el = document.getElementById("unified-modal");
    if (el) el.style.display = "none";
    if (this._onClose) { this._onClose(); this._onClose = null; }
  }
};

window.UnifiedProgress = {
  timers: {},
  ensure() {
    let el = document.getElementById("unified-progress-modal");
    if (el) return el;
    el = document.createElement("div");
    el.id = "unified-progress-modal";
    el.style.cssText = "display:none;position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.55);align-items:center;justify-content:center;padding:16px";
    // 2026-09-20: 原来固定380px, 手机上(比如375px宽的屏幕再减去外层16px padding)会溢出——
    // 改用width:min(380px,92vw)
    el.innerHTML = "<div style=\"width:min(380px,92vw);box-sizing:border-box;padding:18px;border-radius:10px;background:#141d29;border:1px solid #2a3d55;box-shadow:0 14px 44px rgba(0,0,0,.6);\">" +
      "<div id=\"up-title\" style=\"font-weight:700;color:#40d0ff;margin-bottom:12px;\"></div>" +
      "<div id=\"up-status\" style=\"color:#c8dff5;font-size:.82rem;margin-bottom:10px;\">请求中…</div>" +
      "<div style=\"height:8px;background:#1e2838;border-radius:4px;overflow:hidden;margin-bottom:8px;\">" +
      "<div id=\"up-bar\" style=\"width:0%;height:100%;background:linear-gradient(90deg,#40d0ff,#3ddc84);border-radius:4px;transition:width .25s;\"></div>" +
      "</div>" +
      "<div id=\"up-pct\" style=\"text-align:right;font-size:.72rem;color:#507090;\">0%</div>" +
      "</div>";
    document.body.appendChild(el);
    return el;
  },
  async open(taskId, opt) {
    opt = opt || {};
    this.close(taskId);
    const el = this.ensure();
    document.getElementById("up-title").textContent = opt.title || "处理中…";
    document.getElementById("up-status").textContent = "请求中…";
    document.getElementById("up-bar").style.width = "0%";
    document.getElementById("up-pct").textContent = "0%";
    el.style.display = "flex";
    const intervalMs = opt.intervalMs || 1500;
    const baseUrl = opt.baseUrl || "/api/task/status";
    let count = 0, maxCount = opt.maxCount || 200;
    const poll = async () => {
      try {
        const d = await apiFetch(baseUrl + "?taskId=" + encodeURIComponent(taskId), { showError: false });
        if (!d) return;
        const pct = Math.max(0, Math.min(100, d.progress || 0));
        document.getElementById("up-bar").style.width = pct + "%";
        document.getElementById("up-pct").textContent = pct + "%";
        document.getElementById("up-status").textContent = d.message || d.status || "处理中…";
        if (d.status === "done" || d.status === "success" || d.ready) {
          this.close(taskId);
          if (opt.onDone) opt.onDone(null, d);
          return;
        }
        if (d.status === "error" || d.error) {
          this.close(taskId);
          if (typeof showToast === "function") showToast(d.error || "任务失败", "error");
          if (opt.onDone) opt.onDone(d.error || new Error("任务失败"), null);
          return;
        }
        if (++count >= maxCount) {
          this.close(taskId);
          if (typeof showToast === "function") showToast("轮询超时", "error");
          if (opt.onDone) opt.onDone(new Error("timeout"), null);
        }
      } catch (e) { console.warn("进度轮询异常:", e); }
    };
    poll();
    this.timers[taskId] = setInterval(poll, intervalMs);
  },
  close(taskId) {
    if (taskId && this.timers[taskId]) {
      clearInterval(this.timers[taskId]);
      delete this.timers[taskId];
    }
    const el = document.getElementById("unified-progress-modal");
    if (el) el.style.display = "none";
  }
};

window.addEventListener("beforeunload", () => {
  Object.keys(UnifiedProgress.timers).forEach(id => UnifiedProgress.close(id));
});
