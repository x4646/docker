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
  // bookkeeping-planning.js
  var import_react11 = __toESM(__require("react"));
  var import_react12 = __toESM(__require("react"));
  var import_react16 = __toESM(__require("react"));
  var import_shared11 = __require("../shared.jsx");
  var import_shared13 = __require("../shared.jsx");
  var import_shared19 = __require("../shared.jsx");
  var import_dataService9 = __require("../dataService.js");
  var import_dataService10 = __require("../dataService.js");
  var import_dataService14 = __require("../dataService.js");

  const { CategoryPicker, IconGrid, Modal, MonthSlider } = window.__bk;

  function BudgetTab({ categories, onReordered }) {
    const [month, setMonth] = (0, import_react11.useState)((/* @__PURE__ */ new Date()).toISOString().slice(0, 7));
    const [status, setStatus] = (0, import_react11.useState)(null);
    const [categoryId, setCategoryId] = (0, import_react11.useState)(null);
    const [limitAmount, setLimitAmount] = (0, import_react11.useState)("");
    const [error, setError] = (0, import_react11.useState)("");
    const reorderCats = async (ids) => {
      try {
        await import_dataService9.dataService.reorderCategories(ids);
        onReordered && onReordered();
      } catch (e) {
        setError(e.message);
      }
    };
    const load = () => import_dataService9.dataService.getBudgetStatus(month).then(setStatus);
    (0, import_react11.useEffect)(() => {
      load();
    }, [month]);
    const expenseCats = categories.filter((c) => c.parent_id && c.type === "expense");
    const submit = async () => {
      if (!categoryId || !limitAmount) return;
      setError("");
      try {
        await import_dataService9.dataService.setBudget({ category_id: categoryId, month, limit_amount: parseInt(limitAmount, 10) });
        setLimitAmount("");
        load();
      } catch (e) {
        setError(e.message);
      }
    };
    return /* @__PURE__ */ import_react11.default.createElement("div", null, /* @__PURE__ */ import_react11.default.createElement("div", { className: "field-label" }, "\u6708\u4EFD"), /* @__PURE__ */ import_react11.default.createElement(MonthSlider, { value: month, onChange: setMonth }), status && status.items.length > 0 && /* @__PURE__ */ import_react11.default.createElement("table", { style: { marginBottom: 16 } }, /* @__PURE__ */ import_react11.default.createElement("thead", null, /* @__PURE__ */ import_react11.default.createElement("tr", null, /* @__PURE__ */ import_react11.default.createElement("th", null, "\u5206\u7C7B"), /* @__PURE__ */ import_react11.default.createElement("th", { style: { textAlign: "right" } }, "\u9884\u7B97"), /* @__PURE__ */ import_react11.default.createElement("th", { style: { textAlign: "right" } }, "\u5DF2\u82B1"), /* @__PURE__ */ import_react11.default.createElement("th", { style: { textAlign: "right" } }, "\u5269\u4F59"))), /* @__PURE__ */ import_react11.default.createElement("tbody", null, status.items.map((it) => /* @__PURE__ */ import_react11.default.createElement("tr", { key: it.category_id }, /* @__PURE__ */ import_react11.default.createElement("td", { "data-label": "\u5206\u7C7B" }, it.category_icon, " ", it.category_name), /* @__PURE__ */ import_react11.default.createElement("td", { "data-label": "\u9884\u7B97", className: "num" }, (0, import_shared11.yen)(it.limit)), /* @__PURE__ */ import_react11.default.createElement("td", { "data-label": "\u5DF2\u82B1", className: `num ${it.over ? "v-up" : ""}` }, (0, import_shared11.yen)(it.spent), it.over && " \u26A0\u8D85\u652F"), /* @__PURE__ */ import_react11.default.createElement("td", { "data-label": "\u5269\u4F59", className: "num" }, (0, import_shared11.yen)(it.remaining)))))), /* @__PURE__ */ import_react11.default.createElement("div", { className: "holding-group-label" }, "\u8BBE\u7F6E/\u66F4\u65B0\u9884\u7B97"), /* @__PURE__ */ import_react11.default.createElement(IconGrid, { items: expenseCats, value: categoryId, onChange: setCategoryId, onReorder: reorderCats }), /* @__PURE__ */ import_react11.default.createElement("div", { className: "field", style: { marginTop: 10 } }, /* @__PURE__ */ import_react11.default.createElement("label", null, "\u6708\u5EA6\u4E0A\u9650\uFF08\u5186\uFF09"), /* @__PURE__ */ import_react11.default.createElement("input", { type: "number", value: limitAmount, onChange: (e) => setLimitAmount(e.target.value) })), error && /* @__PURE__ */ import_react11.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react11.default.createElement("button", { className: "btn sm", disabled: !categoryId || !limitAmount, onClick: submit }, "\u4FDD\u5B58\u9884\u7B97"));
  }

  function RecurringModal({ editing, categories, accounts, onClose, onSaved, onReordered }) {
    const [name, setName] = (0, import_react12.useState)(editing ? editing.name : "");
    const [nameTouched, setNameTouched] = (0, import_react12.useState)(!!editing);
    const [type, setType] = (0, import_react12.useState)(editing ? editing.type : "expense");
    const [categoryId, setCategoryId] = (0, import_react12.useState)(editing ? editing.category_id : null);
    const [accountId, setAccountId] = (0, import_react12.useState)(editing ? editing.account_id : accounts[0] ? accounts[0].id : null);
    const [amount, setAmount] = (0, import_react12.useState)(editing ? String(editing.amount) : "");
    const [day, setDay] = (0, import_react12.useState)(editing ? String(editing.day_of_month) : "1");
    const [error, setError] = (0, import_react12.useState)("");
    const [busy, setBusy] = (0, import_react12.useState)(false);
    const reorderCats = async (ids) => {
      try {
        await import_dataService10.dataService.reorderCategories(ids);
        onReordered && onReordered();
      } catch (e) {
        setError(e.message);
      }
    };
    const reorderAccts = async (ids) => {
      try {
        await import_dataService10.dataService.reorderAccounts(ids);
        onReordered && onReordered();
      } catch (e) {
        setError(e.message);
      }
    };
    const pickCategory = (id) => {
      setCategoryId(id);
      if (!nameTouched) {
        const cat = categories.find((c) => c.id === id);
        if (cat) setName(cat.name);
      }
    };
    const submit = async () => {
      if (!name || !amount || !day) return;
      setBusy(true);
      setError("");
      try {
        const payload = { name, type, category_id: categoryId, account_id: accountId, amount: parseInt(amount, 10), day_of_month: parseInt(day, 10) };
        if (editing) await import_dataService10.dataService.updateRecurring(editing.id, payload);
        else await import_dataService10.dataService.addRecurring(payload);
        onSaved();
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ import_react12.default.createElement(Modal, { title: editing ? "\u7F16\u8F91\u5468\u671F\u6027\u4EA4\u6613" : "\u65B0\u589E\u5468\u671F\u6027\u4EA4\u6613", onClose }, /* @__PURE__ */ import_react12.default.createElement("div", { className: "mode-switch", style: { marginBottom: 10, maxWidth: 260 } }, /* @__PURE__ */ import_react12.default.createElement("button", { className: type === "expense" ? "mode-btn on" : "mode-btn", onClick: () => {
      setType("expense");
      setCategoryId(null);
    } }, "\u652F\u51FA"), /* @__PURE__ */ import_react12.default.createElement("button", { className: type === "income" ? "mode-btn on" : "mode-btn", onClick: () => {
      setType("income");
      setCategoryId(null);
    } }, "\u6536\u5165")), /* @__PURE__ */ import_react12.default.createElement("div", { className: "field-label" }, "\u5206\u7C7B\uFF08\u70B9\u4E00\u4E0B\u4F1A\u987A\u624B\u628A\u540D\u79F0\u4E5F\u586B\u4E0A\uFF0C\u81EA\u5DF1\u6539\u8FC7\u540D\u79F0\u5C31\u4E0D\u4F1A\u518D\u88AB\u8986\u76D6\uFF09"), /* @__PURE__ */ import_react12.default.createElement(CategoryPicker, { categories, type, value: categoryId, onChange: pickCategory, onReorder: reorderCats }), /* @__PURE__ */ import_react12.default.createElement("div", { className: "field" }, /* @__PURE__ */ import_react12.default.createElement("label", null, "\u540D\u79F0"), /* @__PURE__ */ import_react12.default.createElement("input", { type: "text", value: name, onChange: (e) => {
      setName(e.target.value);
      setNameTouched(true);
    }, placeholder: "\u4F8B\uFF1A\u623F\u79DF" })), /* @__PURE__ */ import_react12.default.createElement("div", { className: "field-label", style: { marginTop: 10 } }, "\u8D26\u6237"), /* @__PURE__ */ import_react12.default.createElement(IconGrid, { items: accounts, value: accountId, onChange: setAccountId, onReorder: reorderAccts }), /* @__PURE__ */ import_react12.default.createElement("div", { className: "field", style: { marginTop: 10 } }, /* @__PURE__ */ import_react12.default.createElement("label", null, "\u91D1\u989D\uFF08\u5186\uFF09"), /* @__PURE__ */ import_react12.default.createElement("input", { type: "number", value: amount, onChange: (e) => setAmount(e.target.value) })), /* @__PURE__ */ import_react12.default.createElement("div", { className: "field" }, /* @__PURE__ */ import_react12.default.createElement("label", null, "\u6BCF\u6708\u7B2C\u51E0\u5929\uFF081~28\uFF09"), /* @__PURE__ */ import_react12.default.createElement("input", { type: "number", min: "1", max: "28", value: day, onChange: (e) => setDay(e.target.value) })), error && /* @__PURE__ */ import_react12.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react12.default.createElement("div", { style: { display: "flex", gap: 8, marginTop: 10 } }, /* @__PURE__ */ import_react12.default.createElement("button", { className: "btn sm", disabled: busy || !name || !amount, onClick: submit }, busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"), /* @__PURE__ */ import_react12.default.createElement("button", { className: "btn ghost sm", onClick: onClose }, "\u53D6\u6D88")));
  }

  function RecurringTab({ categories, accounts, onDone, onReordered }) {
    const [items, setItems] = (0, import_react12.useState)(null);
    const [modalOpen, setModalOpen] = (0, import_react12.useState)(false);
    const [editingItem, setEditingItem] = (0, import_react12.useState)(null);
    const [error, setError] = (0, import_react12.useState)("");
    const [genMsg, setGenMsg] = (0, import_react12.useState)("");
    const load = () => import_dataService10.dataService.getRecurring().then(setItems);
    (0, import_react12.useEffect)(() => {
      load();
    }, []);
    const openAdd = () => {
      setEditingItem(null);
      setModalOpen(true);
    };
    const openEdit = (item) => {
      setEditingItem(item);
      setModalOpen(true);
    };
    const closeModal = () => setModalOpen(false);
    const saved = () => {
      setModalOpen(false);
      load();
    };
    const remove = async (id) => {
      if (!window.confirm("\u5220\u9664\u8FD9\u4E2A\u5468\u671F\u6027\u4EA4\u6613\uFF1F")) return;
      try {
        await import_dataService10.dataService.deleteRecurring(id);
        load();
      } catch (e) {
        setError(e.message);
      }
    };
    const generate = async () => {
      try {
        const r = await import_dataService10.dataService.generateRecurring();
        setGenMsg(`\u5DF2\u751F\u6210 ${r.generated.length} \u6761`);
        onDone && onDone();
        setTimeout(() => setGenMsg(""), 3e3);
      } catch (e) {
        setError(e.message);
      }
    };
    if (!items) return /* @__PURE__ */ import_react12.default.createElement(import_shared13.Loading, null);
    return /* @__PURE__ */ import_react12.default.createElement("div", null, /* @__PURE__ */ import_react12.default.createElement("div", { className: "note-banner" }, '\u623F\u79DF\u3001\u8BA2\u9605\u8FD9\u79CD\u6BCF\u6708\u56FA\u5B9A\u7684\uFF0C\u8BBE\u6210\u6A21\u677F\uFF1B\u70B9"\u751F\u6210\u672C\u6708\u8BB0\u5F55"\u4E00\u952E\u8865\u8FDB\u6D41\u6C34\uFF08\u4F1A\u6B63\u786E\u6263\u51CF/\u589E\u52A0\u8D26\u6237\u4F59\u989D\uFF09\uFF0C\u540C\u4E00\u4E2A\u6A21\u677F\u540C\u4E00\u4E2A\u6708\u4E0D\u4F1A\u91CD\u590D\u751F\u6210\u3002'), error && /* @__PURE__ */ import_react12.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react12.default.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 12 } }, /* @__PURE__ */ import_react12.default.createElement("button", { className: "btn sm", onClick: generate }, "\u751F\u6210\u672C\u6708\u8BB0\u5F55"), /* @__PURE__ */ import_react12.default.createElement("button", { className: "btn ghost sm", onClick: openAdd }, "\uFF0B \u65B0\u589E\u5468\u671F\u6027\u4EA4\u6613"), genMsg && /* @__PURE__ */ import_react12.default.createElement("span", { className: "save-msg" }, genMsg)), /* @__PURE__ */ import_react12.default.createElement("table", null, /* @__PURE__ */ import_react12.default.createElement("thead", null, /* @__PURE__ */ import_react12.default.createElement("tr", null, /* @__PURE__ */ import_react12.default.createElement("th", null, "\u540D\u79F0"), /* @__PURE__ */ import_react12.default.createElement("th", null, "\u7C7B\u578B"), /* @__PURE__ */ import_react12.default.createElement("th", null, "\u6BCF\u6708"), /* @__PURE__ */ import_react12.default.createElement("th", { style: { textAlign: "right" } }, "\u91D1\u989D"), /* @__PURE__ */ import_react12.default.createElement("th", null))), /* @__PURE__ */ import_react12.default.createElement("tbody", null, items.map((r) => /* @__PURE__ */ import_react12.default.createElement("tr", { key: r.id }, /* @__PURE__ */ import_react12.default.createElement("td", { "data-label": "\u540D\u79F0" }, r.name), /* @__PURE__ */ import_react12.default.createElement("td", { "data-label": "\u7C7B\u578B", className: r.type === "income" ? "v-down" : "v-up" }, r.type === "income" ? "\u6536\u5165" : "\u652F\u51FA"), /* @__PURE__ */ import_react12.default.createElement("td", { "data-label": "\u6BCF\u6708" }, r.day_of_month, "\u53F7"), /* @__PURE__ */ import_react12.default.createElement("td", { "data-label": "\u91D1\u989D", className: "num" }, (0, import_shared13.yen)(r.amount)), /* @__PURE__ */ import_react12.default.createElement("td", { "data-label": "" }, /* @__PURE__ */ import_react12.default.createElement("div", { className: "row-actions" }, /* @__PURE__ */ import_react12.default.createElement("button", { className: "icon-btn", onClick: () => openEdit(r) }, "\u6539"), /* @__PURE__ */ import_react12.default.createElement("button", { className: "icon-btn danger", onClick: () => remove(r.id) }, "\u5220"))))))), items.length === 0 && /* @__PURE__ */ import_react12.default.createElement("div", { className: "empty" }, "\u8FD8\u6CA1\u6709\u5468\u671F\u6027\u4EA4\u6613"), modalOpen && /* @__PURE__ */ import_react12.default.createElement(RecurringModal, { editing: editingItem, categories, accounts, onClose: closeModal, onSaved: saved, onReordered }));
  }

  function TemplateModal({ categories, accounts, onClose, onSaved, onReordered }) {
    const [name, setName] = (0, import_react16.useState)("");
    const [nameTouched, setNameTouched] = (0, import_react16.useState)(false);
    const [type, setType] = (0, import_react16.useState)("expense");
    const [categoryId, setCategoryId] = (0, import_react16.useState)(null);
    const [accountId, setAccountId] = (0, import_react16.useState)(accounts[0] ? accounts[0].id : null);
    const [amount, setAmount] = (0, import_react16.useState)("");
    const [error, setError] = (0, import_react16.useState)("");
    const [busy, setBusy] = (0, import_react16.useState)(false);
    const reorderCats = async (ids) => {
      try {
        await import_dataService14.dataService.reorderCategories(ids);
        onReordered && onReordered();
      } catch (e) {
        setError(e.message);
      }
    };
    const reorderAccts = async (ids) => {
      try {
        await import_dataService14.dataService.reorderAccounts(ids);
        onReordered && onReordered();
      } catch (e) {
        setError(e.message);
      }
    };
    const pickCategory = (id) => {
      setCategoryId(id);
      if (!nameTouched) {
        const cat = categories.find((c) => c.id === id);
        if (cat) setName(cat.name);
      }
    };
    const submit = async () => {
      if (!name) return;
      setBusy(true);
      setError("");
      try {
        await import_dataService14.dataService.addQuickTemplate({ name, type, category_id: categoryId, account_id: accountId, amount: amount ? parseInt(amount, 10) : 0 });
        onSaved();
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ import_react16.default.createElement(Modal, { title: "\u65B0\u589E\u5E38\u7528\u6A21\u677F", onClose }, /* @__PURE__ */ import_react16.default.createElement("div", { className: "mode-switch", style: { marginBottom: 10, maxWidth: 260 } }, /* @__PURE__ */ import_react16.default.createElement("button", { className: type === "expense" ? "mode-btn on" : "mode-btn", onClick: () => {
      setType("expense");
      setCategoryId(null);
    } }, "\u652F\u51FA"), /* @__PURE__ */ import_react16.default.createElement("button", { className: type === "income" ? "mode-btn on" : "mode-btn", onClick: () => {
      setType("income");
      setCategoryId(null);
    } }, "\u6536\u5165")), /* @__PURE__ */ import_react16.default.createElement("div", { className: "field-label" }, "\u5206\u7C7B\uFF08\u70B9\u4E00\u4E0B\u4F1A\u987A\u624B\u628A\u540D\u79F0\u4E5F\u586B\u4E0A\uFF09"), /* @__PURE__ */ import_react16.default.createElement(CategoryPicker, { categories, type, value: categoryId, onChange: pickCategory, onReorder: reorderCats }), /* @__PURE__ */ import_react16.default.createElement("div", { className: "field" }, /* @__PURE__ */ import_react16.default.createElement("label", null, "\u6A21\u677F\u540D\u79F0"), /* @__PURE__ */ import_react16.default.createElement("input", { type: "text", value: name, onChange: (e) => {
      setName(e.target.value);
      setNameTouched(true);
    }, placeholder: "\u4F8B\uFF1A\u5496\u5561" })), /* @__PURE__ */ import_react16.default.createElement("div", { className: "field-label", style: { marginTop: 10 } }, "\u8D26\u6237"), /* @__PURE__ */ import_react16.default.createElement(IconGrid, { items: accounts, value: accountId, onChange: setAccountId, onReorder: reorderAccts }), /* @__PURE__ */ import_react16.default.createElement("div", { className: "field", style: { marginTop: 10 } }, /* @__PURE__ */ import_react16.default.createElement("label", null, "\u56FA\u5B9A\u91D1\u989D\uFF08\u5186\uFF0C\u7559\u7A7A\u8868\u793A\u6BCF\u6B21\u624B\u52A8\u8F93\u5165\uFF09"), /* @__PURE__ */ import_react16.default.createElement("input", { type: "number", value: amount, onChange: (e) => setAmount(e.target.value), placeholder: "\u4E0D\u56FA\u5B9A\uFF0C\u70B9\u65F6\u518D\u586B" })), error && /* @__PURE__ */ import_react16.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react16.default.createElement("div", { style: { display: "flex", gap: 8, marginTop: 10 } }, /* @__PURE__ */ import_react16.default.createElement("button", { className: "btn sm", disabled: busy || !name, onClick: submit }, busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"), /* @__PURE__ */ import_react16.default.createElement("button", { className: "btn ghost sm", onClick: onClose }, "\u53D6\u6D88")));
  }

  function TemplatesTab({ categories, accounts, onDone, onReordered }) {
    const [items, setItems] = (0, import_react16.useState)(null);
    const [modalOpen, setModalOpen] = (0, import_react16.useState)(false);
    const [error, setError] = (0, import_react16.useState)("");
    const [msg, setMsg] = (0, import_react16.useState)("");
    const [amountPrompt, setAmountPrompt] = (0, import_react16.useState)(null);
    const [promptAmount, setPromptAmount] = (0, import_react16.useState)("");
    const [promptBusy, setPromptBusy] = (0, import_react16.useState)(false);
    const load = () => import_dataService14.dataService.getQuickTemplates().then(setItems);
    (0, import_react16.useEffect)(() => {
      load();
    }, []);
    const remove = async (id) => {
      try {
        await import_dataService14.dataService.deleteQuickTemplate(id);
        load();
      } catch (e) {
        setError(e.message);
      }
    };
    const use = async (t) => {
      if (!t.amount) {
        setPromptAmount("");
        setAmountPrompt(t);
        return;
      }
      try {
        await import_dataService14.dataService.useQuickTemplate(t.id);
        setMsg(`\u5DF2\u8BB0\u4E00\u7B14\uFF1A${t.name}`);
        load();
        onDone && onDone();
        setTimeout(() => setMsg(""), 1800);
      } catch (e) {
        setError(e.message);
      }
    };
    const confirmPromptAmount = async () => {
      if (!amountPrompt || !promptAmount) return;
      setPromptBusy(true);
      try {
        await import_dataService14.dataService.addTransaction({
          date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
          type: amountPrompt.type,
          category_id: amountPrompt.category_id,
          account_id: amountPrompt.account_id,
          to_account_id: null,
          member_id: null,
          amount: parseInt(promptAmount, 10),
          note: amountPrompt.name
        });
        setMsg(`\u5DF2\u8BB0\u4E00\u7B14\uFF1A${amountPrompt.name}`);
        setAmountPrompt(null);
        setPromptAmount("");
        onDone && onDone();
        setTimeout(() => setMsg(""), 1800);
      } catch (e) {
        setError(e.message);
      } finally {
        setPromptBusy(false);
      }
    };
    const saved = () => {
      setModalOpen(false);
      load();
    };
    if (!items) return /* @__PURE__ */ import_react16.default.createElement(import_shared19.Loading, null);
    return /* @__PURE__ */ import_react16.default.createElement(
      "div",
      null,
      /* @__PURE__ */ import_react16.default.createElement("div", { className: "note-banner" }, '\u70B9\u4E00\u4E0B\u6A21\u677F\u5361\u7247 = \u7ACB\u523B\u6309\u6A21\u677F\u5185\u5BB9\u8BB0\u4E00\u7B14\uFF08\u65E5\u671F\u7528\u4ECA\u5929\uFF09\u3002\u9002\u5408"\u6BCF\u5929\u7684\u5496\u5561"\u8FD9\u79CD\u9AD8\u9891\u5C0F\u989D\u3001\u4F46\u4E0D\u662F\u6309\u6708\u56FA\u5B9A\u5468\u671F\u53D1\u751F\u7684\u5F00\u9500\u3002\u91D1\u989D\u7559\u7A7A\u7684\u6A21\u677F\uFF0C\u70B9\u51FB\u4F1A\u5148\u95EE\u4F60\u8FD9\u6B21\u82B1\u4E86\u591A\u5C11\u3002'),
      error && /* @__PURE__ */ import_react16.default.createElement("div", { className: "extract-status extract-error" }, error),
      msg && /* @__PURE__ */ import_react16.default.createElement("div", { className: "result-banner good" }, "\u2713 ", msg),
      /* @__PURE__ */ import_react16.default.createElement(
        "div",
        { className: "icon-grid", style: { marginTop: 10 } },
        items.map((t) => /* @__PURE__ */ import_react16.default.createElement(
          "div",
          { key: t.id, className: "template-card", onClick: () => use(t) },
          /* @__PURE__ */ import_react16.default.createElement("button", { className: "template-del", onClick: (e) => {
            e.stopPropagation();
            remove(t.id);
          } }, "\xD7"),
          /* @__PURE__ */ import_react16.default.createElement("div", { className: "icon-grid-emoji" }, t.type === "income" ? "\u{1F4B0}" : "\u{1F4B8}"),
          /* @__PURE__ */ import_react16.default.createElement("div", { className: "icon-grid-label" }, t.name),
          /* @__PURE__ */ import_react16.default.createElement("div", { className: "icon-grid-sub" }, t.amount ? `\xA5${t.amount.toLocaleString("en-US")}` : "\u70B9\u51FB\u8F93\u5165\u91D1\u989D"),
          t.use_count > 0 && /* @__PURE__ */ import_react16.default.createElement("div", { className: "template-count" }, "\u7528\u8FC7", t.use_count, "\u6B21")
        ))
      ),
      /* @__PURE__ */ import_react16.default.createElement("button", { className: "btn ghost sm", style: { marginTop: 10 }, onClick: () => setModalOpen(true) }, "\uFF0B \u65B0\u589E\u5E38\u7528\u6A21\u677F"),
      modalOpen && /* @__PURE__ */ import_react16.default.createElement(TemplateModal, { categories, accounts, onClose: () => setModalOpen(false), onSaved: saved, onReordered }),
      amountPrompt && /* @__PURE__ */ import_react16.default.createElement(
        Modal,
        { title: `\u8BB0\u4E00\u7B14\uFF1A${amountPrompt.name}`, onClose: () => setAmountPrompt(null), width: 280 },
        /* @__PURE__ */ import_react16.default.createElement("input", {
          type: "number",
          className: "amount-input", inputMode: "decimal",
          autoFocus: true,
          value: promptAmount,
          onChange: (e) => setPromptAmount(e.target.value),
          placeholder: "0",
          onKeyDown: (e) => { if (e.key === "Enter") confirmPromptAmount(); }
        }),
        /* @__PURE__ */ import_react16.default.createElement("button", { className: "btn", style: { width: "100%" }, disabled: promptBusy || !promptAmount, onClick: confirmPromptAmount }, promptBusy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58")
      )
    );
  }

  window.__bk = window.__bk || {};
  Object.assign(window.__bk, { BudgetTab, RecurringTab, TemplatesTab });
})();

} catch(e) { console.error('bookkeeping-planning.js 加载出错:', e); }
