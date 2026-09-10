/**
 * api-client.js
 * 封装所有后端 HTTP 调用。UI 层（app.js）只调这里的函数，不直接 fetch。
 * 错误统一在 request() 处理：非 2xx 抛出含 detail 的 Error。
 */

const API = "/api/notepad";

/**
 * 底层 fetch 封装。
 * @param {string} method
 * @param {string} path
 * @param {{ body?: unknown, query?: Record<string, string> }} [opts]
 */
async function request(method, path, { body, query } = {}) {
  let url = API + path;
  if (query) {
    const params = new URLSearchParams(
      Object.fromEntries(Object.entries(query).filter(([, v]) => v != null))
    );
    if ([...params].length) url += "?" + params.toString();
  }

  const options = {
    method,
    headers: {},
  };

  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (res.status === 204) return null; // 无响应体

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data?.detail ?? `HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status, data });
  }

  return data;
}

// ── 笔记 API（SPEC 6.3）────────────────────────────────────────────────────

/** 列出活跃笔记；q 为搜索词（可选）。*/
export async function listNotes(q = null) {
  return request("GET", "/notes", { query: q ? { q } : {} });
}

/** 读单篇笔记（含完整内容）。*/
export async function getNote(id) {
  return request("GET", `/notes/${id}`);
}

/** 新建笔记；title/content 均可不传。*/
export async function createNote(data = {}) {
  return request("POST", "/notes", { body: data });
}

/**
 * 部分更新笔记（自动保存高频调用）。
 * 返回 { id, updated_at }。
 */
export async function updateNote(id, data) {
  return request("PATCH", `/notes/${id}`, { body: data });
}

/** 软删：移入回收站。*/
export async function deleteNote(id) {
  return request("DELETE", `/notes/${id}`);
}

// ── 回收站 API（SPEC 6.4）──────────────────────────────────────────────────

/** 回收站列表。*/
export async function listTrash() {
  return request("GET", "/trash");
}

/** 恢复笔记。*/
export async function restoreNote(id) {
  return request("POST", `/notes/${id}/restore`);
}

/** 永久删除单条。*/
export async function purgeNote(id) {
  return request("DELETE", `/trash/${id}`);
}

/** 清空回收站。*/
export async function emptyTrash() {
  return request("DELETE", "/trash");
}

// ── 附件 API（预留，SPEC 6.5）──────────────────────────────────────────────
// TODO(attachments): uploadAttachment(noteId, file)
// TODO(attachments): listAttachments(noteId)
// TODO(attachments): deleteAttachment(id)
