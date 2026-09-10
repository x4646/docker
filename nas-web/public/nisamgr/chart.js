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

  // pages/ChartPage.jsx
  var import_react2 = __toESM(__require("react"));
  var import_dataService = __require("../dataService.js");
  var import_shared = __require("../shared.jsx");

  // LineChartWidget.jsx
  var import_react = __toESM(__require("react"));
  var GRAINS = ["week", "month", "year", "10y", "20y"];
  var GRAIN_LABEL = { week: "\u5468", month: "\u6708", year: "\u5E74", "10y": "10\u5E74", "20y": "20\u5E74" };
  var GRAIN_CONFIG = {
    week: { bucket: "day", targetPoints: 7 },
    month: { bucket: "week", targetPoints: 4.3 },
    year: { bucket: "month", targetPoints: 12 },
    "10y": { bucket: "year", targetPoints: 10 },
    "20y": { bucket: "year", targetPoints: 20 }
  };
  function fillDaily(points) {
    if (!points.length) return [];
    const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
    const out = [];
    const start = new Date(sorted[0].date);
    const end = new Date(sorted[sorted.length - 1].date);
    let idx = 0, last = sorted[0].value;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      let isReal = false;
      while (idx < sorted.length && sorted[idx].date === key) {
        last = sorted[idx].value;
        idx++;
        isReal = true;
      }
      out.push({ date: key, value: last, isReal });
    }
    return out;
  }
  // Catmull-Rom转三次贝塞尔的平滑曲线(比直线段更好看), 面积填充(areaPath)复用同一条曲线,
  // 保证描边和底下的渐变色块严丝合缝、不会看起来对不上。
  function curveD(real) {
    if (real.length === 0) return null;
    if (real.length === 1) return `M ${real[0].x} ${real[0].y}`;
    const get = (i) => real[Math.max(0, Math.min(real.length - 1, i))];
    let d = `M ${real[0].x} ${real[0].y}`;
    for (let i = 0; i < real.length - 1; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }
  function linePath(pts) {
    const real = pts.filter((p) => p.value != null);
    return curveD(real) || "";
  }
  function areaPath(pts, baselineY) {
    const real = pts.filter((p) => p.value != null);
    if (real.length === 0) return "";
    const d = curveD(real);
    const first = real[0], last = real[real.length - 1];
    return `${d} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;
  }
  function padDailyBothSides(daily, targetTotal) {
    if (daily.length === 0) return daily;
    const first = new Date(daily[0].date);
    const last = new Date(daily[daily.length - 1].date);
    const today = new Date((/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
    const lastValue = daily[daily.length - 1].value;
    const oneDay = 24 * 60 * 60 * 1e3;
    const spanEnd = new Date(Math.max(today.getTime(), last.getTime()));
    const spanDays = Math.round((spanEnd - first) / oneDay) + 1;
    if (spanDays >= targetTotal) {
      const after = [];
      const target = new Date(spanEnd);
      target.setDate(target.getDate() + 2);
      for (let d = new Date(last); d < target; ) {
        d.setDate(d.getDate() + 1);
        after.push({ date: d.toISOString().slice(0, 10), value: lastValue, isReal: false });
      }
      return [...daily, ...after];
    }
    const half = Math.floor(targetTotal / 2);
    const windowStart = new Date(today);
    windowStart.setDate(windowStart.getDate() - half);
    const windowEnd = new Date(windowStart);
    windowEnd.setDate(windowStart.getDate() + targetTotal - 1);
    const actualStart = first < windowStart ? first : windowStart;
    const actualEnd = new Date(actualStart);
    actualEnd.setDate(actualStart.getDate() + Math.max(targetTotal, spanDays) - 1);
    const byDate = new Map(daily.map((p) => [p.date, p]));
    const out = [];
    for (let d = new Date(actualStart); d <= actualEnd; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      if (byDate.has(key)) out.push(byDate.get(key));
      else if (d < first) out.push({ date: key, value: null, isReal: false });
      else out.push({ date: key, value: lastValue, isReal: false });
    }
    return out;
  }
  function groupByBucket(daily, bucket) {
    if (bucket === "day") return daily;
    const map = /* @__PURE__ */ new Map();
    daily.forEach((p) => {
      const d = new Date(p.date);
      let key;
      if (bucket === "year") key = p.date.slice(0, 4);
      else if (bucket === "month") key = p.date.slice(0, 7);
      else {
        const onejan = new Date(d.getFullYear(), 0, 1);
        const wk = Math.ceil(((d - onejan) / 864e5 + onejan.getDay() + 1) / 7);
        key = `${d.getFullYear()}-W${String(wk).padStart(2, "0")}`;
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p.value);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, vals]) => ({
      date,
      value: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length),
      isReal: true
    }));
  }
  var VIEWPORT_W = 900;
  var PLOT_H = 260;
  var LABEL_H = 26;
  var H = PLOT_H + LABEL_H;
  var PAD = 10;
  function formatAxisLabel(dateKey, bucket) {
    if (bucket === "day") {
      const [y, m, d] = dateKey.split("-");
      return `${y}/${m}/${d}`;
    }
    if (bucket === "week") {
      const [y, w] = dateKey.split("-W");
      const approxDate = new Date(Number(y), 0, 1 + (Number(w) - 1) * 7);
      const m = String(approxDate.getMonth() + 1).padStart(2, "0");
      return `${y}/${m} \u7B2C${Number(w)}\u5468`;
    }
    if (bucket === "month") {
      const [y, m] = dateKey.split("-");
      return `${y}/${m}`;
    }
    return dateKey;
  }
  function fmtVal(v, mode) {
    if (v == null) return "—";
    if (mode === "percent") return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
    return "\xA5" + Math.round(v).toLocaleString("en-US");
  }
  function fmtPct(v) {
    if (v == null) return "—";
    if (v > 0) return "↑ +" + v.toFixed(1) + "%";
    if (v < 0) return "↓ " + v.toFixed(1) + "%";
    return "— 0.0%";
  }
  function LineChartWidget({ series }) {
    const [checked, setChecked] = (0, import_react.useState)(() => series.map(() => false));
    const [grainIdx, setGrainIdx] = (0, import_react.useState)(0);
    const [viewMode, setViewMode] = (0, import_react.useState)("split");
    const [hover, setHover] = (0, import_react.useState)(null);
    const [viewportW, setViewportW] = (0, import_react.useState)(900);
    const [valueMode, setValueMode] = (0, import_react.useState)("absolute");
    const [solo, setSolo] = (0, import_react.useState)(null);
    const wrapRef = (0, import_react.useRef)(null);
    const pinchRef = (0, import_react.useRef)(null);
    const grain = GRAINS[grainIdx];
    const { bucket, targetPoints } = GRAIN_CONFIG[grain];
    (0, import_react.useEffect)(() => {
      if (!wrapRef.current) return;
      const update = () => {
        if (wrapRef.current) setViewportW(wrapRef.current.clientWidth || 900);
      };
      update();
      if (typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(update);
      ro.observe(wrapRef.current);
      return () => ro.disconnect();
    }, []);
    const changeGrain = (0, import_react.useCallback)((delta) => {
      setGrainIdx((i) => Math.min(GRAINS.length - 1, Math.max(0, i + delta)));
    }, []);
    (0, import_react.useEffect)(() => {
      const el = wrapRef.current;
      if (!el) return;
      const onWheelNative = (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          e.preventDefault();
          changeGrain(e.deltaY > 0 ? 1 : -1);
        }
      };
      el.addEventListener("wheel", onWheelNative, { passive: false });
      return () => el.removeEventListener("wheel", onWheelNative);
    }, [changeGrain]);
    const effectiveSeries = (0, import_react.useMemo)(() => {
      if (viewMode === "split") return series;
      const byName = /* @__PURE__ */ new Map();
      series.forEach((s) => {
        if (!byName.has(s.name)) byName.set(s.name, { ...s, id: "merge-" + s.name, account: "\u5408\u5E76", points: [] });
      });
      const merged = [];
      byName.forEach((tmpl, name) => {
        const sameName = series.filter((s) => s.name === name);
        const filledAll = sameName.map((s) => new Map(fillDaily(s.points).map((p) => [p.date, p.value])));
        const allDates = /* @__PURE__ */ new Set();
        filledAll.forEach((m) => m.forEach((_, d) => allDates.add(d)));
        const pts = Array.from(allDates).sort().map((date) => ({
          date,
          value: filledAll.reduce((s, m) => s + (m.get(date) || 0), 0)
        }));
        merged.push({ ...tmpl, points: pts });
      });
      return merged;
    }, [series, viewMode]);
    const checkArr = checked.length === effectiveSeries.length ? checked : effectiveSeries.map(() => true);
    const processed = (0, import_react.useMemo)(() => effectiveSeries.map((s) => {
      let daily = fillDaily(s.points);
      if (bucket === "day") daily = padDailyBothSides(daily, Math.round(targetPoints));
      const data = groupByBucket(daily, bucket);
      const reals = data.filter((p) => p.isReal && p.value != null);
      const firstReal = reals.length ? reals[0].value : null;
      const lastReal = reals.length ? reals[reals.length - 1].value : null;
      const changeAbs = firstReal != null && lastReal != null ? lastReal - firstReal : null;
      const changePct = firstReal ? changeAbs / firstReal * 100 : null;
      return { ...s, data, firstReal, lastReal, changeAbs, changePct };
    }), [effectiveSeries, bucket, targetPoints]);
    const visible = processed.filter((_, i) => checkArr[i]);
    const { linesGeom, gridLines, empty, maxLen, totalWidth, todayX, yMin, yMax } = (0, import_react.useMemo)(() => {
      // 涨跌幅模式: 把每个系列的值换算成"相对本系列窗口内第一个真实值的百分比变化",
      // 这样不同量级的产品(比如100万和1万日元)才能画在同一条Y轴上比出涨跌,不会有的
      // 产品因为绝对值太小、看起来永远是一条贴底的直线。
      const source = valueMode === "percent" ? visible.map((s) => {
        const base = s.firstReal;
        return { ...s, data: s.data.map((p) => ({ ...p, value: base ? p.value != null ? (p.value - base) / base * 100 : null : null })) };
      }) : visible;
      const all = [].concat(...source.map((s) => s.data.map((p) => p.value))).filter((v) => v != null);
      if (!all.length) return { empty: true };
      let mn = Math.min(...all), mx = Math.max(...all);
      if (mn === mx) {
        mn *= 0.95;
        mx *= 1.05;
      }
      const span = mx - mn;
      const yPad = span * 0.12;
      mn -= yPad;
      mx += yPad;
      // 横轴按"日期"对齐,不能按各系列自己数组的下标对齐——不同产品/账户起始时间不一样,
      // 各自data数组长度也不一样,原来直接用各自下标/各自长度算x坐标,会导致不同系列的
      // 同一个下标对应完全不同的日期(叠加对比时线条错位,悬浮框日期和数值对不上)。
      const axisDates = Array.from(new Set([].concat(...source.map((s) => s.data.map((p) => p.date))))).sort();
      const mLen = Math.max(axisDates.length, 1);
      const pxPerPoint = viewportW / targetPoints;
      const tw = Math.max(viewportW, mLen * pxPerPoint);
      const x = (i) => PAD + (mLen <= 1 ? 0 : i * (tw - 2 * PAD) / (mLen - 1));
      const y = (v) => PLOT_H - PAD - (v - mn) / (mx - mn) * (PLOT_H - 2 * PAD);
      const grid = [];
      for (let k = 0; k <= 4; k++) grid.push(PAD + k * (PLOT_H - 2 * PAD) / 4);
      const geoms = source.map((s) => {
        const byDate = /* @__PURE__ */ new Map(s.data.map((p) => [p.date, p]));
        const pts = axisDates.map((date, i) => {
          const p = byDate.get(date);
          return {
            x: x(i),
            y: p && p.value != null ? y(p.value) : null,
            date,
            value: p ? p.value : null,
            label: formatAxisLabel(date, bucket),
            isReal: p ? p.isReal : false
          };
        });
        return { ...s, pts, path: linePath(pts), area: areaPath(pts, PLOT_H - PAD) };
      });
      const todayStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const todayIdx = bucket === "day" ? axisDates.indexOf(todayStr) : -1;
      const todayPt = todayIdx >= 0 && geoms[0] ? geoms[0].pts[todayIdx] : null;
      return { linesGeom: geoms, gridLines: grid, maxLen: mLen, totalWidth: tw, todayX: todayPt ? todayPt.x : null, yMin: mn, yMax: mx };
    }, [visible, targetPoints, bucket, viewportW, valueMode]);
    const toggle = (i) => setChecked((prev) => {
      const base = prev.length === effectiveSeries.length ? [...prev] : effectiveSeries.map(() => true);
      base[i] = !base[i];
      return base;
    });
    const anyOn = checkArr.some((c) => c);
    const toggleAll = () => setChecked(effectiveSeries.map(() => !anyOn));
    // iOS没有鼠标悬浮这回事, 原来只有handleMouseMove在设hover, 导致手机上点/拖图表
    // 根本看不到数值提示——这里把"算hover在哪个点"抽出来, 单指触摸也能触发。
    const showHoverAt = (clientX, clientY) => {
      if (empty || !wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const scrollLeft = wrapRef.current.scrollLeft;
      const relX = clientX - rect.left + scrollLeft;
      const idx = Math.round((relX - PAD) / (totalWidth - 2 * PAD) * (maxLen - 1));
      const clamped = Math.max(0, Math.min(maxLen - 1, idx));
      setHover({ index: clamped, clientX: clientX - rect.left, clientY: clientY - rect.top });
    };
    const handleMouseMove = (e) => showHoverAt(e.clientX, e.clientY);
    const handleMouseLeave = () => setHover(null);
    const touchDist = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };
    const handleTouchStart = (e) => {
      if (e.touches.length === 2) { pinchRef.current = touchDist(e.touches); return; }
      if (e.touches.length === 1) showHoverAt(e.touches[0].clientX, e.touches[0].clientY);
    };
    const handleTouchMove = (e) => {
      if (e.touches.length === 2 && pinchRef.current != null) {
        const d = touchDist(e.touches);
        const delta = d - pinchRef.current;
        if (Math.abs(delta) > 20) {
          changeGrain(delta > 0 ? -1 : 1);
          pinchRef.current = d;
        }
        return;
      }
      if (e.touches.length === 1) showHoverAt(e.touches[0].clientX, e.touches[0].clientY);
    };
    const handleTouchEnd = () => {
      pinchRef.current = null;
      // hover状态故意不清空: 手指抬起后数值提示还留着, 用户才看得清刚才点的是哪个点
      // (触屏没有"悬浮"这个概念, 抬手就消失的话根本来不及看)
    };
    import_react.default.useEffect(() => {
      if (bucket === "day" && todayX != null && wrapRef.current) {
        const el = wrapRef.current;
        el.scrollLeft = Math.max(0, todayX - el.clientWidth / 2);
      }
    }, [bucket, todayX]);
    const pageBy = (dir) => {
      if (!wrapRef.current) return;
      wrapRef.current.scrollBy({ left: dir * viewportW, behavior: "smooth" });
    };
    return /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { className: "toolbar" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "seg" }, GRAINS.map((g, i) => /* @__PURE__ */ import_react.default.createElement("button", { key: g, className: grainIdx === i ? "on" : "", onClick: () => setGrainIdx(i) }, GRAIN_LABEL[g]))), /* @__PURE__ */ import_react.default.createElement("div", { className: "seg" }, /* @__PURE__ */ import_react.default.createElement("button", { className: viewMode === "split" ? "on" : "", onClick: () => setViewMode("split") }, "\u5206\u8D26\u6237"), /* @__PURE__ */ import_react.default.createElement("button", { className: viewMode === "merge" ? "on" : "", onClick: () => setViewMode("merge") }, "\u5408\u5E76\u540C\u540D")), /* @__PURE__ */ import_react.default.createElement("div", { className: "seg" }, /* @__PURE__ */ import_react.default.createElement("button", { className: valueMode === "absolute" ? "on" : "", onClick: () => setValueMode("absolute") }, "\xA5 \u91D1\u989D"), /* @__PURE__ */ import_react.default.createElement("button", { className: valueMode === "percent" ? "on" : "", onClick: () => setValueMode("percent") }, "% \u6DA8\u8DCC\u5E45")), /* @__PURE__ */ import_react.default.createElement("button", { className: "btn ghost sm", onClick: toggleAll }, anyOn ? "\u5168\u4E0D\u9009" : "\u5168\u9009"), /* @__PURE__ */ import_react.default.createElement("div", { className: "seg" }, /* @__PURE__ */ import_react.default.createElement("button", { onClick: () => pageBy(-1) }, "\u25C0 \u4E0A\u4E00\u9875"), /* @__PURE__ */ import_react.default.createElement("button", { onClick: () => pageBy(1) }, "\u4E0B\u4E00\u9875 \u25B6"))), /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        className: "chart-wrap chart-scroll",
        ref: wrapRef,
        onMouseMove: handleMouseMove,
        onMouseLeave: handleMouseLeave,
        onTouchStart: handleTouchStart,
        onTouchMove: handleTouchMove,
        onTouchEnd: handleTouchEnd
      },
      empty ? /* @__PURE__ */ import_react.default.createElement("svg", { viewBox: `0 0 ${VIEWPORT_W} ${H}`, style: { width: "100%", height: H } }, /* @__PURE__ */ import_react.default.createElement("text", { x: VIEWPORT_W / 2, y: H / 2, fill: "#8996A4", fontSize: "13", textAnchor: "middle" }, "\u5168\u90E8\u53D6\u6D88 \u2014 \u52FE\u9009\u4EA7\u54C1\u67E5\u770B\u8D70\u52BF")) : /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("svg", { viewBox: `0 0 ${totalWidth} ${H}`, style: { width: totalWidth, height: H, display: "block" } }, /* @__PURE__ */ import_react.default.createElement("defs", null, linesGeom.map((s, i) => /* @__PURE__ */ import_react.default.createElement("linearGradient", { key: "grad" + i, id: "chartgrad" + i, x1: 0, y1: 0, x2: 0, y2: 1 }, /* @__PURE__ */ import_react.default.createElement("stop", { offset: "0%", stopColor: s.color, stopOpacity: 0.35 }), /* @__PURE__ */ import_react.default.createElement("stop", { offset: "100%", stopColor: s.color, stopOpacity: 0 })))), linesGeom.map((s, i) => /* @__PURE__ */ import_react.default.createElement("path", { key: "area-" + s.id, d: s.area, fill: `url(#chartgrad${i})`, stroke: "none", opacity: solo && solo !== s.id ? 0.08 : 1 })), gridLines.map((yy, i) => /* @__PURE__ */ import_react.default.createElement("line", { key: i, x1: 0, y1: yy, x2: totalWidth, y2: yy, stroke: "#26313D", strokeDasharray: "2 4" })), /* @__PURE__ */ import_react.default.createElement("text", { key: "ymax", x: 4, y: PAD + 10, fill: "#7C8494", fontSize: "10", fontFamily: "ui-monospace,monospace" }, fmtVal(yMax, valueMode)), /* @__PURE__ */ import_react.default.createElement("text", { key: "ymin", x: 4, y: PLOT_H - PAD - 2, fill: "#7C8494", fontSize: "10", fontFamily: "ui-monospace,monospace" }, fmtVal(yMin, valueMode)), linesGeom.map((s) => /* @__PURE__ */ import_react.default.createElement(
        "path",
        {
          key: s.id,
          d: s.path,
          fill: "none",
          stroke: s.color,
          strokeWidth: solo === s.id ? 3 : 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          opacity: solo && solo !== s.id ? 0.15 : 1,
          style: solo === s.id ? { filter: `drop-shadow(0 0 5px ${s.color})` } : void 0
        }
      )), linesGeom.map((s) => s.pts.filter((pt) => pt.isReal).map((pt, i) => /* @__PURE__ */ import_react.default.createElement("circle", { key: s.id + "-real-" + i, cx: pt.x, cy: pt.y, r: 3.5, fill: s.color, stroke: "#0B0F14", strokeWidth: 1, opacity: solo && solo !== s.id ? 0.15 : 1 }))), hover && linesGeom.map((s) => {
        const pt = s.pts[hover.index];
        if (!pt || pt.value == null) return null;
        return /* @__PURE__ */ import_react.default.createElement("circle", { key: "dot-" + s.id, cx: pt.x, cy: pt.y, r: 4.5, fill: s.color, stroke: "#0B0F14", strokeWidth: 1.5 });
      }), hover && linesGeom[0] && linesGeom[0].pts[hover.index] && /* @__PURE__ */ import_react.default.createElement(
        "line",
        {
          x1: linesGeom[0].pts[hover.index].x,
          y1: 0,
          x2: linesGeom[0].pts[hover.index].x,
          y2: PLOT_H,
          stroke: "#8996A4",
          strokeWidth: 1,
          strokeDasharray: "3 3",
          opacity: 0.5
        }
      ), (() => {
        const refSeries = linesGeom.reduce((longest, s) => s.pts.length > (longest ? longest.pts.length : 0) ? s : longest, null);
        if (!refSeries) return null;
        return refSeries.pts.map((pt, i) => /* @__PURE__ */ import_react.default.createElement(
          "text",
          {
            key: "axis-" + i,
            x: pt.x,
            y: PLOT_H + 17,
            fill: "#7C8494",
            fontSize: "9",
            textAnchor: "middle",
            fontFamily: "ui-monospace,monospace"
          },
          pt.label
        ));
      })()), hover && linesGeom.length > 0 && linesGeom[0].pts[hover.index] && (() => {
        const scrollLeft = wrapRef.current ? wrapRef.current.scrollLeft : 0;
        const viewportW2 = wrapRef.current ? wrapRef.current.clientWidth : 300;
        const rawLeft = hover.clientX + 14 + scrollLeft;
        const clampedLeft = Math.min(Math.max(rawLeft, scrollLeft + 4), scrollLeft + viewportW2 - 164);
        return /* @__PURE__ */ import_react.default.createElement("div", { className: "chart-tooltip", style: { left: clampedLeft, top: Math.max(hover.clientY - 10, 0) } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "chart-tooltip-date" }, linesGeom[0].pts[hover.index].date), linesGeom.map((s) => {
          const pt = s.pts[hover.index];
          if (!pt) return null;
          return /* @__PURE__ */ import_react.default.createElement("div", { key: s.id, className: "chart-tooltip-row" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "swatch", style: { background: s.color } }), /* @__PURE__ */ import_react.default.createElement("span", { className: "chart-tooltip-name" }, s.name), /* @__PURE__ */ import_react.default.createElement("span", { className: "chart-tooltip-value" }, fmtVal(pt.value, valueMode)));
        }));
      })())
    ), /* @__PURE__ */ import_react.default.createElement(
      "div",
      { className: "legend legend-rank" },
      processed.map((s, i) => ({ s, i })).sort((a, b) => {
        const av = a.s.changePct, bv = b.s.changePct;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av;
      }).map(({ s, i }) => /* @__PURE__ */ import_react.default.createElement(
        "div",
        {
          key: s.id,
          className: "legend-row" + (solo === s.id ? " solo" : "") + (!checkArr[i] ? " off" : ""),
          onClick: () => setSolo((cur) => cur === s.id ? null : s.id)
        },
        /* @__PURE__ */ import_react.default.createElement("input", { type: "checkbox", checked: !!checkArr[i], onClick: (e) => e.stopPropagation(), onChange: () => toggle(i) }),
        /* @__PURE__ */ import_react.default.createElement("span", { className: "swatch", style: { background: s.color } }),
        /* @__PURE__ */ import_react.default.createElement("span", { className: "legend-name" }, s.name, viewMode === "split" && s.account !== "\u5408\u5E76" ? `\uFF08${s.account}\uFF09` : ""),
        /* @__PURE__ */ import_react.default.createElement("span", { className: "legend-value" }, fmtVal(s.lastReal, "absolute")),
        /* @__PURE__ */ import_react.default.createElement("span", { className: "legend-change " + (s.changePct > 0 ? "up" : s.changePct < 0 ? "down" : "") }, fmtPct(s.changePct))
      ))
    ), /* @__PURE__ */ import_react.default.createElement("div", { className: "hint" }, "\u5468\u6863=\u6309\u5929\u3001\u6708\u6863=\u6309\u5468\u3001\u5E74\u6863=\u6309\u6708\u300110/20\u5E74\u6863=\u6309\u5E74 \xB7 \u7AD6\u76F4\u6EDA\u8F6E/\u53CC\u6307\u7F29\u653E\u5207\u6863\u4F4D\uFF0C\u6A2A\u5411\u6EDA\u52A8/\u62D6\u62FD\u6216\u70B9\u4E0A\u4E00\u9875\u4E0B\u4E00\u9875\u7FFB\u65F6\u95F4\u6BB5 \xB7 \u5468\u6863\u9ED8\u8BA4\u4ECA\u5929\u5C45\u4E2D\uFF0C\u672A\u6765\u6682\u65E0\u6570\u636E\u7684\u90E8\u5206\u6CBF\u7528\u6700\u65B0\u503C\u5EF6\u4F38 \xB7 \u9F20\u6807\u60AC\u6D6E\u770B\u5177\u4F53\u65E5\u671F\u548C\u4EF7\u683C \xB7 \u5B9E\u5FC3\u70B9=\u771F\u5B9E\u6570\u636E\u3002"));
  }

  // pages/ChartPage.jsx
  var PALETTE = ["#E0A94B", "#5B9BD5", "#4FB0A5", "#C77DD6", "#E8735A", "#7BC96F", "#D6A05B", "#6FA8DC", "#B5C77D"];
  function ChartPage({ store }) {
    const [series, setSeries] = (0, import_react2.useState)(null);
    const [error, setError] = (0, import_react2.useState)("");
    (0, import_react2.useEffect)(() => {
      import_dataService.dataService.getHoldingsReal().then((raw) => {
        setSeries(raw.map((s, i) => ({
          id: `${s.product_id}||${s.account}`,
          name: s.name,
          account: s.account || "(\u5F85\u786E\u8BA4)",
          color: PALETTE[i % PALETTE.length],
          points: s.points
        })));
      }).catch((e) => setError(e.message));
    }, []);
    if (!store) return /* @__PURE__ */ import_react2.default.createElement(import_shared.Loading, null);
    return /* @__PURE__ */ import_react2.default.createElement("div", null, /* @__PURE__ */ import_react2.default.createElement("h2", { className: "page-title" }, "\u8D70\u52BF\u5206\u6790"), /* @__PURE__ */ import_react2.default.createElement("div", { className: "page-sub" }, "\u7EAF\u8D8B\u52BF\u5C55\u793A\uFF0C\u4E0D\u53C2\u4E0E\u8BA1\u7B97 \xB7 \u9ED8\u8BA4\u5168\u9009\u53E0\u52A0 \xB7 \u00A5\u91D1\u989D/%\u6DA8\u8DCC\u5E45\u53EF\u5207\u6362(\u4E0D\u540C\u91CF\u7EA7\u4EA7\u54C1\u5EFA\u8BAE\u770B%) \xB7 \u56FE\u4F8B\u6309\u6DA8\u8DCC\u5E45\u6392\u5E8F,\u70B9\u4E00\u884C\u53EA\u770B\u8FD9\u4E00\u6761 \xB7 \u5B58\u50A8\u9897\u7C92\u5EA6=\u5929\uFF08\u5468/\u6708/\u5E74\u662F\u5C55\u793A\u65F6\u4E34\u65F6\u805A\u5408\uFF0C\u4E0D\u662F\u53E6\u5B58\u7684\u6570\u636E\uFF09"), /* @__PURE__ */ import_react2.default.createElement(import_shared.Card, null, error && /* @__PURE__ */ import_react2.default.createElement("div", { className: "empty" }, "\u8FDE\u4E0D\u4E0A\u5386\u53F2\u6570\u636E\uFF1A", error), !error && !series && /* @__PURE__ */ import_react2.default.createElement(import_shared.Loading, null), !error && series && series.length === 0 && /* @__PURE__ */ import_react2.default.createElement("div", { className: "empty" }, "\u8FD8\u6CA1\u6709\u5386\u53F2\u6570\u636E\u70B9\u53EF\u753B", /* @__PURE__ */ import_react2.default.createElement("br", null), /* @__PURE__ */ import_react2.default.createElement("span", { style: { fontSize: 11 } }, '\u6BCF\u6B21\u5728"\u5F85\u786E\u8BA4"\u786E\u8BA4\u3001\u6216"\u624B\u52A8\u5F55\u5165"\u6539\u4E00\u6761\uFF0C\u90FD\u4F1A\u591A\u4E00\u4E2A\u70B9')), !error && series && series.length > 0 && /* @__PURE__ */ import_react2.default.createElement(LineChartWidget, { series })));
  }
  window.ChartPage = ChartPage;
})();

} catch(e) { console.error('chart.js 加载出错:', e);  }
