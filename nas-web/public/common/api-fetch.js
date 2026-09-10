// api-fetch.js — 统一 API 请求入口(自动 JSON + 状态校验 + 统一错误提示)
// 从admin.js抽出来的共享工具,供photo/viewer/videoer三个页面共用
// (dir-tree-widget.js等common组件依赖它,以前只有admin.js定义,导致viewer/videoer页面调用时报错)

window.apiFetch = async function apiFetch(url, options = {}) {
  const { showError = true, method = "GET", body, ...rest } = options;
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...rest.headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...rest
    });
    // 非 2xx 状态直接抛错(带上URL和响应体原文, statusText有时候是空的)
    if (!res.ok) {
      let bodyText = '';
      try { bodyText = await res.text(); } catch (e2) {}
      const detail = [
        'HTTP ' + res.status + (res.statusText ? (' ' + res.statusText) : ''),
        'URL: ' + url,
        bodyText ? ('响应体: ' + bodyText.slice(0, 300)) : ''
      ].filter(Boolean).join(' | ');
      throw new Error(detail);
    }
    const data = await res.json();
    // 业务层错误 {error:"xxx"}
    if (data && data.error) throw new Error(data.error + ' | URL: ' + url);
    return data;
  } catch (e) {
    const baseMsg = (e && e.message) ? e.message : ((e && e.name) || '未知错误');
    const msg = baseMsg.indexOf('URL:') >= 0 ? baseMsg : (baseMsg + ' | URL: ' + url);
    console.error('[apiFetch失败]', url, e);
    if (showError && typeof showToast === "function") {
      showToast("请求失败: " + msg, "error");
    }
    throw e; // 仍向外抛，调用方可选择性处理
  }
};
