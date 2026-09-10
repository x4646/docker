window.require=function(m){
  if(m==='react')return window.React;
  if(m==='react-dom'||m==='react-dom/client')return window.ReactDOM;
  if(m.endsWith('dataService.js'))return {dataService: window.__core.dataService};
  if(m.endsWith('shared.jsx'))return window.__core.shared;
  throw new Error('未知模块: '+m);
};
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
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
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

  // entry.jsx
  var import_react3 = __toESM(__require("react"));
  var import_client = __require("react-dom/client");

  // App.jsx
  var import_react = __toESM(__require("react"));

  // dataService.js
  var NAS_BASE = "/api/asset";
  async function getProducts() {
    return (await fetch(`${NAS_BASE}/products`)).json().then((j) => j.products || []);
  }
  async function getCash() {
    return (await fetch(`${NAS_BASE}/cash`)).json();
  }
  async function setCash(patch) {
    const res = await fetch(`${NAS_BASE}/cash`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    if (!res.ok) throw new Error(`\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return res.json();
  }
  var dataService = {
    getProducts,
    getCash,
    setCash,
    NAS_BASE
  };
  async function recognizeToPending(file) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${NAS_BASE}/recognize-to-pending`, { method: "POST", body: form });
    if (!res.ok) throw new Error(`\u8BC6\u522B\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return res.json();
  }
  async function parseText(text) {
    const res = await fetch(`${NAS_BASE}/parse-text`, { method: "POST", body: text });
    if (!res.ok) throw new Error(`\u89E3\u6790\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return res.json();
  }
  async function pasteToPending(text) {
    const res = await fetch(`${NAS_BASE}/paste-to-pending`, { method: "POST", body: text });
    if (!res.ok) throw new Error(`\u89E3\u6790\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return res.json();
  }
  async function addManualHolding({ product_id, product_name, account, value, date }) {
    const res = await fetch(`${NAS_BASE}/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id, product_name, account, value, date })
    });
    if (!res.ok) throw new Error(`\u5F55\u5165\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return res.json();
  }
  async function getPendingReal() {
    const res = await fetch(`${NAS_BASE}/pending`);
    if (!res.ok) throw new Error(`\u83B7\u53D6\u5F85\u786E\u8BA4\u961F\u5217\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return res.json();
  }
  async function confirmPending(items) {
    const res = await fetch(`${NAS_BASE}/pending/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items })
    });
    if (!res.ok) throw new Error(`\u786E\u8BA4\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return res.json();
  }
  async function rejectPending(ids) {
    const res = await fetch(`${NAS_BASE}/pending/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    });
    if (!res.ok) throw new Error(`\u64CD\u4F5C\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return res.json();
  }
  async function getLatestReal() {
    const res = await fetch(`${NAS_BASE}/latest`);
    if (!res.ok) throw new Error(`\u83B7\u53D6\u6700\u65B0\u503C\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    const json = await res.json();
    return json.latest || [];
  }
  async function getProductsReal() {
    const res = await fetch(`${NAS_BASE}/products`);
    if (!res.ok) throw new Error(`\u83B7\u53D6\u4EA7\u54C1\u5217\u8868\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    const json = await res.json();
    return json.products || [];
  }
  var ACCOUNTS = ["\u7279\u5B9A", "NISA\u6210\u9577", "NISA\u3064\u307F\u305F\u3066", "NISA(\u8981\u786E\u8BA4)"];
  Object.assign(dataService, {
    recognizeToPending,
    parseText,
    pasteToPending,
    addManualHolding,
    getPendingReal,
    confirmPending,
    rejectPending,
    getLatestReal,
    getProductsReal,
    ACCOUNTS
  });
  async function getTransactions(filter) {
    const params = new URLSearchParams();
    if (filter) {
      if (filter.start) params.set("start", filter.start);
      if (filter.end) params.set("end", filter.end);
      if (filter.type) params.set("type", filter.type);
    }
    const res = await fetch(`${NAS_BASE}/transactions?${params.toString()}`);
    if (!res.ok) throw new Error(`\u83B7\u53D6\u8BB0\u8D26\u6570\u636E\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return (await res.json()).rows || [];
  }
  async function addTransaction(payload) {
    const res = await fetch(`${NAS_BASE}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function updateTransaction(id, patch) {
    const res = await fetch(`${NAS_BASE}/transactions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function deleteTransaction(id) {
    const res = await fetch(`${NAS_BASE}/transactions/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u5220\u9664\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function getTransactionSummary(filter) {
    const params = new URLSearchParams();
    if (filter) {
      if (filter.start) params.set("start", filter.start);
      if (filter.end) params.set("end", filter.end);
    }
    const res = await fetch(`${NAS_BASE}/transactions/summary?${params.toString()}`);
    if (!res.ok) throw new Error(`\u83B7\u53D6\u6C47\u603B\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return res.json();
  }
  async function importTransactionsCsv(csvText) {
    const res = await fetch(`${NAS_BASE}/transactions/import-csv`, { method: "POST", body: csvText });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u5BFC\u5165\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  Object.assign(dataService, {
    getTransactions,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    getTransactionSummary,
    importTransactionsCsv
  });
  async function getCategories() {
    const res = await fetch(`${NAS_BASE}/categories`);
    if (!res.ok) throw new Error(`\u83B7\u53D6\u5206\u7C7B\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return (await res.json()).categories || [];
  }
  async function addCategory(payload) {
    const res = await fetch(`${NAS_BASE}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function updateCategory(id, payload) {
    const res = await fetch(`${NAS_BASE}/categories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function reorderCategories(ids) {
    const res = await fetch(`${NAS_BASE}/categories/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u6392\u5E8F\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function reorderAccounts(ids) {
    const res = await fetch(`${NAS_BASE}/accounts/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u6392\u5E8F\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function deleteCategory(id) {
    const res = await fetch(`${NAS_BASE}/categories/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u5220\u9664\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function getBudgetStatus(month) {
    const res = await fetch(`${NAS_BASE}/budgets/status?month=${month}`);
    if (!res.ok) throw new Error(`\u83B7\u53D6\u9884\u7B97\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return res.json();
  }
  async function setBudget(payload) {
    const res = await fetch(`${NAS_BASE}/budgets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function getRecurring() {
    const res = await fetch(`${NAS_BASE}/recurring`);
    if (!res.ok) throw new Error(`\u83B7\u53D6\u5468\u671F\u4EA4\u6613\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return (await res.json()).items || [];
  }
  async function addRecurring(payload) {
    const res = await fetch(`${NAS_BASE}/recurring`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function updateRecurring(id, payload) {
    const res = await fetch(`${NAS_BASE}/recurring/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function deleteRecurring(id) {
    const res = await fetch(`${NAS_BASE}/recurring/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u5220\u9664\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function generateRecurring(month) {
    const res = await fetch(`${NAS_BASE}/recurring/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(month ? { month } : {})
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u751F\u6210\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function getFutureProjection(currentNetWorth, months) {
    const res = await fetch(`${NAS_BASE}/future-projection?current_net_worth=${currentNetWorth}&months=${months}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u63A8\u7B97\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function exportBackup() {
    const res = await fetch(`${NAS_BASE}/backup/export`);
    if (!res.ok) throw new Error(`\u5BFC\u51FA\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return res.json();
  }
  async function importBackup(backupData) {
    const res = await fetch(`${NAS_BASE}/backup/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backupData)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u5BFC\u5165\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function getAccounts() {
    const res = await fetch(`${NAS_BASE}/accounts`);
    if (!res.ok) throw new Error(`\u83B7\u53D6\u8D26\u6237\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return (await res.json()).accounts || [];
  }
  async function addAccount(payload) {
    const res = await fetch(`${NAS_BASE}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function updateAccount(id, payload) {
    const res = await fetch(`${NAS_BASE}/accounts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function deleteAccount(id) {
    const res = await fetch(`${NAS_BASE}/accounts/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u5220\u9664\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function recalculateAccount(id) {
    const res = await fetch(`${NAS_BASE}/accounts/${id}/recalculate`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u91CD\u7B97\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function getMembers() {
    const res = await fetch(`${NAS_BASE}/members`);
    if (!res.ok) throw new Error(`\u83B7\u53D6\u6210\u5458\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return (await res.json()).members || [];
  }
  async function addMember(payload) {
    const res = await fetch(`${NAS_BASE}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function deleteMember(id) {
    const res = await fetch(`${NAS_BASE}/members/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u5220\u9664\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  Object.assign(dataService, {
    getAccounts,
    addAccount,
    updateAccount,
    deleteAccount,
    recalculateAccount,
    reorderAccounts,
    getMembers,
    addMember,
    deleteMember
  });
  async function getMonthlySummary(months) {
    const res = await fetch(`${NAS_BASE}/transactions/monthly?months=${months}`);
    if (!res.ok) throw new Error(`\u83B7\u53D6\u6708\u5EA6\u6C47\u603B\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return (await res.json()).months || [];
  }
  async function getQuickTemplates() {
    const res = await fetch(`${NAS_BASE}/quick-templates`);
    if (!res.ok) throw new Error(`\u83B7\u53D6\u6A21\u677F\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return (await res.json()).items || [];
  }
  async function addQuickTemplate(payload) {
    const res = await fetch(`${NAS_BASE}/quick-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function deleteQuickTemplate(id) {
    const res = await fetch(`${NAS_BASE}/quick-templates/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u5220\u9664\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function useQuickTemplate(id) {
    const res = await fetch(`${NAS_BASE}/quick-templates/${id}/use`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u8BB0\u8D26\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  Object.assign(dataService, {
    getCategories,
    addCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    getBudgetStatus,
    setBudget,
    getRecurring,
    addRecurring,
    updateRecurring,
    deleteRecurring,
    generateRecurring,
    getFutureProjection,
    exportBackup,
    importBackup,
    getMonthlySummary,
    getQuickTemplates,
    addQuickTemplate,
    deleteQuickTemplate,
    useQuickTemplate
  });
  async function getPendingSource(batchId) {
    const res = await fetch(`${NAS_BASE}/pending/source/${batchId}`);
    if (!res.ok) throw new Error(res.status === 404 ? "\u627E\u4E0D\u5230\u539F\u59CB\u6765\u6E90\uFF08\u8F83\u65E9\u7684\u65E7\u6570\u636E\u53EF\u80FD\u6CA1\u5B58\uFF09" : `\u83B7\u53D6\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return res.json();
  }
  Object.assign(dataService, { getPendingSource });
  async function addProduct({ id, name, aliases }) {
    const res = await fetch(`${NAS_BASE}/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, aliases })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function updateProduct(id, patch) {
    const res = await fetch(`${NAS_BASE}/products/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  async function deleteProduct(id) {
    const res = await fetch(`${NAS_BASE}/products/${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || `\u5220\u9664\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return json;
  }
  Object.assign(dataService, { addProduct, updateProduct, deleteProduct });
  async function getHoldingsReal() {
    const res = await fetch(`${NAS_BASE}/holdings`);
    if (!res.ok) throw new Error(`\u83B7\u53D6\u5386\u53F2\u6570\u636E\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    const json = await res.json();
    return json.series || [];
  }
  Object.assign(dataService, { getHoldingsReal });
  async function getHistoryRowsReal(filter) {
    const params = new URLSearchParams();
    if (filter && filter.product_id) params.set("product_id", filter.product_id);
    if (filter && filter.account) params.set("account", filter.account);
    const res = await fetch(`${NAS_BASE}/holdings/rows?${params.toString()}`);
    if (!res.ok) throw new Error(`\u83B7\u53D6\u5386\u53F2\u6570\u636E\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    const json = await res.json();
    return json.rows || [];
  }
  async function updateHistoryRowReal(id, value) {
    const res = await fetch(`${NAS_BASE}/holdings/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value })
    });
    if (!res.ok) throw new Error(`\u4FDD\u5B58\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return res.json();
  }
  async function deleteHistoryRowReal(id) {
    const res = await fetch(`${NAS_BASE}/holdings/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`\u5220\u9664\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`);
    return res.json();
  }
  Object.assign(dataService, { getHistoryRowsReal, updateHistoryRowReal, deleteHistoryRowReal });

  // App.jsx
  var PAGES = [
    ["overview", "\u603B\u89C8"],
    ["chart", "\u8D70\u52BF\u5206\u6790"],
    ["import", "\u6570\u636E\u5F55\u5165"],
    ["confirm", "\u5F85\u786E\u8BA4"],
    ["history", "\u5386\u53F2\u7EF4\u62A4"],
    ["bookkeeping", "\u8BB0\u8D26"]
  ];
  function ThemeToggle() {
    const [theme, setTheme] = (0, import_react.useState)(() => localStorage.getItem("theme") || "auto");
    (0, import_react.useEffect)(() => {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("theme", theme);
    }, [theme]);
    const OPTIONS = [["light", "\u2600\uFE0F"], ["auto", "\u{1F5A5}\uFE0F"], ["dark", "\u{1F319}"]];
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "theme-toggle" }, OPTIONS.map(([k, icon]) => /* @__PURE__ */ import_react.default.createElement("button", { key: k, className: theme === k ? "on" : "", onClick: () => setTheme(k), title: k === "light" ? "\u660E\u4EAE" : k === "dark" ? "\u9ED1\u6697" : "\u8DDF\u968F\u7CFB\u7EDF" }, icon)));
  }
  function App() {
    const [page, setPage] = (0, import_react.useState)("overview");
    const [store, setStore] = (0, import_react.useState)(null);
    (0, import_react.useEffect)(() => {
      (async () => {
        const [products, cash, latest] = await Promise.all([
          dataService.getProducts(),
          dataService.getCash(),
          dataService.getLatestReal()
        ]);
        const market = { sp500Drawdown: 2.1, nikkeiDrawdown: 4.5 };
        setStore({ products, cash, latest, market });
      })();
    }, []);
    (0, import_react.useEffect)(() => {
      const handler = (e) => setPage(e.detail);
      document.addEventListener("go-page", handler);
      return () => document.removeEventListener("go-page", handler);
    }, []);
    return /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "topbar" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "brand" }, "\u8D44\u4EA7\u7BA1\u7406\u53F0", /* @__PURE__ */ import_react.default.createElement("span", { className: "tag" }, "v20260711-112347")), /* @__PURE__ */ import_react.default.createElement("span", { className: "env" }, "\u6570\u636E\u5C42\u5DF2\u5C31\u4F4D \xB7 \u73B0\u63A5\u5047\u6570\u636E \xB7 \u540E\u7AEF\u5C31\u7EEA\u5373\u5207\u6362"), /* @__PURE__ */ import_react.default.createElement(ThemeToggle, null), /* @__PURE__ */ import_react.default.createElement(AmountModeToggle, null)), /* @__PURE__ */ import_react.default.createElement("div", { className: "nav" }, PAGES.map(([id, label]) => /* @__PURE__ */ import_react.default.createElement("button", { key: id, className: page === id ? "active" : "", onClick: () => setPage(id) }, label))), /* @__PURE__ */ import_react.default.createElement("div", { className: "page active" }, page === "overview" && (window.OverviewPage ? import_react.default.createElement(window.OverviewPage, { store }) : /* @__PURE__ */ import_react.default.createElement("div", { className: "empty" }, "\u52A0\u8F7D\u4E2D\u2026")), page === "chart" && (window.ChartPage ? import_react.default.createElement(window.ChartPage, { store }) : /* @__PURE__ */ import_react.default.createElement("div", { className: "empty" }, "\u52A0\u8F7D\u4E2D\u2026")), page === "import" && (window.ImportPage ? import_react.default.createElement(window.ImportPage) : /* @__PURE__ */ import_react.default.createElement("div", { className: "empty" }, "\u52A0\u8F7D\u4E2D\u2026")), page === "confirm" && (window.ConfirmPage ? import_react.default.createElement(window.ConfirmPage) : /* @__PURE__ */ import_react.default.createElement("div", { className: "empty" }, "\u52A0\u8F7D\u4E2D\u2026")), page === "history" && (window.HistoryPage ? import_react.default.createElement(window.HistoryPage) : /* @__PURE__ */ import_react.default.createElement("div", { className: "empty" }, "\u52A0\u8F7D\u4E2D\u2026")), page === "bookkeeping" && (window.BookkeepingPage ? import_react.default.createElement(window.BookkeepingPage) : /* @__PURE__ */ import_react.default.createElement("div", { className: "empty" }, "\u8BB0\u8D26\u6A21\u5757\u52A0\u8F7D\u4E2D\u2026\u5982\u679C\u4E00\u76F4\u5361\u5728\u8FD9\uFF0C\u68C0\u67E5 bookkeeping.js \u662F\u5426\u4E5F\u90E8\u7F72\u4E86"))));
  }

  // shared.jsx
  var shared_exports = {};
  __export(shared_exports, {
    AccountTag: () => AccountTag,
    Card: () => Card,
    EditableValue: () => EditableValue,
    GainText: () => GainText,
    Loading: () => Loading,
    Stat: () => Stat,
    acctColor: () => acctColor,
    pct: () => pct,
    yen: () => yen
  });
  var import_react2 = __toESM(__require("react"));
  function getAmountMode() {
    try {
      return localStorage.getItem("amountMode") || "exact";
    } catch (e) {
      return "exact";
    }
  }
  function setAmountMode(m) {
    try {
      localStorage.setItem("amountMode", m);
    } catch (e) {
    }
  }
  function AmountModeToggle() {
    const [mode, setMode2] = import_react2.default.useState(getAmountMode());
    const change = (m) => {
      setAmountMode(m);
      setMode2(m);
      window.location.reload();
    };
    const btnStyle = (active) => ({
      background: active ? "var(--gold)" : "transparent",
      color: active ? "#0B0F14" : "var(--text)",
      border: "none",
      borderRadius: 16,
      padding: "5px 9px",
      fontSize: 13,
      fontWeight: active ? 700 : 600,
      cursor: "pointer",
      opacity: 1
    });
    return /* @__PURE__ */ import_react2.default.createElement("div", { className: "theme-toggle", title: "\u91D1\u989D\u663E\u793A\u65B9\u5F0F" }, /* @__PURE__ */ import_react2.default.createElement("button", { style: btnStyle(mode === "exact"), onClick: () => change("exact") }, "\u7CBE\u786E"), /* @__PURE__ */ import_react2.default.createElement("button", { style: btnStyle(mode === "wan"), onClick: () => change("wan") }, "\u4E07"), /* @__PURE__ */ import_react2.default.createElement("button", { style: btnStyle(mode === "raw"), onClick: () => change("raw") }, "\u539F\u59CB"));
  }
  var yen = (n) => {
    if (n == null || isNaN(n)) return "\xA50";
    const r = Math.round(n);
    const sign = r < 0 ? "-" : "";
    const abs = Math.abs(r);
    const mode = getAmountMode();
    if (mode === "raw") return sign + "\xA5" + abs.toLocaleString("en-US");
    if (abs < 10000) return sign + "\xA5" + abs;
    if (mode === "wan") {
      if (abs < 1e8) {
        const wan2 = (abs / 1e4).toFixed(2).replace(/\.?0+$/, "");
        return sign + "\xA5" + wan2 + "\u4E07";
      }
      const yi2 = (abs / 1e8).toFixed(2).replace(/\.?0+$/, "");
      return sign + "\xA5" + yi2 + "\u4EBF";
    }
    const groupCN = (v) => {
      const qian = Math.floor(v / 1000);
      const bai = Math.floor(v % 1000 / 100);
      const rest = v % 100;
      let s = "";
      if (qian > 0) s += qian + "\u5343";
      if (bai > 0) s += bai + "\u767E";
      if (rest > 0) s += rest;
      return s;
    };
    const yi = Math.floor(abs / 1e8);
    const afterYi = abs % 1e8;
    const wan = Math.floor(afterYi / 1e4);
    const last4 = afterYi % 1e4;
    let out = sign + "\xA5";
    if (yi > 0) out += yi + "\u4EBF";
    if (wan > 0) out += groupCN(wan) + "\u4E07";
    if (last4 > 0) out += last4;
    return out;
  };
  var pct = (n, d = 1) => n == null || isNaN(n) ? "\u2014" : (n >= 0 ? "+" : "") + n.toFixed(d) + "%";
  var acctColor = (a) => a && a.startsWith("NISA") ? "var(--blue)" : a === "\u7279\u5B9A" ? "var(--teal)" : "var(--text-3)";
  function AccountTag({ account }) {
    const c = acctColor(account);
    return /* @__PURE__ */ import_react2.default.createElement("span", { className: "acct-tag", style: { borderColor: c, color: c } }, account);
  }
  function Card({ title, idx, children, style }) {
    return /* @__PURE__ */ import_react2.default.createElement("div", { className: "card", style }, title && /* @__PURE__ */ import_react2.default.createElement("div", { className: "card-title" }, idx && /* @__PURE__ */ import_react2.default.createElement("span", { className: "idx" }, idx), title), children);
  }
  function Stat({ label, value, sub, subClass }) {
    return /* @__PURE__ */ import_react2.default.createElement("div", { className: "stat" }, /* @__PURE__ */ import_react2.default.createElement("div", { className: "lbl" }, label), /* @__PURE__ */ import_react2.default.createElement("div", { className: "val" }, value), sub != null && /* @__PURE__ */ import_react2.default.createElement("div", { className: `chg ${subClass || ""}` }, sub));
  }
  function GainText({ gain }) {
    const cls = gain > 0 ? "up" : gain < 0 ? "down" : "";
    return /* @__PURE__ */ import_react2.default.createElement("span", { className: cls }, gain >= 0 ? "+" : "", yen(gain));
  }
  function Loading() {
    return /* @__PURE__ */ import_react2.default.createElement("div", { className: "empty" }, "\u52A0\u8F7D\u4E2D\u2026");
  }
  function EditableValue({ value, onSave }) {
    const [editing, setEditing] = (0, import_react2.useState)(false);
    const [draft, setDraft] = (0, import_react2.useState)(value);
    const ref = import_react2.default.useRef(null);
    (0, import_react2.useEffect)(() => {
      if (editing && ref.current) {
        ref.current.focus();
        ref.current.select();
      }
    }, [editing]);
    const commit = () => {
      const n = parseFloat(draft);
      if (!isNaN(n) && n !== value) onSave(n);
      setEditing(false);
    };
    if (editing) {
      return /* @__PURE__ */ import_react2.default.createElement(
        "input",
        {
          ref,
          type: "number",
          className: "inline-edit",
          value: draft,
          onChange: (e) => setDraft(e.target.value),
          onBlur: commit,
          onKeyDown: (e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(value);
              setEditing(false);
            }
          }
        }
      );
    }
    return /* @__PURE__ */ import_react2.default.createElement(
      "span",
      {
        className: "editable-num",
        title: "\u53CC\u51FB\u7F16\u8F91\uFF0C\u79BB\u5F00\u5149\u6807\u5373\u4FDD\u5B58",
        onDoubleClick: () => {
          setDraft(value);
          setEditing(true);
        }
      },
      yen(value)
    );
  }

  // entry.jsx
  window.__core = { dataService, shared: shared_exports };
  var ErrorBoundary = class extends import_react3.default.Component {
    constructor(props) {
      super(props);
      this.state = { error: null };
    }
    static getDerivedStateFromError(error) {
      return { error };
    }
    componentDidCatch(error, info) {
      console.error("\u9875\u9762\u8FD0\u884C\u51FA\u9519:", error, info);
    }
    render() {
      if (this.state.error) {
        return import_react3.default.createElement(
          "div",
          {
            style: {
              maxWidth: 600,
              margin: "40px auto",
              padding: 20,
              color: "#F5F7FA",
              fontFamily: "sans-serif",
              background: "#151C26",
              border: "1px solid #33404F",
              borderRadius: 8,
              lineHeight: 1.7
            }
          },
          "\u9875\u9762\u67D0\u5904\u8FD0\u884C\u51FA\u9519\u4E86\uFF1A",
          import_react3.default.createElement("code", { style: { color: "#E0A94B" } }, this.state.error.message || String(this.state.error)),
          import_react3.default.createElement("br"),
          import_react3.default.createElement("br"),
          import_react3.default.createElement("button", {
            onClick: () => window.location.reload(),
            style: { background: "#E0A94B", color: "#0B0F14", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer" }
          }, "\u91CD\u65B0\u52A0\u8F7D\u9875\u9762"),
          import_react3.default.createElement(
            "div",
            { style: { fontSize: 12, color: "#8996A4", marginTop: 10 } },
            "\u628A\u4E0A\u9762\u8FD9\u884C\u62A5\u9519\u53D1\u7ED9\u5F00\u53D1\u8005\u5373\u53EF\u5B9A\u4F4D\u3002"
          )
        );
      }
      return this.props.children;
    }
  };
  (0, import_client.createRoot)(document.getElementById("root")).render(
    import_react3.default.createElement(ErrorBoundary, null, import_react3.default.createElement(App))
  );
})();

} catch(e) { console.error('app.js 加载出错:', e); document.getElementById('root').innerHTML = '启动出错：' + (e && e.message ? e.message : e); }
