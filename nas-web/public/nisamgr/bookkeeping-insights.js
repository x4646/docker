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
  // bookkeeping-insights.js
  var import_react13 = __toESM(__require("react"));
  var import_react14 = __toESM(__require("react"));
  var import_react15 = __toESM(__require("react"));
  var import_react17 = __toESM(__require("react"));
  var import_shared15 = __require("../shared.jsx");
  var import_shared17 = __require("../shared.jsx");
  var import_shared18 = __require("../shared.jsx");
  var import_dataService11 = __require("../dataService.js");
  var import_dataService12 = __require("../dataService.js");
  var import_dataService13 = __require("../dataService.js");
  var import_dataService15 = __require("../dataService.js");

  const { PieChart } = window.__bk;

  function ChartsTab({ refreshKey }) {
    const [summary, setSummary] = (0, import_react13.useState)(null);
    (0, import_react13.useEffect)(() => {
      import_dataService11.dataService.getTransactionSummary().then(setSummary);
    }, [refreshKey]);
    if (!summary) return /* @__PURE__ */ import_react13.default.createElement(import_shared15.Loading, null);
    const expenseData = summary.by_category.filter((c) => c.type === "expense").sort((a, b) => b.total - a.total);
    const incomeData = summary.by_category.filter((c) => c.type === "income").sort((a, b) => b.total - a.total);
    return /* @__PURE__ */ import_react13.default.createElement("div", null, /* @__PURE__ */ import_react13.default.createElement("div", { className: "holding-group-label" }, "\u652F\u51FA\u6784\u6210"), /* @__PURE__ */ import_react13.default.createElement(PieChart, { data: expenseData }), /* @__PURE__ */ import_react13.default.createElement("div", { className: "holding-group-label", style: { marginTop: 24 } }, "\u6536\u5165\u6784\u6210"), /* @__PURE__ */ import_react13.default.createElement(PieChart, { data: incomeData }));
  }

  function ProjectionTab() {
    const [currentWorth, setCurrentWorth] = (0, import_react14.useState)("");
    const [months, setMonths] = (0, import_react14.useState)(12);
    const [proj, setProj] = (0, import_react14.useState)(null);
    const [error, setError] = (0, import_react14.useState)("");
    const [busy, setBusy] = (0, import_react14.useState)(false);
    (0, import_react14.useEffect)(() => {
      (async () => {
        try {
          const [cash, latest, bookAccs] = await Promise.all([import_dataService12.dataService.getCash(), import_dataService12.dataService.getLatestReal(), import_dataService12.dataService.getAccounts()]);
          const cashTotal = (cash.moneyFund || 0) + (cash.checking || 0) + (cash.brokerageCash || 0) + (cash.deposits || 0);
          const holdingsTotal = latest.reduce((s, r) => s + (r.value || 0), 0);
          const bookTotal = bookAccs.reduce((s, a) => s + (a.balance || 0), 0);
          setCurrentWorth(String(cashTotal + holdingsTotal + bookTotal));
        } catch (e) {
        }
      })();
    }, []);
    const run = async () => {
      if (!currentWorth) return;
      setBusy(true);
      setError("");
      try {
        const r = await import_dataService12.dataService.getFutureProjection(parseInt(currentWorth, 10), months);
        setProj(r);
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ import_react14.default.createElement("div", null, /* @__PURE__ */ import_react14.default.createElement("div", { className: "note-banner" }, "\u5F53\u524D\u603B\u8D44\u4EA7=\u8D44\u4EA7\u6A21\u5757\uFF08\u73B0\u91D1+\u6301\u4ED3\uFF09+ \u8BB0\u8D26\u91CC\u5404\u8D26\u6237\u4F59\u989D\u3002\u7528\u6700\u8FD1\u51E0\u4E2A\u6708\u771F\u5B9E\u5E73\u5747\u51C0\u7ED3\u4F59\u63A8\u7B97\u672A\u6765\uFF0C\u4E0D\u542B\u6295\u8D44\u589E\u503C\uFF0C\u4EC5\u4F9B\u53C2\u8003\u3002"), /* @__PURE__ */ import_react14.default.createElement("div", { className: "field" }, /* @__PURE__ */ import_react14.default.createElement("label", null, "\u5F53\u524D\u603B\u8D44\u4EA7\uFF08\u5186\uFF0C\u5DF2\u81EA\u52A8\u5E26\u51FA\uFF0C\u53EF\u624B\u6539\uFF09"), /* @__PURE__ */ import_react14.default.createElement("input", { type: "number", value: currentWorth, onChange: (e) => setCurrentWorth(e.target.value) })), /* @__PURE__ */ import_react14.default.createElement("div", { className: "field", style: { maxWidth: 200 } }, /* @__PURE__ */ import_react14.default.createElement("label", null, "\u63A8\u7B97\u591A\u5C11\u4E2A\u6708"), /* @__PURE__ */ import_react14.default.createElement("select", { value: months, onChange: (e) => setMonths(parseInt(e.target.value, 10)) }, /* @__PURE__ */ import_react14.default.createElement("option", { value: 6 }, "6\u4E2A\u6708"), /* @__PURE__ */ import_react14.default.createElement("option", { value: 12 }, "12\u4E2A\u6708"), /* @__PURE__ */ import_react14.default.createElement("option", { value: 24 }, "24\u4E2A\u6708"), /* @__PURE__ */ import_react14.default.createElement("option", { value: 60 }, "5\u5E74"))), error && /* @__PURE__ */ import_react14.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react14.default.createElement("button", { className: "btn", disabled: busy || !currentWorth, onClick: run }, busy ? "\u8BA1\u7B97\u4E2D\u2026" : "\u5F00\u59CB\u63A8\u7B97"), proj && /* @__PURE__ */ import_react14.default.createElement("div", { style: { marginTop: 16 } }, /* @__PURE__ */ import_react14.default.createElement("div", { className: "proj-summary" }, "\u57FA\u4E8E\u6700\u8FD1 ", proj.based_on_months, " \u4E2A\u6708\u6570\u636E\uFF0C\u6708\u5747\u51C0\u7ED3\u4F59 ", /* @__PURE__ */ import_react14.default.createElement("b", { className: proj.avg_monthly_net >= 0 ? "v-down" : "v-up" }, (0, import_shared17.yen)(proj.avg_monthly_net)), "\u3002", months, "\u4E2A\u6708\u540E\u9884\u8BA1\u603B\u8D44\u4EA7\u7EA6 ", /* @__PURE__ */ import_react14.default.createElement("b", null, (0, import_shared17.yen)(proj.series[proj.series.length - 1].projected_worth)), "\u3002"), /* @__PURE__ */ import_react14.default.createElement("table", { style: { marginTop: 10 } }, /* @__PURE__ */ import_react14.default.createElement("thead", null, /* @__PURE__ */ import_react14.default.createElement("tr", null, /* @__PURE__ */ import_react14.default.createElement("th", null, "\u6708\u4EFD"), /* @__PURE__ */ import_react14.default.createElement("th", { style: { textAlign: "right" } }, "\u9884\u8BA1\u603B\u8D44\u4EA7"))), /* @__PURE__ */ import_react14.default.createElement("tbody", null, proj.series.filter((_, i) => i % Math.max(1, Math.floor(proj.series.length / 12)) === 0).map((s) => /* @__PURE__ */ import_react14.default.createElement("tr", { key: s.month }, /* @__PURE__ */ import_react14.default.createElement("td", { "data-label": "\u6708\u4EFD" }, s.month), /* @__PURE__ */ import_react14.default.createElement("td", { "data-label": "\u9884\u8BA1\u603B\u8D44\u4EA7", className: "num" }, (0, import_shared17.yen)(s.projected_worth))))))));
  }

  function MonthlyCompareTab() {
    const [months, setMonths] = (0, import_react15.useState)(null);
    const [n, setN] = (0, import_react15.useState)(6);
    const [error, setError] = (0, import_react15.useState)("");
    const load = () => import_dataService13.dataService.getMonthlySummary(n).then(setMonths).catch((e) => setError(e.message));
    (0, import_react15.useEffect)(() => {
      load();
    }, [n]);
    if (error) return /* @__PURE__ */ import_react15.default.createElement("div", { className: "empty" }, error);
    if (!months) return /* @__PURE__ */ import_react15.default.createElement(import_shared18.Loading, null);
    const maxAbs = Math.max(1, ...months.map((m) => Math.max(m.income, m.expense)));
    return /* @__PURE__ */ import_react15.default.createElement("div", null, /* @__PURE__ */ import_react15.default.createElement("div", { className: "field", style: { maxWidth: 160 } }, /* @__PURE__ */ import_react15.default.createElement("label", null, "\u770B\u6700\u8FD1\u51E0\u4E2A\u6708"), /* @__PURE__ */ import_react15.default.createElement("select", { value: n, onChange: (e) => setN(parseInt(e.target.value, 10)) }, /* @__PURE__ */ import_react15.default.createElement("option", { value: 3 }, "3\u4E2A\u6708"), /* @__PURE__ */ import_react15.default.createElement("option", { value: 6 }, "6\u4E2A\u6708"), /* @__PURE__ */ import_react15.default.createElement("option", { value: 12 }, "12\u4E2A\u6708"))), months.length === 0 && /* @__PURE__ */ import_react15.default.createElement("div", { className: "empty" }, "\u8FD8\u6CA1\u6709\u6570\u636E"), months.map((m, i) => {
      const prev = months[i - 1];
      const diff = prev ? m.net - prev.net : null;
      return /* @__PURE__ */ import_react15.default.createElement("div", { key: m.month, className: "month-compare-row" }, /* @__PURE__ */ import_react15.default.createElement("div", { className: "month-compare-label" }, m.month, diff != null && /* @__PURE__ */ import_react15.default.createElement("span", { className: diff >= 0 ? "v-down" : "v-up", style: { fontSize: 11, marginLeft: 8 } }, diff >= 0 ? "\u25B2" : "\u25BC", " \u8F83\u4E0A\u6708", diff >= 0 ? "\u591A\u7ED3\u4F59" : "\u5C11\u7ED3\u4F59", " ", (0, import_shared18.yen)(Math.abs(diff)))), /* @__PURE__ */ import_react15.default.createElement("div", { className: "month-compare-bars" }, /* @__PURE__ */ import_react15.default.createElement("div", { className: "month-compare-bar-row" }, /* @__PURE__ */ import_react15.default.createElement("span", { className: "month-compare-bar-tag v-down" }, "\u6536"), /* @__PURE__ */ import_react15.default.createElement("div", { className: "month-compare-bar-track" }, /* @__PURE__ */ import_react15.default.createElement("div", { className: "month-compare-bar-fill income", style: { width: `${m.income / maxAbs * 100}%` } })), /* @__PURE__ */ import_react15.default.createElement("span", { className: "month-compare-bar-value" }, (0, import_shared18.yen)(m.income))), /* @__PURE__ */ import_react15.default.createElement("div", { className: "month-compare-bar-row" }, /* @__PURE__ */ import_react15.default.createElement("span", { className: "month-compare-bar-tag v-up" }, "\u652F"), /* @__PURE__ */ import_react15.default.createElement("div", { className: "month-compare-bar-track" }, /* @__PURE__ */ import_react15.default.createElement("div", { className: "month-compare-bar-fill expense", style: { width: `${m.expense / maxAbs * 100}%` } })), /* @__PURE__ */ import_react15.default.createElement("span", { className: "month-compare-bar-value" }, (0, import_shared18.yen)(m.expense)))), /* @__PURE__ */ import_react15.default.createElement("div", { className: `month-compare-net ${m.net >= 0 ? "v-down" : "v-up"}` }, "\u7ED3\u4F59 ", (0, import_shared18.yen)(m.net)));
    }));
  }

  function BackupTab() {
    const [exporting, setExporting] = (0, import_react17.useState)(false);
    const [importing, setImporting] = (0, import_react17.useState)(false);
    const [exportMsg, setExportMsg] = (0, import_react17.useState)("");
    const [importResult, setImportResult] = (0, import_react17.useState)(null);
    const [error, setError] = (0, import_react17.useState)("");
    const [confirmStep, setConfirmStep] = (0, import_react17.useState)(false);
    const [pendingFile, setPendingFile] = (0, import_react17.useState)(null);
    const fileRef = (0, import_react17.useRef)(null);
    const doExport = async () => {
      setExporting(true);
      setError("");
      setExportMsg("");
      try {
        const backup = await import_dataService15.dataService.exportBackup();
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `asset-backup-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        const tableCounts = Object.entries(backup.tables).map(([k, v]) => `${k}:${v.length}`).join("\uFF0C");
        setExportMsg(`\u2713 \u5DF2\u5BFC\u51FA\uFF08${backup.exported_at}\uFF09\u2014 ${tableCounts}`);
      } catch (e) {
        setError(e.message);
      } finally {
        setExporting(false);
      }
    };
    const pickFile = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setPendingFile(file);
      setConfirmStep(true);
    };
    const doImport = async () => {
      if (!pendingFile) return;
      setImporting(true);
      setError("");
      setImportResult(null);
      try {
        const text = await pendingFile.text();
        const backupData = JSON.parse(text);
        const r = await import_dataService15.dataService.importBackup(backupData);
        setImportResult(r);
        setConfirmStep(false);
        setPendingFile(null);
        if (fileRef.current) fileRef.current.value = "";
      } catch (e) {
        setError(e.message);
      } finally {
        setImporting(false);
      }
    };
    const cancelImport = () => {
      setConfirmStep(false);
      setPendingFile(null);
      if (fileRef.current) fileRef.current.value = "";
    };
    return /* @__PURE__ */ import_react17.default.createElement("div", null, /* @__PURE__ */ import_react17.default.createElement("div", { className: "note-banner" }, '\u5907\u4EFD\u7684\u662F\u5168\u90E8\u6570\u636E\u2014\u2014\u8D44\u4EA7\u6A21\u5757\uFF08\u6301\u4ED3/\u73B0\u91D1/\u4EA7\u54C1\u767D\u540D\u5355\uFF09+ \u8BB0\u8D26\u6A21\u5757\uFF08\u5206\u7C7B/\u8D26\u6237/\u4EA4\u6613/\u9884\u7B97\u7B49\uFF09\u6253\u5305\u6210\u4E00\u4E2A JSON \u6587\u4EF6\u3002 \u5BFC\u5165\u662F"\u6574\u8868\u66FF\u6362"\uFF0C\u4E0D\u662F\u5408\u5E76\uFF1A\u5BFC\u5165\u54EA\u5F20\u8868\uFF0C\u90A3\u5F20\u8868\u5F53\u524D\u7684\u6570\u636E\u4F1A\u88AB\u5907\u4EFD\u6587\u4EF6\u91CC\u7684\u5185\u5BB9\u6574\u4E2A\u8986\u76D6\uFF0C\u52A1\u5FC5\u5148\u786E\u8BA4\u8FD9\u662F\u4F60\u60F3\u8981\u7684\u5907\u4EFD\u6587\u4EF6\u518D\u5BFC\u5165\u3002'), /* @__PURE__ */ import_react17.default.createElement("div", { className: "holding-group-label" }, "\u5BFC\u51FA"), error && /* @__PURE__ */ import_react17.default.createElement("div", { className: "extract-status extract-error" }, error), /* @__PURE__ */ import_react17.default.createElement("button", { className: "btn", disabled: exporting, onClick: doExport }, exporting ? "\u5BFC\u51FA\u4E2D\u2026" : "\u{1F4E5} \u5BFC\u51FA\u5168\u90E8\u6570\u636E"), exportMsg && /* @__PURE__ */ import_react17.default.createElement("div", { className: "result-banner good", style: { marginTop: 10, fontSize: 11 } }, exportMsg), /* @__PURE__ */ import_react17.default.createElement("div", { className: "holding-group-label", style: { marginTop: 24 } }, "\u5BFC\u5165\u6062\u590D"), !confirmStep ? /* @__PURE__ */ import_react17.default.createElement("div", null, /* @__PURE__ */ import_react17.default.createElement("input", { ref: fileRef, type: "file", accept: "application/json", onChange: pickFile, style: { fontSize: 12 } })) : /* @__PURE__ */ import_react17.default.createElement("div", { className: "card", style: { background: "var(--panel-2)" } }, /* @__PURE__ */ import_react17.default.createElement("div", { style: { color: "var(--up)", fontWeight: 700, fontSize: 13, marginBottom: 8 } }, "\u26A0 \u786E\u8BA4\u8981\u5BFC\u5165\u5417\uFF1F"), /* @__PURE__ */ import_react17.default.createElement("div", { style: { fontSize: 12, color: "var(--text-2)", marginBottom: 12, lineHeight: 1.6 } }, "\u6587\u4EF6\uFF1A", pendingFile && pendingFile.name, /* @__PURE__ */ import_react17.default.createElement("br", null), "\u8FD9\u4F1A\u628A\u5907\u4EFD\u6587\u4EF6\u91CC\u6709\u7684\u6BCF\u4E00\u5F20\u8868\uFF0C\u6574\u4E2A\u8986\u76D6\u6389\u73B0\u5728\u6570\u636E\u5E93\u91CC\u5BF9\u5E94\u7684\u8868\u2014\u2014\u73B0\u5728\u7684\u6570\u636E\u4F1A\u88AB\u66FF\u6362\u6389\uFF0C\u8FD9\u4E00\u6B65\u505A\u5B8C\u64A4\u9500\u4E0D\u4E86\u3002"), /* @__PURE__ */ import_react17.default.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ import_react17.default.createElement("button", { className: "btn sm", style: { background: "var(--up)" }, disabled: importing, onClick: doImport }, importing ? "\u5BFC\u5165\u4E2D\u2026" : "\u786E\u8BA4\u8986\u76D6\u5BFC\u5165"), /* @__PURE__ */ import_react17.default.createElement("button", { className: "btn ghost sm", onClick: cancelImport }, "\u53D6\u6D88"))), importResult && /* @__PURE__ */ import_react17.default.createElement("div", { className: "result-banner good", style: { marginTop: 10, fontSize: 11 } }, "\u2713 \u5BFC\u5165\u5B8C\u6210 \u2014 ", Object.entries(importResult.restored).map(([k, v]) => `${k}:${v}`).join("\uFF0C"), importResult.products_restored && "\uFF0C\u4EA7\u54C1\u767D\u540D\u5355\u5DF2\u6062\u590D"));
  }

  window.__bk = window.__bk || {};
  Object.assign(window.__bk, { BackupTab, ChartsTab, MonthlyCompareTab, ProjectionTab });
})();

} catch(e) { console.error('bookkeeping-insights.js 加载出错:', e); }
