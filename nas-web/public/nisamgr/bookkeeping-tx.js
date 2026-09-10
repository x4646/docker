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
  // bookkeeping-tx.js
  var import_react4 = __toESM(__require("react"));
  var import_react5 = __toESM(__require("react"));
  var import_react6 = __toESM(__require("react"));
  var import_shared5 = __require("../shared.jsx");
  var import_dataService3 = __require("../dataService.js");
  var import_dataService4 = __require("../dataService.js");
  var import_dataService5 = __require("../dataService.js");

  const { CategoryPicker, DatePicker, IconGrid, Modal } = window.__bk;

  function ManualTxTab({ categories, accounts, members, onDone, onReordered }) {
    const [type, setType] = (0, import_react4.useState)("expense");
    const [categoryId, setCategoryId] = (0, import_react4.useState)(null);
    const [accountId, setAccountId] = (0, import_react4.useState)(accounts[0] ? accounts[0].id : null);
    const [toAccountId, setToAccountId] = (0, import_react4.useState)(null);
    const [memberId, setMemberId] = (0, import_react4.useState)(null);
    const [amount, setAmount] = (0, import_react4.useState)("");
    const [date, setDate] = (0, import_react4.useState)((/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
    const [showNote, setShowNote] = (0, import_react4.useState)(false);
    const [note, setNote] = (0, import_react4.useState)("");
    const [busy, setBusy] = (0, import_react4.useState)(false);
    const [error, setError] = (0, import_react4.useState)("");
    const [msg, setMsg] = (0, import_react4.useState)("");
    const [sortMode, setSortMode] = (0, import_react4.useState)(false);
    const [quickText, setQuickText] = (0, import_react4.useState)("");
    const reorderCats = async (ids) => {
      try {
        await import_dataService3.dataService.reorderCategories(ids);
        onReordered && onReordered();
      } catch (e) {
        setError(e.message);
      }
    };
    const reorderAccts = async (ids) => {
      try {
        await import_dataService3.dataService.reorderAccounts(ids);
        onReordered && onReordered();
      } catch (e) {
        setError(e.message);
      }
    };
    const parseQuick = () => {
      const t = quickText.trim();
      if (!t) return;
      const amtMatch = t.match(/(\d+(?:\.\d+)?)/);
      const parsedAmount = amtMatch ? Math.round(parseFloat(amtMatch[1])) : null;
      const incomeKeywords = ["\u5DE5\u8D44", "\u6536\u5165", "\u5230\u8D26", "\u5165\u8D26", "\u62A5\u9500", "\u9000\u6B3E", "\u7EA2\u5305", "\u5956\u91D1", "\u5229\u606F"];
      const isIncome = incomeKeywords.some((k) => t.includes(k));
      const guessedType = isIncome ? "income" : "expense";
      const catCandidates = categories.filter((c) => c.type === guessedType && t.includes(c.name)).sort((a, b) => b.name.length - a.name.length);
      const accCandidates = accounts.filter((a) => t.includes(a.name)).sort((a, b) => b.name.length - a.name.length);
      setType(guessedType);
      setCategoryId(catCandidates[0] ? catCandidates[0].id : null);
      if (accCandidates[0]) setAccountId(accCandidates[0].id);
      if (parsedAmount != null) setAmount(String(parsedAmount));
      setNote(t);
      setShowNote(true);
      setQuickText("");
    };
    const submit = async () => {
      if (!amount || !accountId) return;
      if (type === "transfer" && !toAccountId) {
        setError("\u9009\u4E00\u4E0B\u8F6C\u5165\u8D26\u6237");
        return;
      }
      setBusy(true);
      setError("");
      try {
        await import_dataService3.dataService.addTransaction({
          date,
          type,
          category_id: type === "transfer" ? null : categoryId,
          account_id: accountId,
          to_account_id: type === "transfer" ? toAccountId : null,
          member_id: memberId,
          amount: parseInt(amount, 10),
          note
        });
        setMsg("\u5DF2\u4FDD\u5B58");
        setAmount("");
        setNote("");
        setShowNote(false);
        setCategoryId(null);
        onDone && onDone();
        setTimeout(() => setMsg(""), 1800);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ import_react4.default.createElement("div", null, /* @__PURE__ */ import_react4.default.createElement("div", { className: "quick-text-box", style: { marginBottom: 12 } }, /* @__PURE__ */ import_react4.default.createElement("input", { type: "text", value: quickText, onChange: (e) => setQuickText(e.target.value), placeholder: "\u8f93\u5165\u6587\u5b57\uff0c\u5982\uff1a\u5348\u996d30\u5757\u73b0\u91d1", style: { width: "100%" } }), /* @__PURE__ */ import_react4.default.createElement("button", { className: "btn ghost sm", style: { marginTop: 6 }, onClick: parseQuick, disabled: !quickText.trim() }, "\u89e3\u6790\u5e76\u586b\u5165")), /* @__PURE__ */ import_react4.default.createElement("div", { className: "type-pills" }, /* @__PURE__ */ import_react4.default.createElement("button", { className: "type-pill expense" + (type === "expense" ? " on" : ""), onClick: () => {
      setType("expense");
      setCategoryId(null);
    } }, "\u{1F4B8} \u652F\u51FA"), /* @__PURE__ */ import_react4.default.createElement("button", { className: "type-pill income" + (type === "income" ? " on" : ""), onClick: () => {
      setType("income");
      setCategoryId(null);
    } }, "\u{1F4B0} \u6536\u5165"), /* @__PURE__ */ import_react4.default.createElement("button", { className: "type-pill transfer" + (type === "transfer" ? " on" : ""), onClick: () => setType("transfer") }, "\u{1F504} \u8F6C\u8D26")), /* @__PURE__ */ import_react4.default.createElement(
      "input",
      {
        type: "number",
        className: "amount-input", inputMode: "decimal",
        value: amount,
        onChange: (e) => setAmount(e.target.value),
        placeholder: "0",
        autoFocus: true
      }
    ), type !== "transfer" ? /* @__PURE__ */ import_react4.default.createElement(import_react4.default.Fragment, null, /* @__PURE__ */ import_react4.default.createElement("div", { className: "field-label" }, "\u5206\u7C7B"), /* @__PURE__ */ import_react4.default.createElement(CategoryPicker, { categories, type, value: categoryId, onChange: setCategoryId, onReorder: sortMode ? reorderCats : null })) : /* @__PURE__ */ import_react4.default.createElement(import_react4.default.Fragment, null, /* @__PURE__ */ import_react4.default.createElement("div", { className: "field-label" }, "\u8F6C\u5165\u8D26\u6237"), /* @__PURE__ */ import_react4.default.createElement(IconGrid, { items: accounts.filter((a) => a.id !== accountId), value: toAccountId, onChange: setToAccountId })), /* @__PURE__ */ import_react4.default.createElement("div", { className: "field-label sort-row" }, /* @__PURE__ */ import_react4.default.createElement("span", null, type === "transfer" ? "\u8F6C\u51FA\u8D26\u6237" : "\u8D26\u6237"), /* @__PURE__ */ import_react4.default.createElement("button", { type: "button", className: sortMode ? "btn sm sort-toggle" : "btn ghost sm sort-toggle", onClick: () => setSortMode(!sortMode) }, sortMode ? "\u2713 \u5B8C\u6210\u6392\u5E8F" : "\u21C5 \u8C03\u6574\u987A\u5E8F")), /* @__PURE__ */ import_react4.default.createElement(
      IconGrid,
      {
        items: accounts,
        value: accountId,
        onChange: setAccountId,
        onReorder: sortMode ? reorderAccts : null,
        renderExtra: (a) => /* @__PURE__ */ import_react4.default.createElement("span", { className: "icon-grid-sub" }, a.balance != null ? `\xA5${a.balance.toLocaleString("en-US")}` : "")
      }
    ), members.length > 0 && /* @__PURE__ */ import_react4.default.createElement(import_react4.default.Fragment, null, /* @__PURE__ */ import_react4.default.createElement("div", { className: "field-label" }, "\u8C01\u8BB0\u7684\uFF08\u53EF\u4E0D\u9009\uFF09"), /* @__PURE__ */ import_react4.default.createElement("div", { className: "mode-switch", style: { marginBottom: 10 } }, members.map((m) => /* @__PURE__ */ import_react4.default.createElement("button", { key: m.id, className: memberId === m.id ? "mode-btn on" : "mode-btn", onClick: () => setMemberId(memberId === m.id ? null : m.id) }, m.name)))), /* @__PURE__ */ import_react4.default.createElement("div", { className: "save-row", style: { marginTop: 10 } }, /* @__PURE__ */ import_react4.default.createElement(DatePicker, { value: date, onChange: setDate }), !showNote ? /* @__PURE__ */ import_react4.default.createElement("button", { className: "btn ghost sm", onClick: () => setShowNote(true) }, "\uFF0B\u5907\u6CE8") : /* @__PURE__ */ import_react4.default.createElement("input", { type: "text", value: note, onChange: (e) => setNote(e.target.value), placeholder: "\u5907\u6CE8", style: { flex: 1 } })), error && /* @__PURE__ */ import_react4.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react4.default.createElement("button", { className: "btn save-sticky", style: { width: "100%", marginTop: 12 }, disabled: busy || !amount || !accountId, onClick: submit }, busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"), msg && /* @__PURE__ */ import_react4.default.createElement("div", { className: "save-msg", style: { textAlign: "center", marginTop: 6 } }, msg));
  }

  function CsvImportTab({ onDone }) {
    const [text, setText] = (0, import_react5.useState)("");
    const [busy, setBusy] = (0, import_react5.useState)(false);
    const [result, setResult] = (0, import_react5.useState)(null);
    const [error, setError] = (0, import_react5.useState)("");
    const [fileName, setFileName] = (0, import_react5.useState)("");
    const fileInputRef = (0, import_react5.useRef)(null);
    const doImport = async () => {
      if (!text.trim()) return;
      setBusy(true);
      setError("");
      setResult(null);
      try {
        const r = await import_dataService4.dataService.importTransactionsCsv(text);
        setResult(r);
        setText("");
        setFileName("");
        onDone && onDone();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    };
    const handleFile = (file) => {
      if (!file) return;
      setError("");
      const reader = new FileReader();
      reader.onload = () => {
        setText(String(reader.result || ""));
        setFileName(file.name);
      };
      reader.onerror = () => setError("\u6587\u4EF6\u8BFB\u53D6\u5931\u8D25");
      reader.readAsText(file, "utf-8");
    };
    return /* @__PURE__ */ import_react5.default.createElement("div", null, /* @__PURE__ */ import_react5.default.createElement("div", { className: "note-banner" }, '\u8868\u5934\uFF1Adate,type,category,amount,note,account\uFF08category/account/note\u53EF\u7559\u7A7A\uFF0C\u8F6C\u8D26\u8BF7\u7528\u9875\u9762\u624B\u52A8\u5F55\uFF09\u3002 category/account \u6309\u540D\u79F0\u5339\u914D\u5DF2\u6709\u7684\u3002type \u586B income/expense \u6216"\u6536\u5165"/"\u652F\u51FA"\u3002\u53EF\u4EE5\u76F4\u63A5\u7C98\u8D34\uFF0C\u4E5F\u53EF\u4EE5\u9009\u62E9 CSV \u6587\u4EF6\u3002'), /* @__PURE__ */ import_react5.default.createElement(
      "div",
      { className: "save-row", style: { padding: "6px 0" } },
      /* @__PURE__ */ import_react5.default.createElement("button", { className: "btn ghost sm", onClick: () => fileInputRef.current && fileInputRef.current.click() }, "\u{1F4C2} \u9009\u62E9CSV\u6587\u4EF6"),
      fileName && /* @__PURE__ */ import_react5.default.createElement("span", { style: { fontSize: 12, color: "var(--text-3)", marginLeft: 8 } }, fileName),
      /* @__PURE__ */ import_react5.default.createElement("input", {
        ref: fileInputRef,
        type: "file",
        accept: ".csv,text/csv,text/plain",
        style: { display: "none" },
        onChange: (e) => {
          handleFile(e.target.files && e.target.files[0]);
          e.target.value = "";
        }
      })
    ), /* @__PURE__ */ import_react5.default.createElement(
      "textarea",
      {
        className: "paste-textarea",
        rows: 8,
        value: text,
        onChange: (e) => {
          setText(e.target.value);
          setFileName("");
        },
        onDrop: (e) => {
          e.preventDefault();
          const f = e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) handleFile(f);
        },
        onDragOver: (e) => e.preventDefault(),
        placeholder: "date,type,category,amount,note,account\n2026-07-01,income,\u57FA\u672C\u5DE5\u8D44,300000,,\u94F6\u884C\u5361\n2026-07-02,expense,\u9910\u996E,3000,\u5348\u996D,\u73B0\u91D1"
      }
    ), /* @__PURE__ */ import_react5.default.createElement("div", { className: "save-row", style: { padding: "10px 0" } }, /* @__PURE__ */ import_react5.default.createElement("button", { className: "btn", disabled: busy || !text.trim(), onClick: doImport }, busy ? "\u5BFC\u5165\u4E2D\u2026" : "\u5BFC\u5165")), error && /* @__PURE__ */ import_react5.default.createElement("div", { className: "extract-status extract-error" }, error), result && /* @__PURE__ */ import_react5.default.createElement("div", { className: "result-banner good" }, "\u2713 \u6210\u529F\u5BFC\u5165 ", result.added, " \u6761", result.skipped.length > 0 && `\uFF0C\u8DF3\u8FC7 ${result.skipped.length} \u6761`, result.skipped.length > 0 && /* @__PURE__ */ import_react5.default.createElement("div", { style: { marginTop: 6, fontSize: 11 } }, result.skipped.map((s, i) => /* @__PURE__ */ import_react5.default.createElement("div", { key: i }, "\u7B2C", s.line, "\u884C\uFF1A", s.reason)))));
  }

  function TxEditModal({ tx, categories, accounts, members, onClose, onSaved, onReordered }) {
    const [type, setType] = (0, import_react6.useState)(tx.type);
    const [categoryId, setCategoryId] = (0, import_react6.useState)(tx.category_id);
    const [accountId, setAccountId] = (0, import_react6.useState)(tx.account_id);
    const [toAccountId, setToAccountId] = (0, import_react6.useState)(tx.to_account_id);
    const [memberId, setMemberId] = (0, import_react6.useState)(tx.member_id);
    const [amount, setAmount] = (0, import_react6.useState)(String(tx.amount));
    const [date, setDate] = (0, import_react6.useState)(tx.date);
    const [note, setNote] = (0, import_react6.useState)(tx.note || "");
    const [busy, setBusy] = (0, import_react6.useState)(false);
    const [error, setError] = (0, import_react6.useState)("");
    const reorderCats = async (ids) => {
      try {
        await import_dataService5.dataService.reorderCategories(ids);
        onReordered && onReordered();
      } catch (e) {
        setError(e.message);
      }
    };
    const reorderAccts = async (ids) => {
      try {
        await import_dataService5.dataService.reorderAccounts(ids);
        onReordered && onReordered();
      } catch (e) {
        setError(e.message);
      }
    };
    const submit = async () => {
      if (!amount || !accountId) return;
      if (type === "transfer" && !toAccountId) {
        setError("\u9009\u4E00\u4E0B\u8F6C\u5165\u8D26\u6237");
        return;
      }
      setBusy(true);
      setError("");
      try {
        await import_dataService5.dataService.updateTransaction(tx.id, {
          date,
          type,
          category_id: type === "transfer" ? null : categoryId,
          account_id: accountId,
          to_account_id: type === "transfer" ? toAccountId : null,
          member_id: memberId,
          amount: parseInt(amount, 10),
          note
        });
        onSaved();
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ import_react6.default.createElement(Modal, { title: "\u7F16\u8F91\u8FD9\u7B14\u8BB0\u5F55", onClose }, /* @__PURE__ */ import_react6.default.createElement("div", { className: "type-pills" }, /* @__PURE__ */ import_react6.default.createElement("button", { className: "type-pill expense" + (type === "expense" ? " on" : ""), onClick: () => setType("expense") }, "\u{1F4B8} \u652F\u51FA"), /* @__PURE__ */ import_react6.default.createElement("button", { className: "type-pill income" + (type === "income" ? " on" : ""), onClick: () => setType("income") }, "\u{1F4B0} \u6536\u5165"), /* @__PURE__ */ import_react6.default.createElement("button", { className: "type-pill transfer" + (type === "transfer" ? " on" : ""), onClick: () => setType("transfer") }, "\u{1F504} \u8F6C\u8D26")), /* @__PURE__ */ import_react6.default.createElement("input", { type: "number", className: "amount-input", inputMode: "decimal", value: amount, onChange: (e) => setAmount(e.target.value), placeholder: "0" }), type !== "transfer" ? /* @__PURE__ */ import_react6.default.createElement(import_react6.default.Fragment, null, /* @__PURE__ */ import_react6.default.createElement("div", { className: "field-label" }, "\u5206\u7C7B"), /* @__PURE__ */ import_react6.default.createElement(CategoryPicker, { categories, type, value: categoryId, onChange: setCategoryId, onReorder: reorderCats })) : /* @__PURE__ */ import_react6.default.createElement(import_react6.default.Fragment, null, /* @__PURE__ */ import_react6.default.createElement("div", { className: "field-label" }, "\u8F6C\u5165\u8D26\u6237"), /* @__PURE__ */ import_react6.default.createElement(IconGrid, { items: accounts.filter((a) => a.id !== accountId), value: toAccountId, onChange: setToAccountId })), /* @__PURE__ */ import_react6.default.createElement("div", { className: "field-label" }, type === "transfer" ? "\u8F6C\u51FA\u8D26\u6237" : "\u8D26\u6237"), /* @__PURE__ */ import_react6.default.createElement(
      IconGrid,
      {
        items: accounts,
        value: accountId,
        onChange: setAccountId,
        onReorder: reorderAccts,
        renderExtra: (a) => /* @__PURE__ */ import_react6.default.createElement("span", { className: "icon-grid-sub" }, a.balance != null ? `\xA5${a.balance.toLocaleString("en-US")}` : "")
      }
    ), members.length > 0 && /* @__PURE__ */ import_react6.default.createElement(import_react6.default.Fragment, null, /* @__PURE__ */ import_react6.default.createElement("div", { className: "field-label" }, "\u8C01\u8BB0\u7684\uFF08\u53EF\u4E0D\u9009\uFF09"), /* @__PURE__ */ import_react6.default.createElement("div", { className: "mode-switch", style: { marginBottom: 10 } }, members.map((m) => /* @__PURE__ */ import_react6.default.createElement("button", { key: m.id, className: memberId === m.id ? "mode-btn on" : "mode-btn", onClick: () => setMemberId(memberId === m.id ? null : m.id) }, m.name)))), /* @__PURE__ */ import_react6.default.createElement("div", { className: "save-row", style: { marginTop: 10 } }, /* @__PURE__ */ import_react6.default.createElement(DatePicker, { value: date, onChange: setDate }), /* @__PURE__ */ import_react6.default.createElement("input", { type: "text", value: note, onChange: (e) => setNote(e.target.value), placeholder: "\u5907\u6CE8", style: { flex: 1 } })), error && /* @__PURE__ */ import_react6.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react6.default.createElement("button", { className: "btn", style: { width: "100%", marginTop: 12 }, disabled: busy || !amount || !accountId, onClick: submit }, busy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58"));
  }

  function TxListTab({ refreshKey, categories, accounts, members, onReordered }) {
    const [rows, setRows] = (0, import_react6.useState)(null);
    const [filterType, setFilterType] = (0, import_react6.useState)("");
    const [filterAccount, setFilterAccount] = (0, import_react6.useState)("");
    const [startDate, setStartDate] = (0, import_react6.useState)("");
    const [endDate, setEndDate] = (0, import_react6.useState)("");
    const [query, setQuery] = (0, import_react6.useState)("");
    const [error, setError] = (0, import_react6.useState)("");
    const [editingTx, setEditingTx] = (0, import_react6.useState)(null);
    const [visibleCount, setVisibleCount] = (0, import_react6.useState)(50);
    const load = () => {
      const filter = {};
      if (filterType) filter.type = filterType;
      if (startDate) filter.start = startDate;
      if (endDate) filter.end = endDate;
      import_dataService5.dataService.getTransactions(filter).then(setRows).catch((e) => setError(e.message));
    };
    (0, import_react6.useEffect)(() => {
      load();
    }, [refreshKey, filterType, startDate, endDate]);
    (0, import_react6.useEffect)(() => {
      setVisibleCount(50);
    }, [filterType, filterAccount, startDate, endDate, query]);
    const del = async (id) => {
      try {
        await import_dataService5.dataService.deleteTransaction(id);
        load();
      } catch (e) {
        setError(e.message);
      }
    };
    const saved = () => {
      setEditingTx(null);
      load();
    };
    const filtered = (0, import_react6.useMemo)(() => {
      if (!rows) return null;
      let list = rows;
      if (filterAccount) {
        list = list.filter((r) => r.account_id === filterAccount || r.to_account_id === filterAccount);
      }
      const q = query.trim().toLowerCase();
      if (q) {
        list = list.filter(
          (r) => (r.note || "").toLowerCase().includes(q) || (r.category_name || "").toLowerCase().includes(q) || (r.account_name || "").toLowerCase().includes(q) || (r.to_account_name || "").toLowerCase().includes(q)
        );
      }
      return list;
    }, [rows, query, filterAccount]);
    const visible = filtered ? filtered.slice(0, visibleCount) : null;
    const exportCsv = () => {
      if (!filtered || filtered.length === 0) return;
      const typeLabel = { income: "收入", expense: "支出", transfer: "转账" };
      const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const lines = [["日期", "类型", "分类/去向", "账户", "金额", "备注"].map(esc).join(",")];
      filtered.forEach((r) => {
        const target = r.type === "transfer" ? `→ ${r.to_account_name || ""}` : r.category_name || "(未分类)";
        lines.push([r.date, typeLabel[r.type] || r.type, target, r.account_name, r.amount, r.note || ""].map(esc).join(","));
      });
      const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `记账明细_${startDate || "起"}_${endDate || "止"}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
    if (error) return /* @__PURE__ */ import_react6.default.createElement("div", { className: "empty" }, error);
    if (!filtered) return /* @__PURE__ */ import_react6.default.createElement(import_shared5.Loading, null);
    return /* @__PURE__ */ import_react6.default.createElement(
      "div",
      null,
      /* @__PURE__ */ import_react6.default.createElement(
        "div",
        { className: "toolbar", style: { flexWrap: "wrap", gap: 8 } },
        /* @__PURE__ */ import_react6.default.createElement(
          "select",
          { value: filterType, onChange: (e) => setFilterType(e.target.value) },
          /* @__PURE__ */ import_react6.default.createElement("option", { value: "" }, "全部"),
          /* @__PURE__ */ import_react6.default.createElement("option", { value: "income" }, "仅收入"),
          /* @__PURE__ */ import_react6.default.createElement("option", { value: "expense" }, "仅支出"),
          /* @__PURE__ */ import_react6.default.createElement("option", { value: "transfer" }, "仅转账")
        ),
        /* @__PURE__ */ import_react6.default.createElement(
          "select",
          { value: filterAccount, onChange: (e) => setFilterAccount(e.target.value) },
          /* @__PURE__ */ import_react6.default.createElement("option", { value: "" }, "全部账户"),
          accounts.map((a) => /* @__PURE__ */ import_react6.default.createElement("option", { key: a.id, value: a.id }, a.icon, " ", a.name))
        ),
        /* @__PURE__ */ import_react6.default.createElement(DatePicker, { value: startDate, onChange: setStartDate }),
        /* @__PURE__ */ import_react6.default.createElement("span", { style: { color: "var(--text-3)" } }, "至"),
        /* @__PURE__ */ import_react6.default.createElement(DatePicker, { value: endDate, onChange: setEndDate }),
        (startDate || endDate) && /* @__PURE__ */ import_react6.default.createElement("button", { className: "icon-btn", onClick: () => { setStartDate(""); setEndDate(""); } }, "清空日期"),
        /* @__PURE__ */ import_react6.default.createElement("input", { type: "text", value: query, onChange: (e) => setQuery(e.target.value), placeholder: "搜备注/分类/账户…", style: { flex: 1, minWidth: 140 } }),
        /* @__PURE__ */ import_react6.default.createElement("button", { className: "btn ghost sm", disabled: filtered.length === 0, onClick: exportCsv }, "⬇ 导出CSV")
      ),
      filtered.length === 0 && /* @__PURE__ */ import_react6.default.createElement("div", { className: "empty" }, query || filterAccount || startDate || endDate ? "没搜到匹配的记录" : "还没有记账记录"),
      filtered.length > 0 && /* @__PURE__ */ import_react6.default.createElement(
        "table",
        null,
        /* @__PURE__ */ import_react6.default.createElement(
          "thead",
          null,
          /* @__PURE__ */ import_react6.default.createElement(
            "tr",
            null,
            /* @__PURE__ */ import_react6.default.createElement("th", null, "日期"),
            /* @__PURE__ */ import_react6.default.createElement("th", null, "类型"),
            /* @__PURE__ */ import_react6.default.createElement("th", null, "分类/去向"),
            /* @__PURE__ */ import_react6.default.createElement("th", null, "账户"),
            /* @__PURE__ */ import_react6.default.createElement("th", { style: { textAlign: "right" } }, "金额"),
            /* @__PURE__ */ import_react6.default.createElement("th", null)
          )
        ),
        /* @__PURE__ */ import_react6.default.createElement(
          "tbody",
          null,
          visible.map((r) => /* @__PURE__ */ import_react6.default.createElement(
            "tr",
            { key: r.id },
            /* @__PURE__ */ import_react6.default.createElement("td", { "data-label": "日期", style: { fontFamily: "ui-monospace,monospace", fontSize: 12 } }, r.date),
            /* @__PURE__ */ import_react6.default.createElement("td", { "data-label": "类型", className: r.type === "income" ? "v-down" : r.type === "expense" ? "v-up" : "" }, r.type === "income" ? "收入" : r.type === "expense" ? "支出" : "转账"),
            /* @__PURE__ */ import_react6.default.createElement("td", { "data-label": "分类/去向" }, r.type === "transfer" ? `→ ${r.to_account_icon || ""}${r.to_account_name || ""}` : `${r.category_icon || ""} ${r.category_name || "(未分类)"}`),
            /* @__PURE__ */ import_react6.default.createElement("td", { "data-label": "账户", style: { fontSize: 12, color: "var(--text-3)" } }, r.account_icon, " ", r.account_name),
            /* @__PURE__ */ import_react6.default.createElement("td", { "data-label": "金额", className: "num" }, (0, import_shared5.yen)(r.amount)),
            /* @__PURE__ */ import_react6.default.createElement(
              "td",
              { "data-label": "" },
              /* @__PURE__ */ import_react6.default.createElement(
                "div",
                { className: "row-actions" },
                /* @__PURE__ */ import_react6.default.createElement("button", { className: "icon-btn", onClick: () => setEditingTx(r) }, "改"),
                /* @__PURE__ */ import_react6.default.createElement("button", { className: "icon-btn danger", onClick: () => del(r.id) }, "删")
              )
            )
          ))
        )
      ),
      filtered.length > visibleCount && /* @__PURE__ */ import_react6.default.createElement(
        "div",
        { style: { textAlign: "center", marginTop: 12 } },
        /* @__PURE__ */ import_react6.default.createElement("button", { className: "btn ghost sm", onClick: () => setVisibleCount((c) => c + 50) }, `加载更多（还有 ${filtered.length - visibleCount} 条）`)
      ),
      editingTx && /* @__PURE__ */ import_react6.default.createElement(TxEditModal, {
        tx: editingTx,
        categories,
        accounts,
        members,
        onClose: () => setEditingTx(null),
        onSaved: saved,
        onReordered
      })
    );
  }

  window.__bk = window.__bk || {};
  Object.assign(window.__bk, { CsvImportTab, ManualTxTab, TxListTab });
})();

} catch(e) { console.error('bookkeeping-tx.js 加载出错:', e); }
