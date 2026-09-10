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

  // pages/ImportPage.jsx
  var import_react = __toESM(__require("react"));
  var import_dataService = __require("../dataService.js");
  var import_shared = __require("../shared.jsx");
  function TextPasteTab({ onDone }) {
    const [text, setText] = (0, import_react.useState)("");
    const [busy, setBusy] = (0, import_react.useState)(false);
    const [preview, setPreview] = (0, import_react.useState)(null);
    const [error, setError] = (0, import_react.useState)("");
    const doPreview = async () => {
      if (!text.trim()) return;
      setBusy(true);
      setError("");
      setPreview(null);
      try {
        const r = await import_dataService.dataService.parseText(text);
        setPreview(r);
      } catch (err) {
        setError(err.message || "\u89E3\u6790\u5931\u8D25");
      } finally {
        setBusy(false);
      }
    };
    const doCommit = async () => {
      setBusy(true);
      setError("");
      try {
        const r = await import_dataService.dataService.pasteToPending(text);
        setPreview(null);
        setText("");
        onDone && onDone();
        setError("");
        alert(`\u5DF2\u8FDB\u5F85\u786E\u8BA4\u961F\u5217\uFF1A\u5171 ${r.added} \u6761`);
      } catch (err) {
        setError(err.message || "\u63D0\u4EA4\u5931\u8D25");
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "note-banner" }, "\u5728\u4E50\u5929\u8BC1\u5238\u7F51\u9875\u7248\u300C\u4FDD\u6709\u5546\u54C1\u8A73\u7D30\uFF08\u3059\u3079\u3066\uFF09\u300D\u9875\u9762\uFF0C\u5168\u9009\u8868\u683C\u5185\u5BB9\u590D\u5236\uFF0C\u7C98\u8D34\u5230\u4E0B\u9762\u6587\u672C\u6846\u2014\u2014 \u4E0D\u7528\u622A\u56FE\uFF0C\u6CA1\u6709\u8BC6\u522B\u8BEF\u5DEE\uFF0C\u683C\u5F0F\u4E0D\u540C\uFF08\u65E5\u80A1/\u7F8E\u80A1/\u6295\u4FE1/\u30DE\u30CD\u30FC\u30D5\u30A1\u30F3\u30C9/\u5916\u8CA8\u9810\u308A\u91D1\uFF09\u90FD\u80FD\u81EA\u52A8\u8BC6\u522B\u3002"), /* @__PURE__ */ import_react.default.createElement(
      "textarea",
      {
        className: "paste-textarea",
        placeholder: "\u5728\u8FD9\u91CC\u7C98\u8D34\u4ECE\u7F51\u9875\u590D\u5236\u7684\u6301\u4ED3\u8868\u683C\u6587\u672C\u2026",
        value: text,
        onChange: (e) => {
          setText(e.target.value);
          setPreview(null);
        },
        rows: 8
      }
    ), /* @__PURE__ */ import_react.default.createElement("div", { className: "save-row", style: { padding: "10px 0" } }, /* @__PURE__ */ import_react.default.createElement("button", { className: "btn ghost", disabled: busy || !text.trim(), onClick: doPreview }, "\u5148\u770B\u89E3\u6790\u7ED3\u679C"), /* @__PURE__ */ import_react.default.createElement("button", { className: "btn", disabled: busy || !text.trim(), onClick: doCommit }, "\u76F4\u63A5\u63D0\u4EA4\u5230\u5F85\u786E\u8BA4\u961F\u5217")), error && /* @__PURE__ */ import_react.default.createElement("div", { className: "extract-status extract-error" }, error), preview && /* @__PURE__ */ import_react.default.createElement("div", { className: "extract-preview" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "extract-preview-title" }, "\u89E3\u6790\u9884\u89C8\uFF08", preview.count, " \u6761\uFF0C\u767D\u540D\u5355\u5916\u7684\u4EA7\u54C1\u4F1A\u88AB\u81EA\u52A8\u5FFD\u7565\uFF09"), /* @__PURE__ */ import_react.default.createElement("table", null, /* @__PURE__ */ import_react.default.createElement("thead", null, /* @__PURE__ */ import_react.default.createElement("tr", null, /* @__PURE__ */ import_react.default.createElement("th", null, "\u8D26\u6237"), /* @__PURE__ */ import_react.default.createElement("th", null, "\u4EA7\u54C1"), /* @__PURE__ */ import_react.default.createElement("th", { style: { textAlign: "right" } }, "\u8BC4\u4EF7\u989D"), /* @__PURE__ */ import_react.default.createElement("th", null, "\u5339\u914D\u65B9\u5F0F"))), /* @__PURE__ */ import_react.default.createElement("tbody", null, preview.matches.map((m, i) => /* @__PURE__ */ import_react.default.createElement("tr", { key: i }, /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u8D26\u6237" }, /* @__PURE__ */ import_react.default.createElement(import_shared.AccountTag, { account: m.account })), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u4EA7\u54C1" }, m.product_name), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u8BC4\u4EF7\u989D", className: "num" }, (0, import_shared.yen)(m.value)), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u5339\u914D\u65B9\u5F0F", style: { fontSize: 11, color: "var(--text-3)" } }, m.matched_by === "code" ? "\u4EE3\u7801" : "\u54C1\u540D", "\uFF08", (m.confidence * 100).toFixed(0), "%\uFF09"))))), /* @__PURE__ */ import_react.default.createElement("div", { className: "hint" }, "\u770B\u7740\u6CA1\u95EE\u9898\u7684\u8BDD\uFF0C\u70B9\u4E0A\u9762\u300C\u76F4\u63A5\u63D0\u4EA4\u5230\u5F85\u786E\u8BA4\u961F\u5217\u300D\u6B63\u5F0F\u63D0\u4EA4\u3002")));
  }
  var CASH_FIELDS = [
    ["moneyFund", "\u8D27\u5E01\u57FA\u91D1"],
    ["checking", "\u94F6\u884C\u6D3B\u671F"],
    ["brokerageCash", "\u8BC1\u5238\u8D26\u6237\u73B0\u91D1"],
    ["deposits", "\u5B9A\u671F\u5B58\u6B3E"]
  ];
  function CashSection() {
    const [cash, setCash] = (0, import_react.useState)(null);
    const [error, setError] = (0, import_react.useState)("");
    const [savedKey, setSavedKey] = (0, import_react.useState)(null);
    const load = () => import_dataService.dataService.getCash().then(setCash);
    (0, import_react.useEffect)(() => {
      load();
    }, []);
    const save = async (key, val) => {
      if (!cash || val === cash[key]) return;
      setError("");
      try {
        await import_dataService.dataService.setCash({ [key]: val });
        setCash((prev) => ({ ...prev, [key]: val }));
        setSavedKey(key);
        setTimeout(() => setSavedKey((k) => k === key ? null : k), 1500);
      } catch (err) {
        setError(err.message || "\u4FDD\u5B58\u5931\u8D25");
      }
    };
    if (!cash) return /* @__PURE__ */ import_react.default.createElement(import_shared.Loading, null);
    return /* @__PURE__ */ import_react.default.createElement("div", { style: { marginBottom: 18 } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "holding-group-label" }, "\u73B0\u91D1 / \u5B9A\u671F\u5B58\u6B3E\uFF08\u975E\u4EA7\u54C1\uFF0C\u5355\u72EC\u5B58\uFF09"), error && /* @__PURE__ */ import_react.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react.default.createElement("table", null, /* @__PURE__ */ import_react.default.createElement("thead", null, /* @__PURE__ */ import_react.default.createElement("tr", null, /* @__PURE__ */ import_react.default.createElement("th", null, "\u9879\u76EE"), /* @__PURE__ */ import_react.default.createElement("th", { style: { textAlign: "right" } }, "\u91D1\u989D"), /* @__PURE__ */ import_react.default.createElement("th", null))), /* @__PURE__ */ import_react.default.createElement("tbody", null, CASH_FIELDS.map(([key, label]) => /* @__PURE__ */ import_react.default.createElement("tr", { key }, /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u9879\u76EE" }, label), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u91D1\u989D", className: "num" }, /* @__PURE__ */ import_react.default.createElement(import_shared.EditableValue, { value: cash[key] || 0, onSave: (v) => save(key, v) })), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "" }, savedKey === key && /* @__PURE__ */ import_react.default.createElement("span", { className: "saved-flash" }, "\u5DF2\u4FDD\u5B58")))))));
  }
  function ManualEntryTab({ onDone }) {
    const [products, setProducts] = (0, import_react.useState)(null);
    const [latest, setLatest] = (0, import_react.useState)(null);
    const [busy, setBusy] = (0, import_react.useState)(false);
    const [error, setError] = (0, import_react.useState)("");
    const [savedKey, setSavedKey] = (0, import_react.useState)(null);
    const [adding, setAdding] = (0, import_react.useState)(false);
    const [newProductId, setNewProductId] = (0, import_react.useState)("");
    const [newAccount, setNewAccount] = (0, import_react.useState)(import_dataService.dataService.ACCOUNTS[0]);
    const [newValue, setNewValue] = (0, import_react.useState)("");
    const [newWarn, setNewWarn] = (0, import_react.useState)("");
    const load = () => {
      Promise.all([import_dataService.dataService.getProductsReal(), import_dataService.dataService.getLatestReal()]).then(([p, l]) => {
        setProducts(p);
        setLatest(l);
      });
    };
    (0, import_react.useEffect)(load, []);
    if (!products || !latest) return /* @__PURE__ */ import_react.default.createElement(import_shared.Loading, null);
    const productName = (pid) => (products.find((p) => p.id === pid) || {}).name || pid;
    const rows = [...latest].sort((a, b) => {
      if (a.account !== b.account) return a.account.localeCompare(b.account);
      return (a.name || "").localeCompare(b.name || "");
    });
    const saveAccount = async (row, newAccount2) => {
      if (newAccount2 === row.account) return;
      setBusy(true);
      setError("");
      try {
        await import_dataService.dataService.addManualHolding({
          product_id: row.product_id,
          product_name: row.name,
          account: newAccount2,
          value: row.value
        });
        setLatest((prev) => prev.map((r) => r.product_id === row.product_id && r.account === row.account ? { ...r, account: newAccount2 } : r));
      } catch (err) {
        setError(err.message || "\u4FDD\u5B58\u5931\u8D25");
      } finally {
        setBusy(false);
      }
    };
    const saveRow = async (row, newVal) => {
      if (newVal === row.value) return;
      setBusy(true);
      setError("");
      try {
        await import_dataService.dataService.addManualHolding({
          product_id: row.product_id,
          product_name: row.name,
          account: row.account,
          value: newVal
        });
        setLatest((prev) => prev.map((r) => r.product_id === row.product_id && r.account === row.account ? { ...r, value: newVal } : r));
        const key = `${row.product_id}||${row.account}`;
        setSavedKey(key);
        setTimeout(() => setSavedKey((k) => k === key ? null : k), 1500);
        onDone && onDone();
      } catch (err) {
        setError(err.message || "\u4FDD\u5B58\u5931\u8D25");
      } finally {
        setBusy(false);
      }
    };
    const checkNewDeviation = (val) => {
      if (!newProductId || !val) {
        setNewWarn("");
        return;
      }
      const prev = latest.find((l) => l.product_id === newProductId && l.account === newAccount);
      if (!prev || !prev.value) {
        setNewWarn("");
        return;
      }
      const ratio = Math.abs(val - prev.value) / prev.value;
      if (ratio > 0.5) {
        setNewWarn(`\u26A0 \u8FD9\u4E2A\u6570\u8DDF\u4E0A\u6B21\uFF08${(0, import_shared.yen)(prev.value)}\uFF09\u5DEE\u5F88\u591A\uFF0C\u786E\u5B9A\u6CA1\u6253\u9519\u5417\uFF1F`);
      } else {
        setNewWarn("");
      }
    };
    const submitNew = async () => {
      if (!newProductId || !newAccount || !newValue) return;
      setBusy(true);
      setError("");
      try {
        const p = products.find((x) => x.id === newProductId);
        await import_dataService.dataService.addManualHolding({
          product_id: newProductId,
          product_name: p ? p.name : "",
          account: newAccount,
          value: parseInt(newValue, 10)
        });
        setAdding(false);
        setNewProductId("");
        setNewValue("");
        setNewWarn("");
        load();
        onDone && onDone();
      } catch (err) {
        setError(err.message || "\u4FDD\u5B58\u5931\u8D25");
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "note-banner" }, "\u624B\u52A8\u6539\u7684\u6570\u5B57\u76F4\u63A5\u751F\u6548\u5165\u5E93\uFF08\u4E0D\u7ECF\u5F85\u786E\u8BA4\uFF0C\u4F60\u6572\u7684\u5C31\u662F\u786E\u8BA4\u8FC7\u7684\uFF09\u3002\u53CC\u51FB\u300C\u8BC4\u4EF7\u989D\u300D\u5C31\u5730\u7F16\u8F91\uFF0C\u79BB\u5F00\u5149\u6807\u6216\u56DE\u8F66\u4FDD\u5B58\u3002"), /* @__PURE__ */ import_react.default.createElement(CashSection, null), error && /* @__PURE__ */ import_react.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react.default.createElement("table", null, /* @__PURE__ */ import_react.default.createElement("thead", null, /* @__PURE__ */ import_react.default.createElement("tr", null, /* @__PURE__ */ import_react.default.createElement("th", null, "\u8D26\u6237"), /* @__PURE__ */ import_react.default.createElement("th", null, "\u4EA7\u54C1"), /* @__PURE__ */ import_react.default.createElement("th", { style: { textAlign: "right" } }, "\u8BC4\u4EF7\u989D"), /* @__PURE__ */ import_react.default.createElement("th", null))), /* @__PURE__ */ import_react.default.createElement("tbody", null, rows.map((row) => {
      const key = `${row.product_id}||${row.account}`;
      return /* @__PURE__ */ import_react.default.createElement("tr", { key }, /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u8D26\u6237" }, /* @__PURE__ */ import_react.default.createElement("select", { value: row.account, onChange: (e) => saveAccount(row, e.target.value) }, row.account === "" && /* @__PURE__ */ import_react.default.createElement("option", { value: "" }, "(\u7A7A)"), import_dataService.dataService.ACCOUNTS.map((a) => /* @__PURE__ */ import_react.default.createElement("option", { key: a, value: a }, a)))), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u4EA7\u54C1" }, row.name || productName(row.product_id)), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u8BC4\u4EF7\u989D", className: "num" }, /* @__PURE__ */ import_react.default.createElement(import_shared.EditableValue, { value: row.value, onSave: (v) => saveRow(row, v) })), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "" }, savedKey === key && /* @__PURE__ */ import_react.default.createElement("span", { className: "saved-flash" }, "\u5DF2\u4FDD\u5B58")));
    }))), /* @__PURE__ */ import_react.default.createElement("div", { style: { marginTop: 14 } }, !adding ? /* @__PURE__ */ import_react.default.createElement("button", { className: "btn ghost sm", onClick: () => setAdding(true) }, "\uFF0B \u65B0\u589E\u4EA7\u54C1/\u8D26\u6237\u7EC4\u5408") : /* @__PURE__ */ import_react.default.createElement("div", { className: "card", style: { background: "var(--panel-2)", marginTop: 4 } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "field" }, /* @__PURE__ */ import_react.default.createElement("label", null, "\u4EA7\u54C1"), /* @__PURE__ */ import_react.default.createElement("select", { value: newProductId, onChange: (e) => {
      setNewProductId(e.target.value);
      checkNewDeviation(parseInt(newValue, 10) || 0);
    } }, /* @__PURE__ */ import_react.default.createElement("option", { value: "" }, "\u8BF7\u9009\u62E9\u4EA7\u54C1\u2026"), products.map((p) => /* @__PURE__ */ import_react.default.createElement("option", { key: p.id, value: p.id }, p.name)))), /* @__PURE__ */ import_react.default.createElement("div", { className: "field" }, /* @__PURE__ */ import_react.default.createElement("label", null, "\u8D26\u6237"), /* @__PURE__ */ import_react.default.createElement("select", { value: newAccount, onChange: (e) => {
      setNewAccount(e.target.value);
      checkNewDeviation(parseInt(newValue, 10) || 0);
    } }, import_dataService.dataService.ACCOUNTS.map((a) => /* @__PURE__ */ import_react.default.createElement("option", { key: a, value: a }, a)))), /* @__PURE__ */ import_react.default.createElement("div", { className: "field" }, /* @__PURE__ */ import_react.default.createElement("label", null, "\u8BC4\u4EF7\u989D\uFF08\u5186\uFF09"), /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        type: "number",
        value: newValue,
        onChange: (e) => {
          setNewValue(e.target.value);
          checkNewDeviation(parseInt(e.target.value, 10) || 0);
        },
        placeholder: "\u4F8B\uFF1A598771"
      }
    )), newWarn && /* @__PURE__ */ import_react.default.createElement("div", { className: "warn" }, newWarn), /* @__PURE__ */ import_react.default.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ import_react.default.createElement("button", { className: "btn sm", disabled: busy || !newProductId || !newValue, onClick: submitNew }, "\u4FDD\u5B58"), /* @__PURE__ */ import_react.default.createElement("button", { className: "btn ghost sm", onClick: () => {
      setAdding(false);
      setNewProductId("");
      setNewValue("");
      setNewWarn("");
    } }, "\u53D6\u6D88")))));
  }
  function ProductManageTab() {
    const [products, setProducts] = (0, import_react.useState)(null);
    const [error, setError] = (0, import_react.useState)("");
    const [editingId, setEditingId] = (0, import_react.useState)(null);
    const [editAliases, setEditAliases] = (0, import_react.useState)("");
    const [adding, setAdding] = (0, import_react.useState)(false);
    const [newId, setNewId] = (0, import_react.useState)("");
    const [newName, setNewName] = (0, import_react.useState)("");
    const [newAliases, setNewAliases] = (0, import_react.useState)("");
    const [busy, setBusy] = (0, import_react.useState)(false);
    const load = () => import_dataService.dataService.getProductsReal().then(setProducts).catch((e) => setError(e.message));
    (0, import_react.useEffect)(() => {
      load();
    }, []);
    if (!products) return /* @__PURE__ */ import_react.default.createElement(import_shared.Loading, null);
    const startEdit = (p) => {
      setEditingId(p.id);
      setEditAliases(p.aliases.join("\u3001"));
    };
    const saveEdit = async (id) => {
      setBusy(true);
      setError("");
      try {
        await import_dataService.dataService.updateProduct(id, { aliases: editAliases.split(/[、,，]/).map((s) => s.trim()).filter(Boolean) });
        setEditingId(null);
        load();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    };
    const remove = async (id) => {
      if (!window.confirm(`\u786E\u5B9A\u4ECE\u8BC6\u522B\u767D\u540D\u5355\u5220\u9664\u300C${id}\u300D\uFF1F\uFF08\u53EA\u5F71\u54CD\u4EE5\u540E\u7684\u8BC6\u522B\uFF0C\u4E0D\u5F71\u54CD\u5DF2\u6709\u5386\u53F2\u6570\u636E\uFF09`)) return;
      setBusy(true);
      setError("");
      try {
        await import_dataService.dataService.deleteProduct(id);
        load();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    };
    const submitNew = async () => {
      if (!newId || !newName) return;
      setBusy(true);
      setError("");
      try {
        await import_dataService.dataService.addProduct({
          id: newId,
          name: newName,
          aliases: newAliases.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
        });
        setAdding(false);
        setNewId("");
        setNewName("");
        setNewAliases("");
        load();
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "note-banner" }, "\u8FD9\u91CC\u7BA1\u7684\u662F\u300C\u8BC6\u522B\u767D\u540D\u5355\u300D\u2014\u2014\u622A\u56FE/\u6587\u672C\u80FD\u8BA4\u51FA\u54EA\u4E9B\u4EA7\u54C1\uFF0C\u5C31\u9760\u8FD9\u5F20\u8868\u3002\u65B0\u589E/\u6539\u522B\u540D\u9A6C\u4E0A\u751F\u6548\uFF0C\u5220\u9664\u53EA\u5F71\u54CD\u4EE5\u540E\u8BC6\u522B\uFF0C\u4E0D\u52A8\u5386\u53F2\u6570\u636E\u3002"), error && /* @__PURE__ */ import_react.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react.default.createElement("table", null, /* @__PURE__ */ import_react.default.createElement("thead", null, /* @__PURE__ */ import_react.default.createElement("tr", null, /* @__PURE__ */ import_react.default.createElement("th", null, "ID"), /* @__PURE__ */ import_react.default.createElement("th", null, "\u540D\u79F0"), /* @__PURE__ */ import_react.default.createElement("th", null, "\u522B\u540D\uFF08\u542B\u4EE3\u7801/ticker\uFF09"), /* @__PURE__ */ import_react.default.createElement("th", null))), /* @__PURE__ */ import_react.default.createElement("tbody", null, products.map((p) => /* @__PURE__ */ import_react.default.createElement("tr", { key: p.id }, /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "ID", style: { fontFamily: "ui-monospace,monospace", fontSize: 12 } }, p.id), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u540D\u79F0" }, p.name), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u522B\u540D" }, editingId === p.id ? /* @__PURE__ */ import_react.default.createElement("input", { type: "text", value: editAliases, onChange: (e) => setEditAliases(e.target.value), style: { width: "100%" } }) : /* @__PURE__ */ import_react.default.createElement("span", { style: { fontSize: 12, color: "var(--text-2)" } }, p.aliases.join("\u3001"))), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u64CD\u4F5C" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "row-actions" }, editingId === p.id ? /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("button", { className: "icon-btn", disabled: busy, onClick: () => saveEdit(p.id) }, "\u4FDD\u5B58"), /* @__PURE__ */ import_react.default.createElement("button", { className: "icon-btn", onClick: () => setEditingId(null) }, "\u53D6\u6D88")) : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("button", { className: "icon-btn", onClick: () => startEdit(p) }, "\u6539\u522B\u540D"), /* @__PURE__ */ import_react.default.createElement("button", { className: "icon-btn danger", disabled: busy, onClick: () => remove(p.id) }, "\u5220")))))))), /* @__PURE__ */ import_react.default.createElement("div", { style: { marginTop: 14 } }, !adding ? /* @__PURE__ */ import_react.default.createElement("button", { className: "btn ghost sm", onClick: () => setAdding(true) }, "\uFF0B \u65B0\u589E\u4EA7\u54C1") : /* @__PURE__ */ import_react.default.createElement("div", { className: "card", style: { background: "var(--panel-2)", marginTop: 4 } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "field" }, /* @__PURE__ */ import_react.default.createElement("label", null, "ID\uFF08\u82F1\u6587/\u6570\u5B57\uFF0C\u552F\u4E00\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { type: "text", value: newId, onChange: (e) => setNewId(e.target.value), placeholder: "\u4F8B\uFF1Avoo" })), /* @__PURE__ */ import_react.default.createElement("div", { className: "field" }, /* @__PURE__ */ import_react.default.createElement("label", null, "\u540D\u79F0"), /* @__PURE__ */ import_react.default.createElement("input", { type: "text", value: newName, onChange: (e) => setNewName(e.target.value), placeholder: "\u4F8B\uFF1A\u30D0\u30F3\u30AC\u30FC\u30C9\u30FBS&P 500 ETF" })), /* @__PURE__ */ import_react.default.createElement("div", { className: "field" }, /* @__PURE__ */ import_react.default.createElement("label", null, "\u522B\u540D\uFF08\u987F\u53F7/\u9017\u53F7\u5206\u9694\uFF0C\u542B\u4EE3\u7801/ticker\u6700\u597D\uFF09"), /* @__PURE__ */ import_react.default.createElement("input", { type: "text", value: newAliases, onChange: (e) => setNewAliases(e.target.value), placeholder: "\u4F8B\uFF1AVOO\u3001\u30D0\u30F3\u30AC\u30FC\u30C9" })), /* @__PURE__ */ import_react.default.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ import_react.default.createElement("button", { className: "btn sm", disabled: busy || !newId || !newName, onClick: submitNew }, "\u4FDD\u5B58"), /* @__PURE__ */ import_react.default.createElement("button", { className: "btn ghost sm", onClick: () => {
      setAdding(false);
      setNewId("");
      setNewName("");
      setNewAliases("");
    } }, "\u53D6\u6D88")))));
  }
  function ImportPage() {
    const [tab, setTab] = (0, import_react.useState)("text");
    const [refreshKey, setRefreshKey] = (0, import_react.useState)(0);
    const bump = () => setRefreshKey((k) => k + 1);
    return /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("h2", { className: "page-title" }, "\u6570\u636E\u5F55\u5165"), /* @__PURE__ */ import_react.default.createElement("div", { className: "page-sub" }, "\u6587\u672C\u7C98\u8D34\u8FDB\u5F85\u786E\u8BA4\u961F\u5217\u6838\u5BF9\u540E\u751F\u6548\uFF1B\u624B\u52A8\u5F55\u5165\u76F4\u63A5\u5165\u5E93"), /* @__PURE__ */ import_react.default.createElement(import_shared.Card, null, /* @__PURE__ */ import_react.default.createElement("div", { className: "mode-switch", style: { marginBottom: 16 } }, /* @__PURE__ */ import_react.default.createElement("button", { className: tab === "text" ? "mode-btn on" : "mode-btn", onClick: () => setTab("text") }, "\u{1F4CB} \u6587\u672C\u7C98\u8D34"), /* @__PURE__ */ import_react.default.createElement("button", { className: tab === "manual" ? "mode-btn on" : "mode-btn", onClick: () => setTab("manual") }, "\u270F\uFE0F \u624B\u52A8\u5F55\u5165"), /* @__PURE__ */ import_react.default.createElement("button", { className: tab === "products" ? "mode-btn on" : "mode-btn", onClick: () => setTab("products") }, "\u{1F3F7}\uFE0F \u4EA7\u54C1\u7BA1\u7406")), tab === "text" && /* @__PURE__ */ import_react.default.createElement(TextPasteTab, { onDone: bump }), tab === "manual" && /* @__PURE__ */ import_react.default.createElement(ManualEntryTab, { onDone: bump }), tab === "products" && /* @__PURE__ */ import_react.default.createElement(ProductManageTab, null)));
  }
  window.ImportPage = ImportPage;
})();

} catch(e) { console.error('import.js 加载出错:', e);  }
