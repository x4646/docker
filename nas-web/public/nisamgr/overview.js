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

  // pages/OverviewPage.jsx
  var import_react = __toESM(__require("react"));
  var import_shared = __require("../shared.jsx");
  function SourceNumber({ className, value, lines, big }) {
    const [open, setOpen] = (0, import_react.useState)(false);
    return /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        className,
        onDoubleClick: () => setOpen((o) => !o),
        style: { cursor: "pointer" },
        title: "\u53CC\u51FB\u67E5\u770B\u6784\u6210"
      },
      value,
      !big && /* @__PURE__ */ import_react.default.createElement("span", { className: "dbl-hint" }, " \u24D8")
    ), big && /* @__PURE__ */ import_react.default.createElement("div", { className: "hero-dblhint" }, "\u53CC\u51FB\u91D1\u989D\u67E5\u770B\u6784\u6210"), open && /* @__PURE__ */ import_react.default.createElement("div", { className: "source-box" }, lines.map((l, i) => /* @__PURE__ */ import_react.default.createElement("div", { key: i, className: "source-line" }, l))));
  }
  function BullBear({ market }) {
    const [mode, setMode] = (0, import_react.useState)("auto");
    const [manual, setManual] = (0, import_react.useState)("\u725B");
    const { sp500Drawdown, nikkeiDrawdown } = market;
    const deeper = Math.max(sp500Drawdown, nikkeiDrawdown);
    const autoState = deeper >= 20 ? "\u718A" : "\u725B";
    const state = mode === "manual" ? manual : autoState;
    const isBear = state === "\u718A";
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "bull" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "stamp", style: { borderColor: isBear ? "var(--up)" : "var(--down)", color: isBear ? "var(--up)" : "var(--down)" } }, state), /* @__PURE__ */ import_react.default.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "mode-switch" }, /* @__PURE__ */ import_react.default.createElement("button", { className: mode === "auto" ? "mode-btn on" : "mode-btn", onClick: () => setMode("auto") }, "\u81EA\u52A8\u5224\u5B9A"), /* @__PURE__ */ import_react.default.createElement("button", { className: mode === "manual" ? "mode-btn on" : "mode-btn", onClick: () => setMode("manual") }, "\u624B\u52A8\u6307\u5B9A")), mode === "manual" ? /* @__PURE__ */ import_react.default.createElement("div", { className: "manual-pick" }, /* @__PURE__ */ import_react.default.createElement("button", { className: manual === "\u725B" ? "pick on-bull" : "pick", onClick: () => setManual("\u725B") }, "\u725B\u5E02"), /* @__PURE__ */ import_react.default.createElement("button", { className: manual === "\u718A" ? "pick on-bear" : "pick", onClick: () => setManual("\u718A") }, "\u718A\u5E02")) : /* @__PURE__ */ import_react.default.createElement("div", { style: { fontSize: 11, color: "var(--text-3)", lineHeight: 1.6 } }, "\u5F53\u524D\u5224\u5B9A\uFF1A", /* @__PURE__ */ import_react.default.createElement("b", { style: { color: isBear ? "var(--up)" : "var(--down)" } }, state === "\u718A" ? "\u718A\u5E02" : "\u725B\u5E02"), " ", "\xB7 \u6807\u666E500\u56DE\u64A4 ", (0, import_shared.pct)(-sp500Drawdown), " / \u65E5\u7ECF ", (0, import_shared.pct)(-nikkeiDrawdown), deeper < 20 ? `\uFF08\u66F4\u6DF1 ${deeper.toFixed(1)}%\uFF0C\u672A\u8FBE20%\uFF09` : "\uFF08\u5DF2\u8FBE20%\uFF0C\u89E6\u53D1\u718A\u5E02\uFF09")));
  }
  function OverviewPage({ store }) {
    if (!store) return /* @__PURE__ */ import_react.default.createElement(import_shared.Loading, null);
    const { cash, latest, market } = store;
    const rows = latest;
    const nisaRows = rows.filter((r) => r.account && r.account.startsWith("NISA"));
    const tokRows = rows.filter((r) => r.account === "\u7279\u5B9A");
    const otherRows = rows.filter((r) => !r.account);
    const nisaValue = nisaRows.reduce((s, r) => s + r.value, 0);
    const tokValue = tokRows.reduce((s, r) => s + r.value, 0);
    const otherValue = otherRows.reduce((s, r) => s + r.value, 0);
    const liquid = cash.moneyFund + cash.checking + cash.brokerageCash;
    const total = liquid + cash.deposits + nisaValue + tokValue + otherValue;
    return /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "hero" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "eyebrow" }, "\u603B\u8D44\u4EA7\u5408\u8BA1\uFF08\u5404\u4EA7\u54C1\u6700\u65B0\u786E\u8BA4\u503C\u62FC\u603B\uFF09"), /* @__PURE__ */ import_react.default.createElement(SourceNumber, { big: true, className: "big", value: (0, import_shared.yen)(total), lines: [
      `\u8D27\u5E01\u57FA\u91D1 ${(0, import_shared.yen)(cash.moneyFund)}`,
      `\u94F6\u884C\u6D3B\u671F ${(0, import_shared.yen)(cash.checking)}`,
      `\u8BC1\u5238\u8D26\u6237\u73B0\u91D1 ${(0, import_shared.yen)(cash.brokerageCash)}`,
      `\u5B9A\u671F\u5B58\u6B3E ${(0, import_shared.yen)(cash.deposits)}`,
      `NISA \u8BC4\u4EF7\u989D\u5408\u8BA1 ${(0, import_shared.yen)(nisaValue)}`,
      `\u7279\u5B9A\u8D26\u6237 \u8BC4\u4EF7\u989D\u5408\u8BA1 ${(0, import_shared.yen)(tokValue)}`,
      ...otherValue ? [`\u8D26\u6237\u5F85\u786E\u8BA4 ${(0, import_shared.yen)(otherValue)}`] : []
    ] }), /* @__PURE__ */ import_react.default.createElement("div", { className: "sub" }, "\u6570\u636E\u6765\u81EA NAS \u771F\u5B9E\u6570\u636E\u5E93\uFF08", /* @__PURE__ */ import_react.default.createElement("span", { style: { color: "var(--gold)" } }, "\u5DF2\u786E\u8BA4"), " \u7684\u6700\u65B0\u8BB0\u5F55\uFF09")), /* @__PURE__ */ import_react.default.createElement(BullBear, { market }), /* @__PURE__ */ import_react.default.createElement("div", { className: "grid", style: { marginBottom: 14 } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "stat" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "lbl" }, "NISA \u8BC4\u4EF7\u989D"), /* @__PURE__ */ import_react.default.createElement(
      SourceNumber,
      {
        className: "val",
        value: (0, import_shared.yen)(nisaValue),
        lines: nisaRows.map((r) => `${r.name} ${(0, import_shared.yen)(r.value)}`)
      }
    )), /* @__PURE__ */ import_react.default.createElement("div", { className: "stat" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "lbl" }, "\u7279\u5B9A\u8D26\u6237 \u8BC4\u4EF7\u989D"), /* @__PURE__ */ import_react.default.createElement(
      SourceNumber,
      {
        className: "val",
        value: (0, import_shared.yen)(tokValue),
        lines: tokRows.map((r) => `${r.name} ${(0, import_shared.yen)(r.value)}`)
      }
    )), /* @__PURE__ */ import_react.default.createElement("div", { className: "stat" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "lbl" }, "\u73B0\u91D1\u6D41\u52A8\u6027"), /* @__PURE__ */ import_react.default.createElement(SourceNumber, { className: "val", value: (0, import_shared.yen)(liquid), lines: [
      `\u8D27\u5E01\u57FA\u91D1 ${(0, import_shared.yen)(cash.moneyFund)}`,
      `\u94F6\u884C\u6D3B\u671F ${(0, import_shared.yen)(cash.checking)}`,
      `\u8BC1\u5238\u8D26\u6237\u73B0\u91D1 ${(0, import_shared.yen)(cash.brokerageCash)}`
    ] })), /* @__PURE__ */ import_react.default.createElement(import_shared.Stat, { label: "\u5B9A\u671F\u5B58\u6B3E", value: (0, import_shared.yen)(cash.deposits), sub: "\u62C610\u4E07\u5355\u4F4D" })), /* @__PURE__ */ import_react.default.createElement(import_shared.Card, { title: "\u6309\u8D26\u6237\u5206\u7EC4\u6301\u4ED3", idx: "\u6301\u4ED3" }, rows.length === 0 && /* @__PURE__ */ import_react.default.createElement("div", { className: "empty" }, "\u8FD8\u6CA1\u6709\u5DF2\u786E\u8BA4\u7684\u6301\u4ED3\u6570\u636E", /* @__PURE__ */ import_react.default.createElement("br", null), /* @__PURE__ */ import_react.default.createElement("span", { style: { fontSize: 11 } }, '\u53BB"\u5F85\u786E\u8BA4"\u9875\u786E\u8BA4\u51E0\u6761\uFF0C\u6216\u7528"\u6570\u636E\u5F55\u5165"\u624B\u52A8\u586B\u51E0\u6761')), rows.length > 0 && (() => {
      const order = ["\u7279\u5B9A", "NISA\u6210\u9577", "NISA\u3064\u307F\u305F\u3066"];
      const groups = {};
      rows.forEach((r) => {
        const key = r.account || "(\u5F85\u786E\u8BA4)";
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      });
      const sortedKeys = Object.keys(groups).sort((a, b) => {
        const ia = order.indexOf(a), ib = order.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
      return sortedKeys.map((key) => {
        const groupRows = groups[key];
        const subtotal = groupRows.reduce((s, r) => s + r.value, 0);
        return /* @__PURE__ */ import_react.default.createElement("div", { key, className: "account-group" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "account-group-head" }, key === "(\u5F85\u786E\u8BA4)" ? /* @__PURE__ */ import_react.default.createElement("span", { style: { color: "var(--text-3)" } }, "(\u5F85\u786E\u8BA4\u8D26\u6237)") : /* @__PURE__ */ import_react.default.createElement(import_shared.AccountTag, { account: key }), /* @__PURE__ */ import_react.default.createElement("span", { className: "account-group-subtotal" }, (0, import_shared.yen)(subtotal))), /* @__PURE__ */ import_react.default.createElement("table", null, /* @__PURE__ */ import_react.default.createElement("tbody", null, groupRows.map((r) => /* @__PURE__ */ import_react.default.createElement("tr", { key: `${r.product_id}||${r.account}` }, /* @__PURE__ */ import_react.default.createElement("td", null, r.name), /* @__PURE__ */ import_react.default.createElement("td", { className: "num" }, (0, import_shared.yen)(r.value)))))));
      });
    })()));
  }
  window.OverviewPage = OverviewPage;
})();

} catch(e) { console.error('overview.js 加载出错:', e);  }
