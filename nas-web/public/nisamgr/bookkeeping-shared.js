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
  // bookkeeping-shared.js
  var import_react = __toESM(__require("react"));
  var import_react2 = __toESM(__require("react"));
  var import_react3 = __toESM(__require("react"));
  var import_shared = __require("../shared.jsx");
  var import_react10 = __toESM(__require("react"));
  var import_react18 = __toESM(__require("react"));
  var import_shared2 = __require("../shared.jsx");
  var import_shared3 = __require("../shared.jsx");
  var import_shared21 = __require("./shared.jsx");
  var import_dataService = __require("../dataService.js");
  var import_dataService2 = __require("../dataService.js");
  var import_dataService16 = __require("./dataService.js");

  var CHART_COLORS = ["#E0A94B", "#5B8CB8", "#4A9C6C", "#D4686C", "#9B7EDE", "#E8956B", "#6BAFA0", "#C084A8"];

  var ACCOUNT_ICON_PRESET = ["\u{1F4B5}", "\u{1F3E6}", "\u{1F4F1}", "\u{1F4B3}", "\u{1F437}", "\u{1F4B0}", "\u{1F4F2}", "\u{1F3E7}", "\u{1F4B4}", "\u{1F4B6}", "\u{1F4B7}", "\u{1FA99}", "\u{1F4FF}", "\u{1F9E7}", "\u{1F48E}", "\u{1F3DB}\uFE0F"];

  var CATEGORY_ICON_PRESET = [
    "\u{1F4C1}",
    "\u{1F37D}\uFE0F",
    "\u{1F354}",
    "\u2615",
    "\u{1F697}",
    "\u{1F695}",
    "\u{1F68C}",
    "\u26FD",
    "\u{1F3E0}",
    "\u{1F4A1}",
    "\u{1F4A7}",
    "\u{1F4DE}",
    "\u{1F4F6}",
    "\u{1F9F4}",
    "\u{1F6D2}",
    "\u{1F455}",
    "\u{1F48A}",
    "\u{1F3E5}",
    "\u{1F9B7}",
    "\u{1F6E1}\uFE0F",
    "\u{1F3AC}",
    "\u{1F3AE}",
    "\u{1F3B5}",
    "\u2708\uFE0F",
    "\u{1F3D6}\uFE0F",
    "\u{1F3A8}",
    "\u{1F4DA}",
    "\u{1F393}",
    "\u{1F9D1}\u200D\u{1F3EB}",
    "\u{1F91D}",
    "\u{1F9E7}",
    "\u{1F381}",
    "\u{1F4B8}",
    "\u{1F4BC}",
    "\u{1F4C8}",
    "\u{1F4CA}",
    "\u{1F3E6}",
    "\u{1F4B0}",
    "\u2728",
    "\u{1F43E}",
    "\u{1F476}",
    "\u{1F9F9}",
    "\u{1F527}"
  ];

  var WEEKDAYS = ["\u65E5", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D"];

  function useDragReorder(itemIds, onReorder) {
    const [order, setOrder] = (0, import_react3.useState)(itemIds);
    const orderRef = (0, import_react3.useRef)(order);
    orderRef.current = order;
    const [draggingId, setDraggingId] = (0, import_react3.useState)(null);
    const [overId, setOverId] = (0, import_react3.useState)(null);
    const [dragPos, setDragPos] = (0, import_react3.useState)(null);
    const dragIdRef = (0, import_react3.useRef)(null);
    const startPosRef = (0, import_react3.useRef)(null);
    const grabRef = (0, import_react3.useRef)(null);
    const movedRef = (0, import_react3.useRef)(false);
    const justDraggedRef = (0, import_react3.useRef)(false);
    const idSetRef = (0, import_react3.useRef)(/* @__PURE__ */ new Set());
    idSetRef.current = new Set(itemIds);
    const rectsRef = (0, import_react3.useRef)(/* @__PURE__ */ new Map());
    (0, import_react3.useEffect)(() => {
      setOrder(itemIds);
    }, [itemIds.join("|")]);
    (0, import_react3.useLayoutEffect)(() => {
      const els = document.querySelectorAll("[data-drag-id]");
      els.forEach((el) => {
        const id = el.getAttribute("data-drag-id");
        if (!idSetRef.current.has(id) || id === dragIdRef.current) return;
        const prev = rectsRef.current.get(id);
        const now = el.getBoundingClientRect();
        if (prev) {
          const dx = prev.left - now.left, dy = prev.top - now.top;
          if (dx || dy) {
            el.style.transition = "none";
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            el.getBoundingClientRect();
            el.style.transition = "transform 220ms cubic-bezier(0.2,0.8,0.2,1)";
            el.style.transform = "";
          }
        }
      });
    }, [order.join("|")]);
    (0, import_react3.useLayoutEffect)(() => {
      const els = document.querySelectorAll("[data-drag-id]");
      const map = /* @__PURE__ */ new Map();
      els.forEach((el) => {
        const id = el.getAttribute("data-drag-id");
        if (idSetRef.current.has(id)) map.set(id, el.getBoundingClientRect());
      });
      rectsRef.current = map;
    });
    const findItemUnder = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const item = el && el.closest ? el.closest("[data-drag-id]") : null;
      return item ? item.getAttribute("data-drag-id") : null;
    };
    const onPointerMove = (e) => {
      const start = startPosRef.current;
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!movedRef.current && Math.hypot(dx, dy) > 6) {
        movedRef.current = true;
        setDraggingId(dragIdRef.current);
      }
      if (!movedRef.current) return;
      e.preventDefault();
      const grab = grabRef.current;
      if (grab) {
        setDragPos({
          left: e.clientX - grab.offsetX,
          top: e.clientY - grab.offsetY,
          width: grab.width,
          height: grab.height
        });
      }
      const hoverId = findItemUnder(e.clientX, e.clientY);
      if (!hoverId) return;
      setOverId(hoverId);
      const curId = dragIdRef.current;
      if (curId == null || curId === hoverId) return;
      setOrder((prev) => {
        if (prev.indexOf(curId) === prev.indexOf(hoverId)) return prev;
        const next = prev.filter((x) => x !== curId);
        next.splice(next.indexOf(hoverId), 0, curId);
        return next;
      });
    };
    const endDrag = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", endDrag);
      document.removeEventListener("pointercancel", endDrag);
      const wasMoved = movedRef.current;
      justDraggedRef.current = wasMoved;
      setDraggingId(null);
      setOverId(null);
      setDragPos(null);
      dragIdRef.current = null;
      startPosRef.current = null;
      grabRef.current = null;
      movedRef.current = false;
      if (wasMoved) onReorder(orderRef.current);
    };
    const dragProps = (id) => ({ "data-drag-id": id });
    const handleProps = (id) => ({
      onPointerDown: (e) => {
        if (e.button != null && e.button !== 0) return;
        justDraggedRef.current = false;
        dragIdRef.current = id;
        startPosRef.current = { x: e.clientX, y: e.clientY };
        const target = e.currentTarget.closest("[data-drag-id]") || e.currentTarget;
        const rect = target.getBoundingClientRect();
        grabRef.current = { offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, width: rect.width, height: rect.height };
        movedRef.current = false;
        document.addEventListener("pointermove", onPointerMove, { passive: false });
        document.addEventListener("pointerup", endDrag);
        document.addEventListener("pointercancel", endDrag);
      }
    });
    const wasDragged = () => justDraggedRef.current;
    return { order, draggingId, overId, dragPos, dragProps, handleProps, wasDragged };
  }

  function IconGrid({ items, value, onChange, renderExtra, onReorder }) {
    const itemIds = items.map((it) => it.id);
    const { order, draggingId, overId, dragPos, dragProps, handleProps, wasDragged } = useDragReorder(itemIds, onReorder || (() => {
    }));
    const byId = Object.fromEntries(items.map((it) => [it.id, it]));
    const ordered = onReorder ? order.map((id) => byId[id]).filter(Boolean) : items;
    return /* @__PURE__ */ import_react3.default.createElement("div", { className: "icon-grid" }, ordered.map((it) => {
      const isDragging = draggingId === it.id;
      return /* @__PURE__ */ import_react3.default.createElement(
        "button",
        {
          key: it.id,
          type: "button",
          className: "icon-grid-item" + (value === it.id ? " on" : "") + (isDragging ? " dragging" : "") + (onReorder && overId === it.id && draggingId !== it.id ? " drag-over" : ""),
          style: isDragging && dragPos ? {
            position: "fixed",
            left: dragPos.left,
            top: dragPos.top,
            width: dragPos.width,
            height: dragPos.height,
            margin: 0,
            zIndex: 9999,
            pointerEvents: "none",
            transition: "none",
            opacity: 1,
            transform: "scale(1.06)",
            boxShadow: "0 8px 20px rgba(0,0,0,.25)"
          } : void 0,
          ...onReorder ? dragProps(it.id) : {},
          ...onReorder ? handleProps(it.id) : {},
          onClick: () => {
            if (!wasDragged()) onChange(it.id);
          }
        },
        /* @__PURE__ */ import_react3.default.createElement("span", { className: "icon-grid-emoji" }, it.icon),
        /* @__PURE__ */ import_react3.default.createElement("span", { className: "icon-grid-label" }, it.name),
        renderExtra && renderExtra(it)
      );
    }));
  }

  function DragList({ items, onReorder, renderItem, className }) {
    const itemIds = items.map((it) => it.id);
    const { order, draggingId, overId, dragPos, dragProps, handleProps } = useDragReorder(itemIds, onReorder);
    const byId = Object.fromEntries(items.map((it) => [it.id, it]));
    const ordered = order.map((id) => byId[id]).filter(Boolean);
    return ordered.map((item) => {
      const isDragging = draggingId === item.id;
      return /* @__PURE__ */ import_react3.default.createElement(
        "div",
        {
          key: item.id,
          className: "drag-row" + (isDragging ? " dragging" : "") + (overId === item.id && draggingId !== item.id ? " drag-over" : ""),
          style: isDragging && dragPos ? {
            position: "fixed",
            left: dragPos.left,
            top: dragPos.top,
            width: dragPos.width,
            height: dragPos.height,
            margin: 0,
            zIndex: 9999,
            pointerEvents: "none",
            transition: "none",
            opacity: 1,
            boxShadow: "0 8px 20px rgba(0,0,0,.25)"
          } : void 0,
          ...dragProps(item.id)
        },
        /* @__PURE__ */ import_react3.default.createElement("span", { className: "drag-handle", ...handleProps(item.id) }, "\u283F"),
        /* @__PURE__ */ import_react3.default.createElement("div", { className, style: { flex: 1 } }, renderItem(item))
      );
    });
  }

  function IconPicker({ icon, onChange, preset }) {
    const [customOpen, setCustomOpen] = (0, import_react3.useState)(false);
    return /* @__PURE__ */ import_react3.default.createElement("div", null, /* @__PURE__ */ import_react3.default.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 } }, preset.map((ic) => /* @__PURE__ */ import_react3.default.createElement("button", { key: ic, type: "button", className: "icon-pick" + (icon === ic ? " on" : ""), onClick: () => {
      onChange(ic);
      setCustomOpen(false);
    } }, ic)), /* @__PURE__ */ import_react3.default.createElement("button", { type: "button", className: "icon-pick" + (customOpen ? " on" : ""), onClick: () => setCustomOpen((o) => !o), title: "\u81EA\u5DF1\u8F93\u5165" }, "\u270F\uFE0F")), customOpen && /* @__PURE__ */ import_react3.default.createElement(
      "input",
      {
        type: "text",
        value: icon,
        onChange: (e) => onChange(e.target.value.slice(0, 4)),
        placeholder: "\u7C98\u8D34\u6216\u8F93\u5165\u4EFB\u610Femoji",
        style: { width: 160, marginBottom: 10 }
      }
    ));
  }

  function PieChart({ data }) {
    const total = data.reduce((s, d) => s + d.total, 0);
    if (!total) return /* @__PURE__ */ import_react3.default.createElement("div", { className: "empty" }, "\u8FD8\u6CA1\u6709\u6570\u636E");
    let angle = 0;
    const R = 70, CX = 90, CY = 90;
    const slices = data.map((d, i) => {
      const frac = d.total / total;
      const start = angle;
      angle += frac * 360;
      const end = angle;
      const large = end - start > 180 ? 1 : 0;
      const toXY = (a) => [CX + R * Math.sin(a * Math.PI / 180), CY - R * Math.cos(a * Math.PI / 180)];
      const [x1, y1] = toXY(start), [x2, y2] = toXY(end);
      const path = frac >= 0.999 ? `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} Z` : `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
      return { path, color: CHART_COLORS[i % CHART_COLORS.length], name: d.category_name, icon: d.category_icon, total, pct: (frac * 100).toFixed(0), value: d.total };
    });
    return /* @__PURE__ */ import_react3.default.createElement("div", { style: { display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" } }, /* @__PURE__ */ import_react3.default.createElement("svg", { viewBox: "0 0 180 180", style: { width: 160, height: 160, flexShrink: 0 } }, slices.map((s, i) => /* @__PURE__ */ import_react3.default.createElement("path", { key: i, d: s.path, fill: s.color, stroke: "var(--panel)", strokeWidth: 1 }))), /* @__PURE__ */ import_react3.default.createElement("div", { style: { flex: 1, minWidth: 160 } }, slices.map((s, i) => /* @__PURE__ */ import_react3.default.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 0" } }, /* @__PURE__ */ import_react3.default.createElement("span", { className: "swatch", style: { background: s.color } }), /* @__PURE__ */ import_react3.default.createElement("span", null, s.icon, " ", s.name), /* @__PURE__ */ import_react3.default.createElement("span", { style: { marginLeft: "auto", color: "var(--text-2)" } }, (0, import_shared3.yen)(s.value), "\uFF08", s.pct, "%\uFF09")))));
  }

  function parseYMD(s) {
    const [y, m, d] = s.split("-").map(Number);
    return { y, m, d };
  }

  function todayYMD() {
    const t = /* @__PURE__ */ new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  }

  function DatePicker({ value, onChange }) {
    const [open, setOpen] = (0, import_react3.useState)(false);
    const initial = parseYMD(value || todayYMD());
    const [viewY, setViewY] = (0, import_react3.useState)(initial.y);
    const [viewM, setViewM] = (0, import_react3.useState)(initial.m);
    const rootRef = (0, import_react3.useRef)(null);
    (0, import_react3.useEffect)(() => {
      const onDocClick = (e) => {
        if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
      };
      document.addEventListener("mousedown", onDocClick);
      return () => document.removeEventListener("mousedown", onDocClick);
    }, []);
    const toggle = () => {
      if (!open) {
        const p = parseYMD(value || todayYMD());
        setViewY(p.y);
        setViewM(p.m);
      }
      setOpen((o) => !o);
    };
    const changeMonth = (delta) => {
      let m = viewM + delta, y = viewY;
      if (m < 1) {
        m = 12;
        y -= 1;
      } else if (m > 12) {
        m = 1;
        y += 1;
      }
      setViewM(m);
      setViewY(y);
    };
    const pick = (d) => {
      onChange(`${viewY}-${String(viewM).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
      setOpen(false);
    };
    const firstWeekday = new Date(viewY, viewM - 1, 1).getDay();
    const daysInMonth = new Date(viewY, viewM, 0).getDate();
    const today = todayYMD();
    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return /* @__PURE__ */ import_react3.default.createElement("div", { className: "date-picker", ref: rootRef }, /* @__PURE__ */ import_react3.default.createElement("button", { type: "button", className: "date-picker-trigger", onClick: toggle }, "\u{1F4C5} ", value || "\u9009\u65E5\u671F"), open && /* @__PURE__ */ import_react3.default.createElement("div", { className: "date-picker-popup" }, /* @__PURE__ */ import_react3.default.createElement("div", { className: "date-picker-header" }, /* @__PURE__ */ import_react3.default.createElement("button", { type: "button", onClick: () => changeMonth(-1) }, "\u2039"), /* @__PURE__ */ import_react3.default.createElement("span", null, viewY, "\u5E74", viewM, "\u6708"), /* @__PURE__ */ import_react3.default.createElement("button", { type: "button", onClick: () => changeMonth(1) }, "\u203A")), /* @__PURE__ */ import_react3.default.createElement("div", { className: "date-picker-weekdays" }, WEEKDAYS.map((w) => /* @__PURE__ */ import_react3.default.createElement("span", { key: w }, w))), /* @__PURE__ */ import_react3.default.createElement("div", { className: "date-picker-grid" }, cells.map((d, i) => {
      if (d == null) return /* @__PURE__ */ import_react3.default.createElement("span", { key: i });
      const ymd = `${viewY}-${String(viewM).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const isToday = ymd === today;
      const isSelected = ymd === value;
      return /* @__PURE__ */ import_react3.default.createElement(
        "button",
        {
          key: i,
          type: "button",
          className: "date-picker-day" + (isToday ? " today" : "") + (isSelected ? " selected" : ""),
          onClick: () => pick(d)
        },
        d
      );
    })), /* @__PURE__ */ import_react3.default.createElement("button", { type: "button", className: "date-picker-today-btn", onClick: () => {
      const t = todayYMD();
      onChange(t);
      const p = parseYMD(t);
      setViewY(p.y);
      setViewM(p.m);
      setOpen(false);
    } }, "\u56DE\u5230\u4ECA\u5929")));
  }

  function Modal({ title, onClose, children, width }) {
    const boxRef = (0, import_react3.useRef)(null);
    (0, import_react3.useEffect)(() => {
      const onKey = (e) => {
        if (e.key === "Escape") onClose();
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);
    return /* @__PURE__ */ import_react3.default.createElement("div", { className: "bk-modal-backdrop", onMouseDown: (e) => {
      if (e.target === e.currentTarget) onClose();
    } }, /* @__PURE__ */ import_react3.default.createElement("div", { className: "bk-modal-box", ref: boxRef, style: width ? { width } : void 0 }, /* @__PURE__ */ import_react3.default.createElement("div", { className: "bk-modal-header" }, /* @__PURE__ */ import_react3.default.createElement("span", null, title), /* @__PURE__ */ import_react3.default.createElement("button", { type: "button", className: "bk-modal-close", onClick: onClose }, "\xD7")), /* @__PURE__ */ import_react3.default.createElement("div", { className: "bk-modal-body" }, children)));
  }

  function useContextMenu() {
    const [menu, setMenu] = (0, import_react3.useState)(null);
    (0, import_react3.useEffect)(() => {
      if (!menu) return;
      const close = () => setMenu(null);
      document.addEventListener("mousedown", close);
      document.addEventListener("scroll", close, true);
      return () => {
        document.removeEventListener("mousedown", close);
        document.removeEventListener("scroll", close, true);
      };
    }, [menu]);
    const openMenu = (e, items) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, items });
    };
    const menuNode = menu && /* @__PURE__ */ import_react3.default.createElement("div", { className: "bk-context-menu", style: { left: menu.x, top: menu.y }, onMouseDown: (e) => e.stopPropagation() }, menu.items.map((it, i) => /* @__PURE__ */ import_react3.default.createElement("button", { key: i, type: "button", onClick: () => {
      setMenu(null);
      it.onClick();
    } }, it.label)));
    return { openMenu, menuNode };
  }

  function CategoryPicker({ categories, type, value, onChange, onReorder }) {
    const [stack, setStack] = (0, import_react3.useState)([]);
    const currentParentId = stack.length ? stack[stack.length - 1] : null;
    const sameType = categories.filter((c) => c.type === type);
    const currentLevel = sameType.filter((c) => (c.parent_id || null) === currentParentId);
    const currentParent = currentParentId ? sameType.find((c) => c.id === currentParentId) : null;
    const hasChildren = (catId) => sameType.some((c) => c.parent_id === catId);
    const selectedCat = value ? sameType.find((c) => c.id === value) : null;
    const pick = (id) => {
      if (hasChildren(id)) setStack([...stack, id]);
      else onChange(id);
    };
    return /* @__PURE__ */ import_react3.default.createElement("div", { className: "cat-picker" }, selectedCat && /* @__PURE__ */ import_react3.default.createElement("div", { className: "cat-picker-selected" }, "\u5DF2\u9009\uFF1A", selectedCat.icon, " ", selectedCat.name), stack.length > 0 && /* @__PURE__ */ import_react3.default.createElement("div", { className: "cat-picker-breadcrumb" }, /* @__PURE__ */ import_react3.default.createElement("button", { type: "button", className: "icon-btn", onClick: () => setStack(stack.slice(0, -1)) }, "\u2039 \u8FD4\u56DE\u4E0A\u4E00\u7EA7"), currentParent && /* @__PURE__ */ import_react3.default.createElement(
      "button",
      {
        type: "button",
        className: "btn sm" + (value === currentParent.id ? " on" : " ghost"),
        onClick: () => onChange(currentParent.id)
      },
      "\u2713 \u5C31\u9009\u300C",
      currentParent.icon,
      " ",
      currentParent.name,
      "\u300D\u672C\u8EAB"
    )), /* @__PURE__ */ import_react3.default.createElement(
      IconGrid,
      {
        items: currentLevel,
        value,
        onChange: pick,
        onReorder,
        renderExtra: (c) => hasChildren(c.id) && /* @__PURE__ */ import_react3.default.createElement("span", { className: "cat-picker-drill" }, "\u4E0B\u9762\u8FD8\u6709 \u203A")
      }
    ));
  }

  const BASE_YEAR = (/* @__PURE__ */ new Date()).getFullYear() - 5;
  const SPAN_MONTHS = 10 * 12;
  function monthToIndex(ym) {
    const [y, m] = ym.split("-").map(Number);
    return (y - BASE_YEAR) * 12 + (m - 1);
  }

  function indexToMonth(idx) {
    const y = BASE_YEAR + Math.floor(idx / 12);
    const m = idx % 12 + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
  }

  function MonthSlider({ value, onChange }) {
    const idx = Math.min(SPAN_MONTHS - 1, Math.max(0, monthToIndex(value)));
    const [y, m] = value.split("-");
    return /* @__PURE__ */ import_react10.default.createElement("div", { className: "month-slider" }, /* @__PURE__ */ import_react10.default.createElement("div", { className: "month-slider-label" }, y, "\u5E74", parseInt(m, 10), "\u6708"), /* @__PURE__ */ import_react10.default.createElement(
      "input",
      {
        type: "range",
        min: 0,
        max: SPAN_MONTHS - 1,
        value: idx,
        onChange: (e) => onChange(indexToMonth(parseInt(e.target.value, 10)))
      }
    ), /* @__PURE__ */ import_react10.default.createElement("div", { className: "month-slider-quick" }, /* @__PURE__ */ import_react10.default.createElement("button", { type: "button", className: "icon-btn", onClick: () => onChange(indexToMonth(idx - 1)) }, "\u2039 \u4E0A\u6708"), /* @__PURE__ */ import_react10.default.createElement("button", { type: "button", className: "icon-btn", onClick: () => {
      const today = /* @__PURE__ */ new Date();
      onChange(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
    } }, "\u56DE\u5230\u672C\u6708"), /* @__PURE__ */ import_react10.default.createElement("button", { type: "button", className: "icon-btn", onClick: () => onChange(indexToMonth(idx + 1)) }, "\u4E0B\u6708 \u203A")));
  }

  function SummaryCard({ refreshKey }) {
    const [summary, setSummary] = (0, import_react.useState)(null);
    (0, import_react.useEffect)(() => {
      import_dataService.dataService.getTransactionSummary().then(setSummary);
    }, [refreshKey]);
    if (!summary) return /* @__PURE__ */ import_react.default.createElement(import_shared.Loading, null);
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "grid", style: { marginBottom: 14 } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "stat" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "lbl" }, "\u603B\u6536\u5165"), /* @__PURE__ */ import_react.default.createElement("div", { className: "val v-down" }, (0, import_shared.yen)(summary.income))), /* @__PURE__ */ import_react.default.createElement("div", { className: "stat" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "lbl" }, "\u603B\u652F\u51FA"), /* @__PURE__ */ import_react.default.createElement("div", { className: "val v-up" }, (0, import_shared.yen)(summary.expense))), /* @__PURE__ */ import_react.default.createElement("div", { className: "stat" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "lbl" }, "\u7ED3\u4F59"), /* @__PURE__ */ import_react.default.createElement("div", { className: `val ${summary.net >= 0 ? "v-down" : "v-up"}` }, (0, import_shared.yen)(summary.net))));
  }

  function AccountsStrip({ accounts, refreshKey }) {
    const [accs, setAccs] = (0, import_react2.useState)(accounts);
    (0, import_react2.useEffect)(() => {
      import_dataService2.dataService.getAccounts().then(setAccs);
    }, [refreshKey]);
    return /* @__PURE__ */ import_react2.default.createElement("div", { className: "accounts-strip" }, accs.map((a) => /* @__PURE__ */ import_react2.default.createElement("div", { key: a.id, className: "accounts-strip-item" }, /* @__PURE__ */ import_react2.default.createElement("span", null, a.icon), /* @__PURE__ */ import_react2.default.createElement("span", { className: "accounts-strip-name" }, a.name), /* @__PURE__ */ import_react2.default.createElement("span", { className: `accounts-strip-balance ${a.balance < 0 ? "v-up" : ""}` }, (0, import_shared2.yen)(a.balance)))));
  }

  function BudgetAlertBanner() {
    const [overItems, setOverItems] = (0, import_react18.useState)(null);
    (0, import_react18.useEffect)(() => {
      const month = (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
      import_dataService16.dataService.getBudgetStatus(month).then((status) => {
        setOverItems((status.items || []).filter((it) => it.over));
      }).catch(() => setOverItems([]));
    }, []);
    if (!overItems || overItems.length === 0) return null;
    return /* @__PURE__ */ import_react18.default.createElement(
      "div",
      { className: "note-banner", style: { borderLeftColor: "var(--up)", marginBottom: 14 } },
      "\u26A0 \u672C\u6708\u9884\u7B97\u5DF2\u8D85\u652F\uFF1A",
      overItems.map((it, i) => /* @__PURE__ */ import_react18.default.createElement(
        "span",
        { key: it.category_id, style: { marginLeft: i === 0 ? 6 : 0 } },
        i > 0 && "\u3001",
        it.category_icon,
        it.category_name,
        `(${(0, import_shared21.yen)(it.spent)} / ${(0, import_shared21.yen)(it.limit)})`
      ))
    );
  }

  window.__bk = window.__bk || {};
  Object.assign(window.__bk, { ACCOUNT_ICON_PRESET, AccountsStrip, BudgetAlertBanner, CATEGORY_ICON_PRESET, CategoryPicker, DatePicker, DragList, IconGrid, IconPicker, Modal, MonthSlider, PieChart, SummaryCard, useContextMenu });
})();

} catch(e) { console.error('bookkeeping-shared.js 加载出错:', e); }
