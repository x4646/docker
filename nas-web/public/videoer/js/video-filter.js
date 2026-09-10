// ========== 视频瀑布筛选器 · 修复版 ==========
console.log("✅ [video-filter.js] 开始加载...");

const VideoWaterfallFilter = {
  getQuery() {
    const tags = (document.getElementById("filter-tags")?.value || "").trim();
    const params = new URLSearchParams();
    const type = document.getElementById("filter-type")?.value?.trim();
    const rating = document.getElementById("filter-rating")?.value?.trim();
    const size = document.getElementById("filter-size")?.value?.trim();
    const duration = document.getElementById("filter-duration")?.value?.trim();
    if (type) params.set("type", type);
    if (tags) params.set("tags", tags.split(/[,，]/).map(t => t.trim()).filter(Boolean).join(","));
    if (rating) params.set("rating", rating);
    if (size) params.set("size", size);
    if (duration) params.set("duration", duration);
    return params.toString();
  },

  getHTML() {
    return "<div id=\"video-filter-panel\" style=\"padding:14px 18px;background:#141d29;border:1px solid #2a3d55;border-radius:10px;margin-bottom:16px;box-shadow:0 4px 14px rgba(0,0,0,.35);\">" +
      "<div style=\"display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;\">" +
      "<h4 style=\"margin:0;color:#40d0ff;font-size:.92rem;font-weight:700;\">🔍 视频筛选</h4>" +
      "<button id=\"video-filter-reset\" style=\"background:none;border:none;color:#ff5567;cursor:pointer;font-size:.78rem;\">重置</button>" +
      "</div>" +
      "<div style=\"display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px 14px;\">" +
      
      "<div><label style=\"display:block;font-size:.75rem;color:#507090;margin-bottom:4px;\">文件类型</label>" +
      "<select id=\"filter-type\" style=\"width:100%;padding:6px 8px;background:#0f1319;border:1px solid #2a3d55;border-radius:5px;color:#c8dff5;font-size:.8rem;outline:none;\">" +
      "<option value=\"\">全部</option><option value=\"video\">视频</option><option value=\"image\">图片</option></select></div>" +
      
      "<div><label style=\"display:block;font-size:.75rem;color:#507090;margin-bottom:4px;\">标签</label>" +
      "<input id=\"filter-tags\" type=\"text\" placeholder=\"逗号分隔\" style=\"width:100%;padding:6px 8px;background:#0f1319;border:1px solid #2a3d55;border-radius:5px;color:#c8dff5;font-size:.8rem;outline:none;\" /></div>" +
      
      "<div><label style=\"display:block;font-size:.75rem;color:#507090;margin-bottom:4px;\">喜好/分级</label>" +
      "<select id=\"filter-rating\" style=\"width:100%;padding:6px 8px;background:#0f1319;border:1px solid #2a3d55;border-radius:5px;color:#c8dff5;font-size:.8rem;outline:none;\">" +
      "<option value=\"\">全部</option><option value=\"favorite\">⭐ 收藏</option><option value=\"good\">👍 喜欢</option>" +
      "<option value=\"normal\">⚪ 普通</option><option value=\"bad\">👎 不喜欢</option><option value=\"adult\">🔞 成人</option><option value=\"family\">👨‍👩‍👧 家庭</option></select></div>" +
      
      "<div><label style=\"display:block;font-size:.75rem;color:#507090;margin-bottom:4px;\">文件大小</label>" +
      "<select id=\"filter-size\" style=\"width:100%;padding:6px 8px;background:#0f1319;border:1px solid #2a3d55;border-radius:5px;color:#c8dff5;font-size:.8rem;outline:none;\">" +
      "<option value=\"\">全部</option><option value=\"gt4GB\">> 4 GB</option><option value=\"gt2GB\">> 2 GB</option><option value=\"gt1GB\">> 1 GB</option>" +
      "<option value=\"gt500MB\">> 500 MB</option><option value=\"lt100MB\">≤ 100 MB</option></select></div>" +
      
      "<div><label style=\"display:block;font-size:.75rem;color:#507090;margin-bottom:4px;\">时长</label>" +
      "<select id=\"filter-duration\" style=\"width:100%;padding:6px 8px;background:#0f1319;border:1px solid #2a3d55;border-radius:5px;color:#c8dff5;font-size:.8rem;outline:none;\">" +
      "<option value=\"\">全部</option><option value=\"lt5min\">≤ 5 分钟</option><option value=\"lt15min\">≤ 15 分钟</option><option value=\"lt30min\">≤ 30 分钟</option>" +
      "<option value=\"lt1hour\">≤ 1 小时</option><option value=\"gt1hour\">> 1 小时</option><option value=\"gt2hour\">> 2 小时</option></select></div>" +
      "</div>" +
      
      "<div style=\"display:flex;gap:10px;margin-top:12px;\">" +
      "<button id=\"video-filter-apply\" style=\"padding:7px 18px;background:#40d0ff;border:none;border-radius:6px;color:#000;font-weight:700;cursor:pointer;font-size:.82rem;\">🔎 查询</button>" +
      "<button id=\"video-filter-reset-btn\" style=\"padding:7px 14px;background:transparent;border:1px solid #2a3d55;border-radius:6px;color:#90b8d8;cursor:pointer;font-size:.82rem;\">重置</button>" +
      "</div></div>";
  },

  mount() {
    console.log("🔧 开始挂载筛选面板...");
    
    // 尝试多种常见容器选择器，自动适配你的页面
    const selectors = ["#video-waterfall", "#waterfall", ".video-list", ".container", "main", "body"];
    let container = null;
    for (const sel of selectors) {
      container = document.querySelector(sel);
      if (container) {
        console.log("✅ 找到挂载容器:", sel);
        break;
      }
    }
    if (!container) {
      console.warn("❌ 未找到任何容器，挂载到 body");
      container = document.body;
    }

    // 防止重复挂载
    if (document.getElementById("video-filter-panel")) {
      console.log("ℹ️ 面板已存在，跳过");
      return;
    }

    // 插入面板
    const el = document.createElement("div");
    el.innerHTML = this.getHTML();
    container.parentNode.insertBefore(el.firstElementChild, container);
    console.log("✅ 筛选面板已显示！");

    this.bindEvents();
    this.loadFromUrl();
  },

  bindEvents() {
    document.getElementById("video-filter-apply")?.addEventListener("click", () => this.apply());
    document.getElementById("video-filter-reset")?.addEventListener("click", () => this.reset());
    document.getElementById("video-filter-reset-btn")?.addEventListener("click", () => this.reset());
    document.getElementById("filter-tags")?.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); this.apply(); }
    });
  },

  apply() {
    const qs = this.getQuery();
    const url = new URL(window.location);
    url.search = qs ? ("?" + qs) : "";
    window.history.replaceState({}, "", url);
    console.log("📋 筛选条件:", qs);
    if (window.resetVideoWaterfall) {
      window.resetVideoWaterfall(qs);
    } else if (typeof showToast === "function") {
      showToast(qs ? "筛选已应用" : "筛选已清除", "success");
    }
  },

  reset() {
    document.getElementById("filter-type").value = "";
    document.getElementById("filter-tags").value = "";
    document.getElementById("filter-rating").value = "";
    document.getElementById("filter-size").value = "";
    document.getElementById("filter-duration").value = "";
    const url = new URL(window.location);
    url.search = "";
    window.history.replaceState({}, "", url);
    if (window.resetVideoWaterfall) window.resetVideoWaterfall("");
  },

  loadFromUrl() {
    const p = new URLSearchParams(window.location.search);
    if (p.has("type")) document.getElementById("filter-type").value = p.get("type");
    if (p.has("tags")) document.getElementById("filter-tags").value = p.get("tags");
    if (p.has("rating")) document.getElementById("filter-rating").value = p.get("rating");
    if (p.has("size")) document.getElementById("filter-size").value = p.get("size");
    if (p.has("duration")) document.getElementById("filter-duration").value = p.get("duration");
  },

  init() {
    console.log("🔧 VideoWaterfallFilter.init() 执行");
    // 多重保障：多种时机尝试挂载
    const tryMount = () => { this.mount(); };
    
    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(() => this.mount(), 50);
    } else {
      document.addEventListener("DOMContentLoaded", () => this.mount());
      window.addEventListener("load", () => this.mount());
    }
  }
};

// 立即初始化 + 延迟兜底
VideoWaterfallFilter.init();
setTimeout(() => {
  if (!document.getElementById("video-filter-panel")) {
    console.log("🔧 兜底挂载...");
    VideoWaterfallFilter.mount();
  }
}, 800);

console.log("✅ [video-filter.js] 加载完成！");
