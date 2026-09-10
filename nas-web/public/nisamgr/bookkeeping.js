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
  // bookkeeping.js
  var import_react18 = __toESM(__require("react"));
  var import_shared21 = __require("./shared.jsx");
  var import_dataService16 = __require("./dataService.js");

  const { AccountsStrip, AccountsTab, BackupTab, BudgetAlertBanner, BudgetTab, CategoryTab, ChartsTab, CsvImportTab, ManualTxTab, MembersTab, MonthlyCompareTab, ProjectionTab, RecurringTab, SummaryCard, TemplatesTab, TxListTab } = window.__bk;

  var TABS = [
    ["manual", "\u270F\uFE0F \u8BB0\u4E00\u7B14"],
    ["templates", "\u26A1 \u5E38\u7528\u6A21\u677F"],
    ["csv", "\u{1F4CB} CSV\u5BFC\u5165"],
    ["list", "\u{1F4D1} \u660E\u7EC6"],
    ["accounts", "\u{1F45B} \u8D26\u6237"],
    ["category", "\u{1F3F7}\uFE0F \u5206\u7C7B"],
    ["members", "\u{1F468}\u200D\u{1F469}\u200D\u{1F467} \u6210\u5458"],
    ["budget", "\u{1F4B0} \u9884\u7B97"],
    ["recurring", "\u{1F501} \u5468\u671F\u6027"],
    ["charts", "\u{1F4CA} \u56FE\u8868"],
    ["compare", "\u{1F4C5} \u6708\u5EA6\u5BF9\u6BD4"],
    ["projection", "\u{1F4C8} \u672A\u6765\u63A8\u7B97"],
    ["backup", "\u{1F4BE} \u6570\u636E\u5907\u4EFD"]
  ];

  function BookkeepingPage() {
    const [tab, setTab] = (0, import_react18.useState)("manual");
    const [categories, setCategories] = (0, import_react18.useState)(null);
    const [accounts, setAccounts] = (0, import_react18.useState)(null);
    const [members, setMembers] = (0, import_react18.useState)(null);
    const [refreshKey, setRefreshKey] = (0, import_react18.useState)(0);
    const bump = () => setRefreshKey((k) => k + 1);
    const loadAll = () => {
      import_dataService16.dataService.getCategories().then(setCategories);
      import_dataService16.dataService.getAccounts().then(setAccounts);
      import_dataService16.dataService.getMembers().then(setMembers);
    };
    (0, import_react18.useEffect)(() => {
      loadAll();
    }, []);
    if (!categories || !accounts || !members) return /* @__PURE__ */ import_react18.default.createElement(import_shared21.Loading, null);
    return /* @__PURE__ */ import_react18.default.createElement("div", null, /* @__PURE__ */ import_react18.default.createElement("h2", { className: "page-title" }, "\u8BB0\u8D26"), /* @__PURE__ */ import_react18.default.createElement("div", { className: "page-sub" }, "\u6536\u652F\u6D41\u6C34+\u8D26\u6237\u4F59\u989D\uFF0C\u72EC\u7ACB\u4E8E\u8D44\u4EA7\u6301\u4ED3\uFF08\u672A\u6765\u8D44\u4EA7\u63A8\u7B97\u628A\u4E24\u8005\u7ED3\u5408\uFF09"), /* @__PURE__ */ import_react18.default.createElement(SummaryCard, { refreshKey }), /* @__PURE__ */ import_react18.default.createElement(BudgetAlertBanner, null), /* @__PURE__ */ import_react18.default.createElement(AccountsStrip, { accounts, refreshKey }), /* @__PURE__ */ import_react18.default.createElement("div", { className: "card" }, /* @__PURE__ */ import_react18.default.createElement("div", { className: "mode-switch", style: { marginBottom: 16, flexWrap: "wrap" } }, TABS.map(([k, label]) => /* @__PURE__ */ import_react18.default.createElement("button", { key: k, className: tab === k ? "mode-btn on" : "mode-btn", onClick: () => setTab(k) }, label))), tab === "manual" && /* @__PURE__ */ import_react18.default.createElement(ManualTxTab, { categories, accounts, members, onDone: bump, onReordered: loadAll }), tab === "templates" && /* @__PURE__ */ import_react18.default.createElement(TemplatesTab, { categories, accounts, onDone: bump, onReordered: loadAll }), tab === "csv" && /* @__PURE__ */ import_react18.default.createElement(CsvImportTab, { onDone: bump }), tab === "list" && /* @__PURE__ */ import_react18.default.createElement(TxListTab, { refreshKey, categories, accounts, members, onReordered: loadAll }), tab === "accounts" && /* @__PURE__ */ import_react18.default.createElement(AccountsTab, { onChange: loadAll }), tab === "category" && /* @__PURE__ */ import_react18.default.createElement(CategoryTab, { categories, onChange: loadAll }), tab === "members" && /* @__PURE__ */ import_react18.default.createElement(MembersTab, null), tab === "budget" && /* @__PURE__ */ import_react18.default.createElement(BudgetTab, { categories, onReordered: loadAll }), tab === "recurring" && /* @__PURE__ */ import_react18.default.createElement(RecurringTab, { categories, accounts, onDone: bump, onReordered: loadAll }), tab === "charts" && /* @__PURE__ */ import_react18.default.createElement(ChartsTab, { refreshKey }), tab === "compare" && /* @__PURE__ */ import_react18.default.createElement(MonthlyCompareTab, null), tab === "projection" && /* @__PURE__ */ import_react18.default.createElement(ProjectionTab, null), tab === "backup" && /* @__PURE__ */ import_react18.default.createElement(BackupTab, null)));
  }

  window.BookkeepingPage = BookkeepingPage;
})();

} catch(e) { console.error('bookkeeping.js 加载出错:', e); }
