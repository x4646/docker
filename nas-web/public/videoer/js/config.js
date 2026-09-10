// config.js — 视频页 / 播放器 的可配置项
//
// 全部存 localStorage 的 'vCfg'。播放器与列表页都从这里读取。

'use strict';

var VCfg = (function () {

  var KEY = 'vCfg';

  var DEFAULTS = {
    // ── 播放器 ──
    seekStep:      5,      // 左右方向键快进秒数
    seekBigStep:   30,     // Shift + 方向键秒数
    volStep:       10,     // 上下方向键音量步进(%)
    defVolume:     100,    // 默认音量(%)
    defSpeed:      1,      // 默认倍速
    resumePlay:    true,   // 记忆并恢复播放位置
    autoNext:      true,   // 播完自动下一个
    uiHideDelay:   2600,   // 控制栏自动隐藏毫秒
    previewWidth:  168,    // 进度条悬停预览图宽度(px)
    frameStep:     25,     // 逐帧步进假定帧率
    dblAction:     'full', // 双击画面: full=全屏 / play=播放暂停

    // ── 列表页 ──
    pageSize:      50,     // 每页加载数量
    hoverDelay:    500,    // 鼠标停留多久才开始轮播(毫秒)
    hoverLoop:     8000,   // 悬停轮播总时长(毫秒)
    cardClick:     'pot',  // 点缩略图: pot=PotPlayer / online=网页播放
    showOnlineTag: true,   // 显示"在线"角标
    autoLoad:      true,   // 滚到底自动加载

    // ── 滤镜 ──
    defPreset:     0,      // 默认预设序号
    defPower:      100     // 默认强度(%)
  };

  var cfg = null;

  function load() {
    if (cfg) return cfg;
    cfg = {};
    for (var k in DEFAULTS) cfg[k] = DEFAULTS[k];
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d) for (var k2 in DEFAULTS) if (d[k2] !== undefined) cfg[k2] = d[k2];
    } catch (e) {}
    return cfg;
  }

  function get(k) { return load()[k]; }

  function set(k, v) {
    load();
    cfg[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  function reset() {
    cfg = null;
    try { localStorage.removeItem(KEY); } catch (e) {}
    load();
  }

  // ── 设置面板 ────────────────────────────────────────
  var el = null;

  function open() {
    build();
    render();
    el.classList.add('show');
  }

  function close() { if (el) el.classList.remove('show'); }

  function build() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'vcfg';
    el.innerHTML =
      '<div class="vcfg-mask" onclick="VCfg.close()"></div>' +
      '<div class="vcfg-box">' +
        '<div class="vcfg-head"><span>设置</span>' +
          '<span class="vcfg-x" onclick="VCfg.close()">&#10005;</span></div>' +
        '<div class="vcfg-body" id="vcfg-body"></div>' +
        '<div class="vcfg-foot">' +
          '<button class="vcfg-reset" onclick="VCfg.resetAll()">恢复默认</button>' +
          '<span class="vcfg-note">改动即时生效, 部分需重开播放器</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
  }

  function num(label, key, min, max, step, unit, tip) {
    var v = get(key);
    return '<div class="vcfg-r">' +
      '<label>' + label + (tip ? '<i>' + tip + '</i>' : '') + '</label>' +
      '<input type="number" min="' + min + '" max="' + max + '" step="' + (step || 1) + '" value="' + v + '" ' +
      'onchange="VCfg.setNum(\'' + key + '\', this.value, ' + min + ', ' + max + ')">' +
      '<span class="vcfg-u">' + (unit || '') + '</span></div>';
  }

  function bool(label, key, tip) {
    var v = get(key);
    return '<div class="vcfg-r">' +
      '<label>' + label + (tip ? '<i>' + tip + '</i>' : '') + '</label>' +
      '<span class="vcfg-sw' + (v ? ' on' : '') + '" onclick="VCfg.toggle(\'' + key + '\')"><i></i></span>' +
      '</div>';
  }

  function pick(label, key, opts, tip) {
    var v = get(key);
    var h = '<div class="vcfg-r"><label>' + label + (tip ? '<i>' + tip + '</i>' : '') + '</label>' +
            '<span class="vcfg-seg">';
    opts.forEach(function (o) {
      h += '<span class="' + (String(v) === String(o[0]) ? 'on' : '') + '" ' +
           'onclick="VCfg.setVal(\'' + key + '\', \'' + o[0] + '\')">' + o[1] + '</span>';
    });
    return h + '</span></div>';
  }

  function render() {
    var b = document.getElementById('vcfg-body');
    if (!b) return;
    b.innerHTML =
      '<div class="vcfg-t">播放器 · 操作</div>' +
      num('快进/快退', 'seekStep', 1, 60, 1, '秒', '← → 方向键') +
      num('大步快进', 'seekBigStep', 5, 300, 5, '秒', 'Shift + 方向键') +
      num('音量步进', 'volStep', 1, 50, 1, '%', '↑ ↓ 方向键') +
      num('逐帧帧率', 'frameStep', 10, 120, 1, 'fps', ', . 逐帧用') +
      pick('双击画面', 'dblAction', [['full', '全屏'], ['play', '播放暂停']]) +

      '<div class="vcfg-t">播放器 · 默认值</div>' +
      num('默认音量', 'defVolume', 0, 100, 5, '%') +
      pick('默认倍速', 'defSpeed', [[0.75, '0.75x'], [1, '1x'], [1.25, '1.25x'], [1.5, '1.5x'], [2, '2x']]) +
      bool('记忆播放位置', 'resumePlay', '下次从上次位置继续') +
      bool('播完自动下一个', 'autoNext') +
      num('控制栏隐藏', 'uiHideDelay', 800, 10000, 200, '毫秒', '静止多久后隐藏') +
      num('预览图宽度', 'previewWidth', 80, 360, 4, 'px', '进度条悬停预览') +

      '<div class="vcfg-t">列表页</div>' +
      num('每页数量', 'pageSize', 20, 200, 10, '个') +
      num('悬停延迟', 'hoverDelay', 0, 3000, 100, '毫秒', '停留多久才开始轮播') +
      num('悬停轮播时长', 'hoverLoop', 2000, 30000, 500, '毫秒', '不论几张都放完这么久') +
      pick('点缩略图', 'cardClick', [['pot', 'PotPlayer'], ['online', '网页播放']]) +
      bool('显示"在线"角标', 'showOnlineTag') +
      bool('滚到底自动加载', 'autoLoad');
    }

  // ── 对外 ────────────────────────────────────────────
  function setNum(k, v, min, max) {
    var n = parseFloat(v);
    if (isNaN(n)) return;
    n = Math.max(min, Math.min(max, n));
    set(k, n);
    apply();
  }
  function toggle(k) { set(k, !get(k)); render(); apply(); }
  function setVal(k, v) {
    var n = parseFloat(v);
    set(k, isNaN(n) ? v : n);
    render(); apply();
  }
  function resetAll() { reset(); render(); apply(); }

  // 通知各处重新读取
  function apply() {
    if (typeof onCfgChange === 'function') { try { onCfgChange(); } catch (e) {} }
  }

  return {
    get: get, set: set, open: open, close: close,
    setNum: setNum, toggle: toggle, setVal: setVal, resetAll: resetAll,
    DEFAULTS: DEFAULTS
  };
})();
