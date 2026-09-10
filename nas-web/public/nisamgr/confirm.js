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

  // pages/ConfirmPage.jsx
  var import_react = __toESM(__require("react"));
  var import_dataService = __require("../dataService.js");
  var import_shared = __require("../shared.jsx");
  function SourceModal({ batchId, onClose }) {
    const [data, setData] = (0, import_react.useState)(null);
    const [error, setError] = (0, import_react.useState)("");
    (0, import_react.useEffect)(() => {
      import_dataService.dataService.getPendingSource(batchId).then(setData).catch((e) => setError(e.message));
    }, [batchId]);
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-backdrop", onClick: onClose }, /* @__PURE__ */ import_react.default.createElement("div", { className: "modal-box", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ import_react.default.createElement("button", { className: "modal-close", onClick: onClose }, "\xD7"), error && /* @__PURE__ */ import_react.default.createElement("div", { className: "extract-status extract-error" }, error), !data && !error && /* @__PURE__ */ import_react.default.createElement(import_shared.Loading, null), data && data.kind === "image" && /* @__PURE__ */ import_react.default.createElement("img", { src: data.data_url, alt: "\u539F\u56FE", className: "modal-img" }), data && data.kind === "text" && /* @__PURE__ */ import_react.default.createElement("pre", { className: "modal-text" }, data.text)));
  }
  function ConfirmGroup({ group, onResolved }) {
    const [items, setItems] = (0, import_react.useState)(group.items.map((it) => ({ ...it, editValue: it.value, editAccount: it.account })));
    const [busy, setBusy] = (0, import_react.useState)(false);
    const [showSource, setShowSource] = (0, import_react.useState)(false);
    const updateItem = (id, patch) => setItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it));
    const confirmAll = async () => {
      setBusy(true);
      try {
        await import_dataService.dataService.confirmPending(items.map((it) => ({
          id: it.id,
          value: it.editValue,
          account: it.editAccount,
          product_id: it.product_id
        })));
        onResolved();
      } catch (e) {
        alert("\u786E\u8BA4\u5931\u8D25\uFF1A" + e.message);
      } finally {
        setBusy(false);
      }
    };
    const rejectAll = async () => {
      setBusy(true);
      try {
        await import_dataService.dataService.rejectPending(items.map((it) => it.id));
        onResolved();
      } catch (e) {
        alert("\u64CD\u4F5C\u5931\u8D25\uFF1A" + e.message);
      } finally {
        setBusy(false);
      }
    };
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "confirm-row" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "thumb thumb-clickable", onClick: () => setShowSource(true), title: "\u70B9\u51FB\u67E5\u770B\u539F\u59CB\u5185\u5BB9" }, group.file && group.file.match(/\.(png|jpe?g)$/i) ? "\u{1F4F7}" : "\u{1F4CB}", /* @__PURE__ */ import_react.default.createElement("br", null), group.file, group.account && /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("br", null), /* @__PURE__ */ import_react.default.createElement("span", { style: { color: "var(--text-2)" } }, group.account)), /* @__PURE__ */ import_react.default.createElement("br", null), /* @__PURE__ */ import_react.default.createElement("span", { className: "thumb-hint" }, "\u70B9\u51FB\u67E5\u770B")), showSource && /* @__PURE__ */ import_react.default.createElement(SourceModal, { batchId: group.batch_id, onClose: () => setShowSource(false) }), /* @__PURE__ */ import_react.default.createElement("div", { className: "confirm-body" }, items.map((it) => /* @__PURE__ */ import_react.default.createElement("div", { className: "confirm-item", key: it.id }, /* @__PURE__ */ import_react.default.createElement("span", { className: "pn" }, it.name, (it.account === "NISA(\u8981\u786E\u8BA4)" || !it.account) && /* @__PURE__ */ import_react.default.createElement("select", { value: it.editAccount, onChange: (e) => updateItem(it.id, { editAccount: e.target.value }), style: { marginLeft: 8 } }, !it.account && /* @__PURE__ */ import_react.default.createElement("option", { value: "" }, "(\u7A7A\uFF0C\u8BF7\u9009)"), import_dataService.dataService.ACCOUNTS.filter((a) => a !== "NISA(\u8981\u786E\u8BA4)").map((a) => /* @__PURE__ */ import_react.default.createElement("option", { key: a, value: a }, a))), it.account && it.account !== "NISA(\u8981\u786E\u8BA4)" && /* @__PURE__ */ import_react.default.createElement("span", { style: { marginLeft: 8 } }, /* @__PURE__ */ import_react.default.createElement(import_shared.AccountTag, { account: it.editAccount }))), /* @__PURE__ */ import_react.default.createElement("input", { type: "number", value: it.editValue, onChange: (e) => updateItem(it.id, { editValue: parseInt(e.target.value, 10) || 0 }) }), it.confidence < 0.7 && /* @__PURE__ */ import_react.default.createElement("span", { className: "pill pending" }, "\u7591\u4F3C"))), items.some((i) => i.confidence < 0.7) && /* @__PURE__ */ import_react.default.createElement("div", { className: "warn" }, "\u26A0 \u6709\u8BC6\u522B\u503C\u7F6E\u4FE1\u5EA6\u504F\u4F4E\uFF0C\u6838\u5BF9\u540E\u518D\u786E\u8BA4"), items.some((i) => i.account === "NISA(\u8981\u786E\u8BA4)") && /* @__PURE__ */ import_react.default.createElement("div", { className: "warn" }, "\u26A0 \u6709\u6761\u76EE\u8D26\u6237\u8BFB\u4E0D\u51C6\uFF08NISA\u6210\u9577/\u3064\u307F\u305F\u3066\u6CA1\u5206\u6E05\uFF09\uFF0C\u5DF2\u5C55\u5F00\u4E0B\u62C9\u6846\uFF0C\u9009\u5BF9\u518D\u786E\u8BA4"), /* @__PURE__ */ import_react.default.createElement("div", { className: "confirm-actions" }, /* @__PURE__ */ import_react.default.createElement("button", { className: "btn sm", disabled: busy, onClick: confirmAll }, "\u786E\u8BA4\u5E76\u5165\u5E93"), /* @__PURE__ */ import_react.default.createElement("button", { className: "btn ghost sm", disabled: busy, onClick: rejectAll }, "\u8DF3\u8FC7\uFF08\u62D2\u7EDD\uFF09"))));
  }
  function ConfirmPage() {
    const [pending, setPending] = (0, import_react.useState)(null);
    const [error, setError] = (0, import_react.useState)("");
    const load = () => {
      import_dataService.dataService.getPendingReal().then((r) => setPending(r.groups)).catch((e) => setError(e.message));
    };
    (0, import_react.useEffect)(() => {
      load();
    }, []);
    if (error) return /* @__PURE__ */ import_react.default.createElement("div", { className: "empty" }, "\u8FDE\u4E0D\u4E0A\u5F85\u786E\u8BA4\u961F\u5217\uFF1A", error);
    if (!pending) return /* @__PURE__ */ import_react.default.createElement(import_shared.Loading, null);
    return /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("h2", { className: "page-title" }, "\u5F85\u786E\u8BA4\u961F\u5217"), /* @__PURE__ */ import_react.default.createElement("div", { className: "page-sub" }, "\u8BC6\u522B/\u7C98\u8D34\u7684\u7ED3\u679C\u5148\u5728\u8FD9\uFF0C\u6838\u5BF9/\u4FEE\u6B63\u540E\u70B9\u786E\u8BA4\u624D\u6B63\u5F0F\u751F\u6548\uFF08\u8FDB\u6298\u7EBF\u3001\u7B97\u603B\u8D44\u4EA7\uFF09"), /* @__PURE__ */ import_react.default.createElement(import_shared.Card, { title: `\u5F85\u5904\u7406\uFF08${pending.length} \u6279\uFF09`, idx: "\u6838\u5BF9" }, pending.length ? pending.map((g) => /* @__PURE__ */ import_react.default.createElement(ConfirmGroup, { key: g.batch_id, group: g, onResolved: load })) : /* @__PURE__ */ import_react.default.createElement("div", { className: "empty" }, "\u5F85\u786E\u8BA4\u961F\u5217\u5DF2\u6E05\u7A7A \u2713", /* @__PURE__ */ import_react.default.createElement("br", null), "\u6240\u6709\u6570\u636E\u90FD\u5DF2\u6838\u5BF9\u5165\u5E93")));
  }
  window.ConfirmPage = ConfirmPage;
})();

} catch(e) { console.error('confirm.js 加载出错:', e);  }
