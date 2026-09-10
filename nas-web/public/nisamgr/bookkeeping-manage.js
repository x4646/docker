try {
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  // bookkeeping-manage.js
  var import_react7 = __toESM(__require("react"));
  var import_react8 = __toESM(__require("react"));
  var import_react9 = __toESM(__require("react"));
  var import_shared7 = __require("../shared.jsx");
  var import_shared10 = __require("../shared.jsx");
  var import_dataService6 = __require("../dataService.js");
  var import_dataService7 = __require("../dataService.js");
  var import_dataService8 = __require("../dataService.js");

  const { ACCOUNT_ICON_PRESET, CATEGORY_ICON_PRESET, DragList, IconPicker, Modal, useContextMenu } = window.__bk;

  function AccountModal({ editing, onClose, onSaved }) {
    const isEdit = !!editing;
    const [name, setName] = (0, import_react7.useState)(editing ? editing.name : "");
    const [icon, setIcon] = (0, import_react7.useState)(editing ? editing.icon : "\u{1F4B0}");
    const [balance, setBalance] = (0, import_react7.useState)(editing ? String(editing.balance) : "0");
    const [error, setError] = (0, import_react7.useState)("");
    const [busy, setBusy] = (0, import_react7.useState)(false);
    const submit = async () => {
      if (!name) return;
      setBusy(true);
      setError("");
      try {
        if (isEdit) await import_dataService6.dataService.updateAccount(editing.id, { name, icon });
        else await import_dataService6.dataService.addAccount({ name, icon, balance: parseInt(balance, 10) || 0 });
        onSaved();
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ import_react7.default.createElement(Modal, { title: isEdit ? "\u7F16\u8F91\u8D26\u6237" : "\u65B0\u589E\u8D26\u6237", onClose }, /* @__PURE__ */ import_react7.default.createElement("div", { className: "field-label" }, "\u56FE\u6807"), /* @__PURE__ */ import_react7.default.createElement(IconPicker, { icon, onChange: setIcon, preset: ACCOUNT_ICON_PRESET }), /* @__PURE__ */ import_react7.default.createElement("div", { className: "field" }, /* @__PURE__ */ import_react7.default.createElement("label", null, "\u540D\u79F0"), /* @__PURE__ */ import_react7.default.createElement("input", { type: "text", value: name, onChange: (e) => setName(e.target.value), placeholder: "\u4F8B\uFF1A\u652F\u4ED8\u5B9D", autoFocus: true })), !isEdit && /* @__PURE__ */ import_react7.default.createElement("div", { className: "field" }, /* @__PURE__ */ import_react7.default.createElement("label", null, "\u521D\u59CB\u4F59\u989D\uFF08\u5186\uFF09"), /* @__PURE__ */ import_react7.default.createElement("input", { type: "number", value: balance, onChange: (e) => setBalance(e.target.value) })), isEdit && /* @__PURE__ */ import_react7.default.createElement("div", { className: "hint", style: { marginTop: 0 } }, '\u4F59\u989D\u662F\u81EA\u52A8\u7B97\u7684\uFF08\u6536\u652F/\u8F6C\u8D26\u7D2F\u52A0\uFF09\uFF0C\u8FD9\u91CC\u4E0D\u80FD\u76F4\u63A5\u6539\uFF1B\u8981\u6539\u4F59\u989D\u5C31\u7528\u5217\u8868\u91CC\u7684"\u21BB\u91CD\u65B0\u6838\u7B97"\uFF0C\u6216\u8005\u53BB\u8BB0\u4E00\u7B14\u8865\u4E00\u6761\u4EA4\u6613\u3002'), error && /* @__PURE__ */ import_react7.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react7.default.createElement("div", { style: { display: "flex", gap: 8, marginTop: 10 } }, /* @__PURE__ */ import_react7.default.createElement("button", { className: "btn sm", disabled: busy || !name, onClick: submit }, busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"), /* @__PURE__ */ import_react7.default.createElement("button", { className: "btn ghost sm", onClick: onClose }, "\u53D6\u6D88")));
  }

  function AccountsTab({ onChange }) {
    const [accs, setAccs] = (0, import_react7.useState)(null);
    const [modal, setModal] = (0, import_react7.useState)(null);
    const [error, setError] = (0, import_react7.useState)("");
    const load = () => import_dataService6.dataService.getAccounts().then(setAccs);
    (0, import_react7.useEffect)(() => {
      load();
    }, []);
    const remove = async (id) => {
      if (!window.confirm("\u5220\u9664\u8FD9\u4E2A\u8D26\u6237\uFF1F")) return;
      try {
        await import_dataService6.dataService.deleteAccount(id);
        load();
        onChange && onChange();
      } catch (e) {
        setError(e.message);
      }
    };
    const recalc = async (id) => {
      try {
        await import_dataService6.dataService.recalculateAccount(id);
        load();
        onChange && onChange();
      } catch (e) {
        setError(e.message);
      }
    };
    const saved = () => {
      setModal(null);
      load();
      onChange && onChange();
    };
    if (!accs) return /* @__PURE__ */ import_react7.default.createElement(import_shared7.Loading, null);
    return /* @__PURE__ */ import_react7.default.createElement("div", null, error && /* @__PURE__ */ import_react7.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react7.default.createElement("table", null, /* @__PURE__ */ import_react7.default.createElement("thead", null, /* @__PURE__ */ import_react7.default.createElement("tr", null, /* @__PURE__ */ import_react7.default.createElement("th", null, "\u56FE\u6807"), /* @__PURE__ */ import_react7.default.createElement("th", null, "\u540D\u79F0"), /* @__PURE__ */ import_react7.default.createElement("th", { style: { textAlign: "right" } }, "\u4F59\u989D"), /* @__PURE__ */ import_react7.default.createElement("th", null))), /* @__PURE__ */ import_react7.default.createElement("tbody", null, accs.map((a) => /* @__PURE__ */ import_react7.default.createElement("tr", { key: a.id }, /* @__PURE__ */ import_react7.default.createElement("td", { "data-label": "\u56FE\u6807", style: { fontSize: 18 } }, a.icon), /* @__PURE__ */ import_react7.default.createElement("td", { "data-label": "\u540D\u79F0" }, a.name), /* @__PURE__ */ import_react7.default.createElement("td", { "data-label": "\u4F59\u989D", className: `num ${a.balance < 0 ? "v-up" : ""}` }, (0, import_shared7.yen)(a.balance)), /* @__PURE__ */ import_react7.default.createElement("td", { "data-label": "" }, /* @__PURE__ */ import_react7.default.createElement("div", { className: "row-actions" }, /* @__PURE__ */ import_react7.default.createElement("button", { className: "icon-btn", onClick: () => setModal({ editing: a }) }, "\u6539"), /* @__PURE__ */ import_react7.default.createElement("button", { className: "icon-btn", onClick: () => recalc(a.id), title: "\u91CD\u65B0\u6838\u7B97\u4F59\u989D" }, "\u21BB"), /* @__PURE__ */ import_react7.default.createElement("button", { className: "icon-btn danger", onClick: () => remove(a.id) }, "\u5220"))))))), /* @__PURE__ */ import_react7.default.createElement("button", { className: "btn ghost sm", style: { marginTop: 10 }, onClick: () => setModal({ editing: null }) }, "\uFF0B \u65B0\u589E\u8D26\u6237"), modal && /* @__PURE__ */ import_react7.default.createElement(AccountModal, { editing: modal.editing, onClose: () => setModal(null), onSaved: saved }));
  }

  function flattenForParentSelect(categories, type, exceptSubtreeOf) {
    const banned = /* @__PURE__ */ new Set();
    if (exceptSubtreeOf) {
      const collect = (id) => {
        banned.add(id);
        categories.filter((c) => c.parent_id === id).forEach((c) => collect(c.id));
      };
      collect(exceptSubtreeOf);
    }
    const out = [];
    const walk = (parentId, depth) => {
      categories.filter((c) => c.type === type && (c.parent_id || null) === parentId && !banned.has(c.id)).forEach((c) => {
        out.push({ id: c.id, name: c.name, depth });
        walk(c.id, depth + 1);
      });
    };
    walk(null, 0);
    return out;
  }

  function CategoryModal({ editing, presetType, presetParentId, categories, onClose, onSaved }) {
    const isEdit = !!editing;
    const [name, setName] = (0, import_react8.useState)(editing ? editing.name : "");
    const [icon, setIcon] = (0, import_react8.useState)(editing ? editing.icon || "\u{1F4C1}" : "\u{1F4C1}");
    const [type, setType] = (0, import_react8.useState)(editing ? editing.type : presetType || "expense");
    const [parentId, setParentId] = (0, import_react8.useState)(editing ? editing.parent_id || "" : presetParentId || "");
    const [error, setError] = (0, import_react8.useState)("");
    const [busy, setBusy] = (0, import_react8.useState)(false);
    const isChild = isEdit ? !!editing.parent_id : !!presetParentId;
    const parentOptions = flattenForParentSelect(categories, type, isEdit ? editing.id : null);
    const submit = async () => {
      if (!name) return;
      setBusy(true);
      setError("");
      try {
        if (isEdit) {
          await import_dataService7.dataService.updateCategory(editing.id, { name, icon, parent_id: isChild ? parentId || null : editing.parent_id });
        } else {
          await import_dataService7.dataService.addCategory({ name, type, parent_id: isChild ? parentId || null : null, icon });
        }
        onSaved();
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ import_react8.default.createElement(Modal, { title: isEdit ? "\u7F16\u8F91\u5206\u7C7B" : presetParentId ? "\u65B0\u589E\u5B50\u5206\u7C7B" : "\u65B0\u589E\u5206\u7C7B", onClose }, !isEdit && !presetParentId && /* @__PURE__ */ import_react8.default.createElement("div", { className: "mode-switch", style: { marginBottom: 10, maxWidth: 260 } }, /* @__PURE__ */ import_react8.default.createElement("button", { className: type === "expense" ? "mode-btn on" : "mode-btn", onClick: () => {
      setType("expense");
      setParentId("");
    } }, "\u652F\u51FA"), /* @__PURE__ */ import_react8.default.createElement("button", { className: type === "income" ? "mode-btn on" : "mode-btn", onClick: () => {
      setType("income");
      setParentId("");
    } }, "\u6536\u5165")), /* @__PURE__ */ import_react8.default.createElement("div", { className: "field-label" }, "\u56FE\u6807"), /* @__PURE__ */ import_react8.default.createElement(IconPicker, { icon, onChange: setIcon, preset: CATEGORY_ICON_PRESET }), /* @__PURE__ */ import_react8.default.createElement("div", { className: "field" }, /* @__PURE__ */ import_react8.default.createElement("label", null, "\u540D\u79F0"), /* @__PURE__ */ import_react8.default.createElement("input", { type: "text", value: name, onChange: (e) => setName(e.target.value), autoFocus: true })), isChild && /* @__PURE__ */ import_react8.default.createElement("div", { className: "field" }, /* @__PURE__ */ import_react8.default.createElement("label", null, "\u6302\u5728\u54EA\u4E2A\u5206\u7C7B\u4E0B\u9762\uFF08\u4E0D\u9650\u5C42\u7EA7\uFF0C\u9009\u54EA\u4E2A\u5C31\u6210\u4E3A\u5B83\u7684\u5B50\u5206\u7C7B\uFF09"), /* @__PURE__ */ import_react8.default.createElement("select", { value: parentId, onChange: (e) => setParentId(e.target.value) }, parentOptions.map((p) => /* @__PURE__ */ import_react8.default.createElement("option", { key: p.id, value: p.id }, "\u3000".repeat(p.depth), p.depth > 0 ? "\u2514 " : "", p.name)))), error && /* @__PURE__ */ import_react8.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react8.default.createElement("div", { style: { display: "flex", gap: 8, marginTop: 10 } }, /* @__PURE__ */ import_react8.default.createElement("button", { className: "btn sm", disabled: busy || !name, onClick: submit }, busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"), /* @__PURE__ */ import_react8.default.createElement("button", { className: "btn ghost sm", onClick: onClose }, "\u53D6\u6D88")));
  }

  function CategoryNode({ cat, categories, depth, onAction, openMenu }) {
    const children = categories.filter((c) => c.parent_id === cat.id);
    const menu = (e) => openMenu(e, [
      { label: "\u2795 \u5728\u4E0B\u9762\u52A0\u5B50\u5206\u7C7B", onClick: () => onAction("add-child", cat) },
      { label: "\u270F\uFE0F \u6539\u540D\u79F0/\u56FE\u6807", onClick: () => onAction("edit", cat) },
      { label: "\u{1F5D1}\uFE0F \u5220\u9664", onClick: () => onAction("delete", cat) }
    ]);
    return /* @__PURE__ */ import_react8.default.createElement("div", { style: { marginBottom: depth === 0 ? 8 : 4 } }, /* @__PURE__ */ import_react8.default.createElement(
      "div",
      {
        className: depth === 0 ? "category-parent-row" : "acct-tag",
        onContextMenu: menu,
        style: depth === 0 ? { display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13, padding: "4px 0" } : { display: "inline-flex", alignItems: "center", gap: 4 }
      },
      cat.icon,
      " ",
      cat.name,
      /* @__PURE__ */ import_react8.default.createElement("button", { className: "icon-btn", style: depth > 0 ? { padding: "1px 6px", fontSize: 12 } : void 0, onClick: () => onAction("add-child", cat), title: "\u52A0\u5B50\u5206\u7C7B" }, "\uFF0B"),
      /* @__PURE__ */ import_react8.default.createElement("button", { className: "icon-btn", style: depth > 0 ? { padding: "1px 6px", fontSize: 12 } : void 0, onClick: () => onAction("edit", cat) }, "\u6539"),
      /* @__PURE__ */ import_react8.default.createElement("button", { className: "icon-btn danger", style: depth > 0 ? { padding: "1px 6px", fontSize: 12 } : void 0, onClick: () => onAction("delete", cat) }, depth === 0 ? "\u5220" : "\xD7")
    ), children.length > 0 && /* @__PURE__ */ import_react8.default.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4, paddingLeft: 20, marginTop: depth === 0 ? 6 : 4 } }, /* @__PURE__ */ import_react8.default.createElement(
      DragList,
      {
        items: children,
        onReorder: onAction.reorderFn,
        renderItem: (c) => /* @__PURE__ */ import_react8.default.createElement(CategoryNode, { cat: c, categories, depth: depth + 1, onAction, openMenu })
      }
    )));
  }

  function CategoryTab({ categories, onChange }) {
    const [modal, setModal] = (0, import_react8.useState)(null);
    const [error, setError] = (0, import_react8.useState)("");
    const { openMenu, menuNode } = useContextMenu();
    const topLevel = (t) => categories.filter((c) => !c.parent_id && c.type === t);
    const persistOrder = async (ids) => {
      try {
        await import_dataService7.dataService.reorderCategories(ids);
        onChange();
      } catch (e) {
        setError(e.message);
      }
    };
    const saved = () => {
      setModal(null);
      onChange();
    };
    const onAction = (action, cat) => {
      if (action === "add-child") setModal({ editing: null, presetType: cat.type, presetParentId: cat.id });
      else if (action === "edit") setModal({ editing: cat });
      else if (action === "delete") {
        if (!window.confirm("\u5220\u9664\u8FD9\u4E2A\u5206\u7C7B\uFF1F\uFF08\u5386\u53F2\u8BB0\u5F55\u4E0D\u53D7\u5F71\u54CD\uFF0C\u5B83\u4E0B\u9762\u7684\u5B50\u5206\u7C7B\u4F1A\u53D8\u6210\u9876\u5C42\u5206\u7C7B\uFF09")) return;
        import_dataService7.dataService.deleteCategory(cat.id).then(onChange).catch((e) => setError(e.message));
      }
    };
    onAction.reorderFn = persistOrder;
    return /* @__PURE__ */ import_react8.default.createElement("div", null, error && /* @__PURE__ */ import_react8.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react8.default.createElement("div", { className: "hint", style: { marginTop: 0, marginBottom: 12 } }, "\u62D6\u7740 \u283F \u624B\u67C4\u8C03\u6574\u987A\u5E8F\uFF1B\u53F3\u952E\u70B9\u5206\u7C7B\u53EF\u4EE5\u76F4\u63A5\u52A0\u5B50\u5206\u7C7B/\u6539\u540D/\u5220\u9664\uFF08\u624B\u673A\u4E0A\u6CA1\u6709\u53F3\u952E\uFF0C\u7528\u65C1\u8FB9\u7684\u6309\u94AE\uFF09\uFF1B\u5B50\u5206\u7C7B\u4E0B\u9762\u8FD8\u80FD\u518D\u52A0\u5B50\u5206\u7C7B\uFF0C\u4E0D\u9650\u5C42\u7EA7\u3002"), ["income", "expense"].map((t) => /* @__PURE__ */ import_react8.default.createElement("div", { key: t, style: { marginBottom: 18 } }, /* @__PURE__ */ import_react8.default.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" } }, /* @__PURE__ */ import_react8.default.createElement("div", { className: "holding-group-label" }, t === "income" ? "\u6536\u5165\u5206\u7C7B" : "\u652F\u51FA\u5206\u7C7B"), /* @__PURE__ */ import_react8.default.createElement("button", { className: "icon-btn", onClick: () => setModal({ editing: null, presetType: t, presetParentId: null }) }, "\uFF0B \u65B0\u589E\u5927\u7C7B")), /* @__PURE__ */ import_react8.default.createElement(
      DragList,
      {
        items: topLevel(t),
        onReorder: persistOrder,
        renderItem: (p) => /* @__PURE__ */ import_react8.default.createElement(CategoryNode, { cat: p, categories, depth: 0, onAction, openMenu })
      }
    ))), modal && /* @__PURE__ */ import_react8.default.createElement(
      CategoryModal,
      {
        editing: modal.editing,
        presetType: modal.presetType,
        presetParentId: modal.presetParentId,
        categories,
        onClose: () => setModal(null),
        onSaved: saved
      }
    ), menuNode);
  }

  function MembersTab() {
    const [members, setMembers] = (0, import_react9.useState)(null);
    const [name, setName] = (0, import_react9.useState)("");
    const [error, setError] = (0, import_react9.useState)("");
    const load = () => import_dataService8.dataService.getMembers().then(setMembers);
    (0, import_react9.useEffect)(() => {
      load();
    }, []);
    const submit = async () => {
      if (!name) return;
      setError("");
      try {
        await import_dataService8.dataService.addMember({ name });
        setName("");
        load();
      } catch (e) {
        setError(e.message);
      }
    };
    const remove = async (id) => {
      try {
        await import_dataService8.dataService.deleteMember(id);
        load();
      } catch (e) {
        setError(e.message);
      }
    };
    if (!members) return /* @__PURE__ */ import_react9.default.createElement(import_shared10.Loading, null);
    return /* @__PURE__ */ import_react9.default.createElement("div", null, /* @__PURE__ */ import_react9.default.createElement("div", { className: "note-banner" }, "\u8BB0\u4E00\u7B14\u7684\u65F6\u5019\u53EF\u4EE5\u9009\u662F\u8C01\u8BB0\u7684\uFF0C\u9002\u5408\u5BB6\u5EAD\u4E00\u8D77\u8BB0\u8D26\u3002"), error && /* @__PURE__ */ import_react9.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react9.default.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 } }, members.map((m) => /* @__PURE__ */ import_react9.default.createElement("span", { key: m.id, className: "acct-tag", style: { display: "flex", alignItems: "center", gap: 4 } }, m.name, /* @__PURE__ */ import_react9.default.createElement("button", { className: "icon-btn", style: { padding: "0 4px", fontSize: 10 }, onClick: () => remove(m.id) }, "\xD7")))), /* @__PURE__ */ import_react9.default.createElement("div", { className: "save-row" }, /* @__PURE__ */ import_react9.default.createElement("input", { type: "text", value: name, onChange: (e) => setName(e.target.value), placeholder: "\u59D3\u540D" }), /* @__PURE__ */ import_react9.default.createElement("button", { className: "btn sm", disabled: !name, onClick: submit }, "\u6DFB\u52A0")));
  }

  window.__bk = window.__bk || {};
  Object.assign(window.__bk, { AccountsTab, CategoryTab, MembersTab });
})();

} catch(e) { console.error('bookkeeping-manage.js 加载出错:', e); }
