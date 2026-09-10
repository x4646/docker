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

  // pages/HistoryPage.jsx
  var import_react = __toESM(__require("react"));
  var import_dataService = __require("../dataService.js");
  var import_shared = __require("../shared.jsx");
  function dedupeLatestPerDay(rows) {
    const bucket = /* @__PURE__ */ new Map();
    rows.forEach((r) => {
      const key = `${r.product_id}||${r.account}||${r.date}`;
      const cur = bucket.get(key);
      if (!cur || r.id > cur.id) bucket.set(key, r);
    });
    return Array.from(bucket.values()).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  }
  function HistoryPage() {
    const [rows, setRows] = (0, import_react.useState)(null);
    const [products, setProducts] = (0, import_react.useState)(null);
    const [filterId, setFilterId] = (0, import_react.useState)("");
    const [savedId, setSavedId] = (0, import_react.useState)(null);
    const [error, setError] = (0, import_react.useState)("");
    const load = () => {
      import_dataService.dataService.getHistoryRowsReal(filterId ? { product_id: filterId } : {}).then((raw) => setRows(dedupeLatestPerDay(raw))).catch((e) => setError(e.message));
    };
    (0, import_react.useEffect)(() => {
      import_dataService.dataService.getProductsReal().then(setProducts);
    }, []);
    (0, import_react.useEffect)(load, [filterId]);
    const del = async (id) => {
      if (!window.confirm("\u786E\u5B9A\u5220\u9664\u8FD9\u6761\u8BB0\u5F55\uFF1F\u5220\u4E86\u4F1A\u7ACB\u523B\u4ECE\u6298\u7EBF/\u603B\u8D44\u4EA7\u91CC\u6D88\u5931\uFF0C\u4E14\u4E0D\u53EF\u6062\u590D\u3002")) return;
      try {
        await import_dataService.dataService.deleteHistoryRowReal(id);
        load();
      } catch (err) {
        setError(err.message);
      }
    };
    const saveValue = async (id, newVal) => {
      try {
        await import_dataService.dataService.updateHistoryRowReal(id, newVal);
        setRows((prev) => prev.map((r) => r.id === id ? { ...r, value: newVal } : r));
        setSavedId(id);
        setTimeout(() => setSavedId(null), 1500);
      } catch (err) {
        setError(err.message);
      }
    };
    return /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("h2", { className: "page-title" }, "\u5386\u53F2\u6570\u636E\u7EF4\u62A4"), /* @__PURE__ */ import_react.default.createElement("div", { className: "page-sub" }, "\u7EF4\u62A4\u6298\u7EBF\u80CC\u540E\u7684\u5DF2\u786E\u8BA4\u6570\u636E \xB7 \u6BCF\u5929\u6BCF\u4E2A\u4EA7\u54C1/\u8D26\u6237\u53EA\u663E\u793A\u6700\u540E\u4E00\u6761\uFF08\u6570\u636E\u5E93\u5B8C\u6574\u4FDD\u7559\uFF0C\u8FD9\u91CC\u53EA\u662F\u663E\u793A\u5E72\u51C0\uFF09 \xB7 \u53CC\u51FB\u8BC4\u4EF7\u989D\u5C31\u5730\u7F16\u8F91"), /* @__PURE__ */ import_react.default.createElement(import_shared.Card, null, /* @__PURE__ */ import_react.default.createElement("div", { className: "toolbar" }, /* @__PURE__ */ import_react.default.createElement("select", { value: filterId, onChange: (e) => setFilterId(e.target.value) }, /* @__PURE__ */ import_react.default.createElement("option", { value: "" }, "\u5168\u90E8\u4EA7\u54C1"), products && products.map((p) => /* @__PURE__ */ import_react.default.createElement("option", { key: p.id, value: p.id }, p.name)))), error && /* @__PURE__ */ import_react.default.createElement("div", { className: "extract-status extract-error" }, error), !rows ? /* @__PURE__ */ import_react.default.createElement(import_shared.Loading, null) : /* @__PURE__ */ import_react.default.createElement("table", null, /* @__PURE__ */ import_react.default.createElement("thead", null, /* @__PURE__ */ import_react.default.createElement("tr", null, /* @__PURE__ */ import_react.default.createElement("th", null, "\u65F6\u95F4"), /* @__PURE__ */ import_react.default.createElement("th", null, "\u4EA7\u54C1"), /* @__PURE__ */ import_react.default.createElement("th", null, "\u8D26\u6237"), /* @__PURE__ */ import_react.default.createElement("th", { style: { textAlign: "right" } }, "\u8BC4\u4EF7\u989D"), /* @__PURE__ */ import_react.default.createElement("th", null, "\u6765\u6E90"), /* @__PURE__ */ import_react.default.createElement("th", null, "\u64CD\u4F5C"))), /* @__PURE__ */ import_react.default.createElement("tbody", null, rows.map((r) => /* @__PURE__ */ import_react.default.createElement("tr", { key: r.id }, /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u65F6\u95F4", style: { fontFamily: "ui-monospace,monospace" } }, r.date), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u4EA7\u54C1" }, r.product_name), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u8D26\u6237" }, /* @__PURE__ */ import_react.default.createElement(import_shared.AccountTag, { account: r.account })), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u8BC4\u4EF7\u989D", className: "num" }, /* @__PURE__ */ import_react.default.createElement(import_shared.EditableValue, { value: r.value, onSave: (v) => saveValue(r.id, v) }), savedId === r.id && /* @__PURE__ */ import_react.default.createElement("span", { className: "saved-flash" }, " \u5DF2\u4FDD\u5B58")), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u6765\u6E90", style: { fontSize: 11, color: "var(--text-3)" } }, r.source), /* @__PURE__ */ import_react.default.createElement("td", { "data-label": "\u64CD\u4F5C" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "row-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "icon-btn danger", onClick: () => del(r.id) }, "\u5220"))))))), /* @__PURE__ */ import_react.default.createElement("div", { className: "hint" }, "\u53CC\u51FB\u300C\u8BC4\u4EF7\u989D\u300D\u76F4\u63A5\u6539\uFF0C\u70B9\u522B\u5904\u6216\u6309\u56DE\u8F66\u4FDD\u5B58\uFF0CEsc \u53D6\u6D88\u3002\u6539\u52A8\u5373\u65F6\u53CD\u6620\u5230\u6298\u7EBF\uFF08\u6298\u7EBF\u7528\u7684\u5C31\u662F\u8FD9\u4E9B\u6570\u636E\uFF09\u3002")));
  }
  window.HistoryPage = HistoryPage;
})();

} catch(e) { console.error('history.js 加载出错:', e);  }
