/**
 * app.js — UI 逻辑
 * 只调 api-client.js，不直接 fetch。
 */

import {
  createNote,
  deleteNote,
  emptyTrash,
  getNote,
  listNotes,
  listTrash,
  purgeNote,
  restoreNote,
  updateNote,
} from "./api-client.js";

// ── 状态 ────────────────────────────────────────────────────────────────────
const state = {
  currentNoteId: null,   // 当前编辑中的笔记 ID
  isDirty: false,        // 有未保存更改
  saveTimer: null,       // debounce timer
  view: "notes",         // "notes" | "trash"
};

// ── DOM 引用 ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const noteList    = $("note-list");
const titleInput  = $("title-input");
const contentInput = $("content-input");
const searchInput = $("search-input");
const saveStatus  = $("save-status");
const editorArea  = $("editor-area");
const emptyState  = $("empty-state");
const trashView   = $("trash-view");
const trashList   = $("trash-list");
const toast       = $("toast");

// ── Toast 通知 ───────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, isErr = false) {
  toast.textContent = msg;
  toast.classList.toggle("err", isErr);
  toast.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}

// ── 保存状态 UI ──────────────────────────────────────────────────────────────
function setSaveStatus(st, time = null) {
  saveStatus.className = st;
  if (st === "saving") {
    saveStatus.textContent = "保存中…";
  } else if (st === "saved") {
    const t = time ? new Date(time) : new Date();
    const hhmm = t.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    saveStatus.textContent = `已保存 ${hhmm}`;
  } else if (st === "error") {
    saveStatus.textContent = "保存失败";
  } else {
    saveStatus.textContent = "";
  }
}

// ── 列表渲染 ─────────────────────────────────────────────────────────────────
function renderNoteList(notes) {
  noteList.innerHTML = "";
  if (!notes.length) {
    noteList.innerHTML = '<p style="padding:16px;color:var(--text-dim);font-size:13px;">暂无笔记</p>';
    return;
  }
  notes.forEach((note) => {
    const el = document.createElement("div");
    el.className = "note-item" + (note.id === state.currentNoteId ? " active" : "");
    el.dataset.id = note.id;

    const displayTitle = note.title || note.preview || "无标题";
    const time = new Date(note.updated_at).toLocaleDateString("zh-CN", {
      month: "short", day: "numeric",
    });

    el.innerHTML = `
      <div class="item-title">${escHtml(displayTitle)}</div>
      <div class="item-preview">${escHtml(note.preview)}</div>
      <div class="item-time">${time}</div>
    `;

    // 双击进入该笔记
    el.addEventListener("dblclick", () => loadNote(note.id));
    // 单击也可切换（移动端友好）
    el.addEventListener("click", () => loadNote(note.id));

    noteList.appendChild(el);
  });
}

// ── 加载笔记到编辑区 ─────────────────────────────────────────────────────────
async function loadNote(id) {
  try {
    const note = await getNote(id);
    state.currentNoteId = note.id;
    state.isDirty = false;
    titleInput.value = note.title;
    contentInput.value = note.content;
    setSaveStatus("");
    showEditorArea();
    contentInput.focus();
    refreshListHighlight();
  } catch (e) {
    showToast("加载笔记失败：" + e.message, true);
  }
}

// ── 新建笔记 ─────────────────────────────────────────────────────────────────
async function newNote() {
  try {
    // 建空笔记，光标即时落位，内容边打边保存
    const note = await createNote({});
    state.currentNoteId = note.id;
    state.isDirty = false;
    titleInput.value = "";
    contentInput.value = "";
    setSaveStatus("");
    showEditorArea();
    contentInput.focus();
    await refreshNoteList();
    refreshListHighlight();
  } catch (e) {
    showToast("新建笔记失败：" + e.message, true);
  }
}

// ── 自动保存（debounce 600ms）────────────────────────────────────────────────
function scheduleAutoSave() {
  if (!state.currentNoteId) return;
  state.isDirty = true;
  setSaveStatus("saving");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(doSave, 600);
}

async function doSave() {
  if (!state.currentNoteId || !state.isDirty) return;
  try {
    const res = await updateNote(state.currentNoteId, {
      title: titleInput.value,
      content: contentInput.value,
    });
    state.isDirty = false;
    setSaveStatus("saved", res.updated_at);
    // 刷新列表（标题/preview 可能变了）
    await refreshNoteList();
    refreshListHighlight();
  } catch (e) {
    setSaveStatus("error");
    showToast("自动保存失败：" + e.message, true);
  }
}

// ── 软删当前笔记 ─────────────────────────────────────────────────────────────
async function deleteCurrentNote() {
  if (!state.currentNoteId) return;
  if (!confirm("移入回收站？")) return;
  try {
    await deleteNote(state.currentNoteId);
    state.currentNoteId = null;
    hideEditorArea();
    await refreshNoteList();
    showToast("已移入回收站");
  } catch (e) {
    showToast("删除失败：" + e.message, true);
  }
}

// ── 搜索 ─────────────────────────────────────────────────────────────────────
let _searchTimer = null;
function scheduleSearch() {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(async () => {
    const q = searchInput.value.trim() || null;
    try {
      const notes = await listNotes(q);
      renderNoteList(notes);
    } catch (e) {
      showToast("搜索失败：" + e.message, true);
    }
  }, 300);
}

// ── 列表刷新 ─────────────────────────────────────────────────────────────────
async function refreshNoteList() {
  const q = searchInput.value.trim() || null;
  const notes = await listNotes(q);
  renderNoteList(notes);
}

function refreshListHighlight() {
  document.querySelectorAll(".note-item").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.id) === state.currentNoteId);
  });
}

// ── 编辑区显隐 ───────────────────────────────────────────────────────────────
function showEditorArea() {
  editorArea.style.display = "flex";
  emptyState.style.display = "none";
}

function hideEditorArea() {
  editorArea.style.display = "none";
  emptyState.style.display = "flex";
  titleInput.value = "";
  contentInput.value = "";
  setSaveStatus("");
}

// ── 回收站视图 ───────────────────────────────────────────────────────────────
async function openTrash() {
  state.view = "trash";
  trashView.style.display = "flex";
  await refreshTrashList();
}

function closeTrash() {
  state.view = "notes";
  trashView.style.display = "none";
}

async function refreshTrashList() {
  try {
    const items = await listTrash();
    trashList.innerHTML = "";
    if (!items.length) {
      trashList.innerHTML = '<p style="padding:20px;color:var(--text-dim);font-size:13px;">回收站为空</p>';
      return;
    }
    items.forEach((item) => {
      const el = document.createElement("div");
      el.className = "trash-item";
      const displayTitle = item.title || item.preview || "无标题";
      const time = new Date(item.deleted_at).toLocaleString("zh-CN", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
      el.innerHTML = `
        <div class="trash-item-info">
          <div class="trash-item-title">${escHtml(displayTitle)}</div>
          <div class="trash-item-time">删除于 ${time}</div>
        </div>
        <button class="btn-restore" data-id="${item.id}">恢复</button>
        <button class="btn-purge"   data-id="${item.id}">永久删除</button>
      `;
      trashList.appendChild(el);
    });
  } catch (e) {
    showToast("加载回收站失败：" + e.message, true);
  }
}

// ── 工具 ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── 事件绑定 ─────────────────────────────────────────────────────────────────
$("btn-new").addEventListener("click", newNote);
$("btn-delete").addEventListener("click", deleteCurrentNote);
$("btn-trash").addEventListener("click", openTrash);
$("btn-back").addEventListener("click", closeTrash);
searchInput.addEventListener("input", scheduleSearch);
titleInput.addEventListener("input", scheduleAutoSave);
contentInput.addEventListener("input", scheduleAutoSave);

// 回收站：恢复 / 永久删除（事件委托）
trashList.addEventListener("click", async (e) => {
  const id = Number(e.target.dataset.id);
  if (!id) return;
  if (e.target.classList.contains("btn-restore")) {
    try {
      await restoreNote(id);
      showToast("已恢复");
      await refreshTrashList();
      await refreshNoteList();
    } catch (err) {
      showToast("恢复失败：" + err.message, true);
    }
  } else if (e.target.classList.contains("btn-purge")) {
    if (!confirm("永久删除？此操作不可撤销。")) return;
    try {
      await purgeNote(id);
      showToast("已永久删除");
      await refreshTrashList();
    } catch (err) {
      showToast("删除失败：" + err.message, true);
    }
  }
});

// 清空回收站
$("btn-empty-trash").addEventListener("click", async () => {
  if (!confirm("清空回收站？所有笔记将永久删除。")) return;
  try {
    await emptyTrash();
    showToast("回收站已清空");
    await refreshTrashList();
  } catch (e) {
    showToast("清空失败：" + e.message, true);
  }
});

// ── 初始化 ───────────────────────────────────────────────────────────────────
async function init() {
  hideEditorArea();
  trashView.style.display = "none";
  try {
    await refreshNoteList();
  } catch (e) {
    showToast("加载失败：" + e.message, true);
  }
  // 打开即写：聚焦内容区
  contentInput.focus();
}

init();
