// player.js — 富功能网页播放器（视频标签版）
//
// 特性: 进度条(缓冲显示 + 悬停缩略图预览) / 音量 / 倍速 / 全屏 / 网页全屏 / 画中画
//       逐帧步进 / A-B 循环 / 截图 / 滤镜(亮度对比度饱和度色相翻转旋转) / 记忆播放位置
//       上一个下一个 / 完整快捷键 / 收藏 / 评分 / 手动标签

'use strict';

var VPlayer = (function () {

  // ── 可播性判定: 容器与编码必须同时满足 ──────────────
  var OK_EXT   = ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'ogg'];
  var OK_CODEC = ['h264', 'avc1', 'vp8', 'vp9', 'av1', 'av01', 'theora', ''];
  var MAYBE_CODEC = ['hevc', 'h265', 'hvc1'];

  function extOf(p) {
    var m = String(p || '').match(/\.([A-Za-z0-9]{1,5})$/);
    return m ? m[1].toLowerCase() : '';
  }

  // 2026-09-30: 静态判断(编码/扩展名/web_ready)只能"猜"浏览器能不能播, 猜错的时候(比如VP9的
  // 4K竖屏视频, 编码在白名单里但这台电脑/浏览器实际解不了)卡片上还会一直显示"在线"。
  // 现在浏览器真的报了解码/不支持错误, 就把这个视频记在本浏览器的localStorage里(能力因浏览器而异,
  // 所以记本地不记服务器), canPlay对它直接返回'no', 卡片上的"在线"标签随之消失, 只剩Pot。
  var BAD_KEY = 'vplBadMd5v2';   // v2: 丢掉之前因转换副本404被误记的结果
  function badMap() { try { return JSON.parse(localStorage.getItem(BAD_KEY)) || {}; } catch (e) { return {}; } }
  function isBad(md5) { return !!(md5 && badMap()[md5]); }
  function markBad(md5) {
    if (!md5) return;
    try { var m = badMap(); m[md5] = Date.now(); localStorage.setItem(BAD_KEY, JSON.stringify(m)); } catch (e) {}
  }
  function clearBad(md5) {
    try { var m = badMap(); delete m[md5]; localStorage.setItem(BAD_KEY, JSON.stringify(m)); } catch (e) {}
  }

  function canPlay(v) {
    if (!v || !v.path) return 'no';
    if (v.md5 && isBad(v.md5)) return 'no';
    // nasmgr向导第⑩步(服务端ffprobe检查)的结果: -1 不能播 -> 不显示在线; 2 可能有问题 -> 半亮
    if (v.play_check === -1) return 'no';
    if (v.play_check === 2) return 'maybe';
    if (v.web_ready > 0) return 'yes';
    var e = extOf(v.path);
    if (OK_EXT.indexOf(e) < 0) return 'no';
    var c = String(v.vcodec || '').toLowerCase();
    if (MAYBE_CODEC.indexOf(c) >= 0) return 'maybe';
    if (OK_CODEC.indexOf(c) < 0) return 'no';
    return 'yes';
  }

  function convUrl(v) {
    var m = String(v.path || '').match(/^(\/share\/[^\/]+)(\/.*)?\/([^\/]+)\.[A-Za-z0-9]{1,5}$/);
    if (!m) return null;
    var suffix = v.web_ready === 2 ? '转码' : '换壳';
    var convPath = m[1] + '/转换' + (m[2] || '') + '/' + m[3] + '_' + suffix + '.mp4';
    return '/convfiles' + convPath.replace(/^\/share/, '');
  }

  // 路径里的 # ? % 等字符要按段编码, 否则浏览器把它们当成URL的一部分
  function encPath(p) { return String(p || '').split('/').map(encodeURIComponent).join('/'); }
  function origUrl(v) { return '/original' + encPath(v ? v.path : ''); }

  function srcOf(v) {
    if (v && v.web_ready > 0) {
      var u = convUrl(v);
      if (u) return encPath(u);
    }
    return origUrl(v);
  }

  // ── 内部状态 ────────────────────────────────────────
  var el = null, video = null;
  var cur = null, list = [], idx = -1;
  var triedOriginal = false;   // 转换副本请求失败后, 是否已经退回原文件重试过一次
  var hideTimer = null, seeking = false, _lastSeekTs = 0;
  var SEEK_THROTTLE_MS = 90;   // 2026-09-20: 拖进度条时不要每次touchmove/mousemove都真的seek——
  // 大部分视频还没转码(关键帧间隔长), 一秒钟几十次seek会排队堆积、卡顿跟不上手指。
  // 节流到最多约11次/秒真正seek, 中间用onBarHover的缩略图+时间文字做视觉反馈(不碰currentTime, 很便宜)。
  var abA = null, abB = null;
  var NEUTRAL = { bright: 100, contrast: 100, saturate: 100, hue: 0, sepia: 0, blur: 0, vignette: 0 };
  var filters = { bright: 100, contrast: 100, saturate: 100, hue: 0, sepia: 0, blur: 0, vignette: 0,
                  flipH: false, flipV: false, rotate: 0 };
  var fxPreset = 0, fxPower = 100;
  // 2026-08-13: Ctrl+滚轮局部放大缩小(以鼠标为中心) + 拖动平移, 跟rotate/flip共用同一个transform见applyFx()
  // 用像素偏移量(panX/panY)而不是CSS transform-origin百分比, 避免缩放几次后中心点跑偏
  var zoomScale = 1, panX = 0, panY = 0;

  var PRESETS = [
    { n: '原始',   bright:100, contrast:100, saturate:100, hue:  0, sepia: 0,  blur:0,   vignette: 0  },
    { n: '暖肤',   bright:106, contrast:112, saturate:125, hue: -8, sepia:12,  blur:0,   vignette:10  },
    { n: '蜜色',   bright:108, contrast:115, saturate:135, hue:-12, sepia:18,  blur:0,   vignette:25  },
    { n: '暧昧',   bright:102, contrast:118, saturate:120, hue:-14, sepia:15,  blur:0,   vignette:45  },
    { n: '湿润',   bright:104, contrast:125, saturate:140, hue: -5, sepia: 6,  blur:0,   vignette:20  },
    { n: '柔光',   bright:110, contrast: 95, saturate:118, hue: -6, sepia: 8,  blur:0.5, vignette:15  },
    { n: '电影',   bright: 98, contrast:122, saturate:108, hue:  0, sepia: 4,  blur:0,   vignette:50  },
    { n: '夜色',   bright: 92, contrast:130, saturate:125, hue:-10, sepia:10,  blur:0,   vignette:60  },
    { n: '胶片',   bright:104, contrast:118, saturate: 95, hue:  4, sepia:25,  blur:0,   vignette:40  },
    { n: '冷艳',   bright:102, contrast:114, saturate:115, hue: 12, sepia: 0,  blur:0,   vignette:30  },
    { n: '高对比', bright:100, contrast:145, saturate:130, hue:  0, sepia: 0,  blur:0,   vignette:20  },
    { n: '黑白',   bright:104, contrast:125, saturate:  0, hue:  0, sepia: 0,  blur:0,   vignette:35  }
  ];

  var IS_MOB = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  var SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  var RATING_LABELS = [null, '不好', '普通', '不错', '喜欢', '最爱'];
  var _marks = { favorite: false, rating: 0 };

  function cfg(k) {
    return (typeof VCfg !== 'undefined') ? VCfg.get(k) : null;
  }

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return h ? (h + ':' + pad(m) + ':' + pad(x)) : (m + ':' + pad(x));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escJs(s) { return String(s).replace(/'/g, "\\'"); }
  function shotUrl(md5, n) {
    if (!md5 || md5.length < 2) return '';
    return '/vthumbs/' + md5.slice(0, 2) + '/' + md5 + '_' + (n < 10 ? '0' : '') + n + '.jpg';
  }

  // ── DOM ─────────────────────────────────────────────
  function build() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'vpl';
    el.innerHTML =
      '<div class="vpl-stage" id="vpl-stage">' +
        '<video id="vpl-video" playsinline preload="metadata"></video>' +
        '<div class="vpl-center" id="vpl-center"></div>' +
        '<div class="vpl-spin" id="vpl-spin"></div>' +
        '<div class="vpl-vig" id="vpl-vig"></div>' +
        '<div class="vpl-toast" id="vpl-toast"></div>' +
      '</div>' +
      '<div class="vpl-ui" id="vpl-ui">' +
        '<div class="vpl-top">' +
          '<div class="vpl-tw">' +
            '<div class="vpl-crumb" id="vpl-crumb"></div>' +
            '<div class="vpl-title" id="vpl-title"></div>' +
          '</div>' +
          '<span class="vpl-meta" id="vpl-meta"></span>' +
          '<span class="vpl-b" id="vpl-fav" title="收藏">&#9825;</span>' +
          '<span class="vpl-b vpl-txt" id="vpl-rate" title="评分">评分</span>' +
          '<span class="vpl-b" id="vpl-tag" title="标签 (T)">🏷</span>' +
          '<span class="vpl-b" id="vpl-cfg" title="设置">&#9881;</span>' +
          '<span class="vpl-x" id="vpl-close">&#10005;</span>' +
        '</div>' +
        '<div class="vpl-bottom">' +
          '<div class="vpl-bar" id="vpl-bar">' +
            '<div class="vpl-buf" id="vpl-buf"></div>' +
            '<div class="vpl-ab" id="vpl-ab"></div>' +
            '<div class="vpl-played" id="vpl-played"><i></i></div>' +
            '<div class="vpl-preview" id="vpl-preview"><img id="vpl-pimg" alt=""><span id="vpl-ptime"></span></div>' +
          '</div>' +
          '<div class="vpl-ctrl">' +
            '<span class="vpl-b" id="vpl-prev" title="上一个 (P)">&#9198;</span>' +
            '<span class="vpl-b vpl-play" id="vpl-play" title="播放/暂停 (空格)">&#9654;</span>' +
            '<span class="vpl-b" id="vpl-next" title="下一个 (N)">&#9197;</span>' +
            '<span class="vpl-vol">' +
              '<span class="vpl-b" id="vpl-mute" title="静音 (M)">&#128266;</span>' +
              '<input type="range" id="vpl-volbar" min="0" max="100" value="100">' +
            '</span>' +
            '<span class="vpl-time" id="vpl-time">0:00 / 0:00</span>' +
            '<span class="vpl-spacer"></span>' +
            '<span class="vpl-b vpl-txt" id="vpl-ab-btn" title="A-B 循环 (I 设A / O 设B)">A-B</span>' +
            '<span class="vpl-b vpl-txt" id="vpl-speed" title="倍速">1x</span>' +
            '<span class="vpl-b" id="vpl-fx" title="滤镜">&#127912;</span>' +
            '<span class="vpl-b" id="vpl-pip" title="画中画">&#128250;</span>' +
            '<span class="vpl-b" id="vpl-wide" title="网页全屏 (T)">&#9645;</span>' +
            '<span class="vpl-b" id="vpl-full" title="全屏 (F)">&#9974;</span>' +
          '</div>' +
        '</div>' +
        '<div class="vpl-menu" id="vpl-speedmenu"></div>' +
        '<div class="vpl-menu vpl-fx" id="vpl-fxmenu"></div>' +
        '<div class="vpl-menu vpl-rate" id="vpl-ratemenu"></div>' +
      '</div>';
    document.body.appendChild(el);
    video = $('vpl-video');
    wire();
    return el;
  }

  // ── 事件绑定 ────────────────────────────────────────────
  function wire() {
    $('vpl-close').onclick = close;
    $('vpl-cfg').onclick = function (e) { e.stopPropagation(); if (typeof VCfg !== 'undefined') VCfg.open(); };
    $('vpl-fav').onclick = function (e) { e.stopPropagation(); toggleFav(); };
    $('vpl-tag').onclick = function (e) { e.stopPropagation(); openTagModal(); };

    var _rateHideTimer = null;
    var showRateMenu = function () {
      clearTimeout(_rateHideTimer);
      hideMenus();
      rateMenu($('vpl-ratemenu'));
      $('vpl-ratemenu').classList.add('on');
    };
    var scheduleHideRate = function () {
      clearTimeout(_rateHideTimer);
      _rateHideTimer = setTimeout(function () { $('vpl-ratemenu').classList.remove('on'); }, 220);
    };
    $('vpl-rate').onmouseenter = showRateMenu;
    $('vpl-rate').onmouseleave = scheduleHideRate;
    $('vpl-ratemenu').onmouseenter = function () { clearTimeout(_rateHideTimer); };
    $('vpl-ratemenu').onmouseleave = scheduleHideRate;

    $('vpl-play').onclick  = toggle;
    $('vpl-prev').onclick  = function () { jump(-1); };
    $('vpl-next').onclick  = function () { jump(1); };
    $('vpl-mute').onclick  = function () { video.muted = !video.muted; syncVol(); };
    $('vpl-pip').onclick   = pip;
    $('vpl-wide').onclick  = function () { el.classList.toggle('wide'); };
    $('vpl-full').onclick  = fullscreen;
    $('vpl-ab-btn').onclick = cycleAB;
    $('vpl-speed').onclick = function (e) { e.stopPropagation(); toggleMenu('vpl-speedmenu', speedMenu); };
    $('vpl-fx').onclick    = function (e) { e.stopPropagation(); toggleMenu('vpl-fxmenu', fxMenu); };

    $('vpl-stage').ondblclick = function () { if (cfg('dblAction') === 'play') toggle(); else fullscreen(); };

    $('vpl-volbar').oninput = function () {
      video.volume = this.value / 100;
      video.muted = video.volume === 0;
      syncVol();
      try { localStorage.setItem('vplVol', String(video.volume)); } catch (e) {}
    };

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('progress', drawBuf);
    video.addEventListener('play',  function () { $('vpl-play').innerHTML = '&#10074;&#10074;'; });
    video.addEventListener('pause', function () { $('vpl-play').innerHTML = '&#9654;'; });
    video.addEventListener('waiting', function () { $('vpl-spin').classList.add('on'); });
    video.addEventListener('playing', function () { $('vpl-spin').classList.remove('on'); });
    video.addEventListener('canplay', function () { $('vpl-spin').classList.remove('on'); });
    video.addEventListener('ended', function () { if (cfg('autoNext') !== false && idx >= 0) jump(1); });
    video.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', onMeta);

    var bar = $('vpl-bar');
    var _lastBarPt = null;
    // 拖动过程中一直调onBarHover刷新缩略图+时间文字做视觉反馈(不碰currentTime, 很便宜),
    // 真正的seekAt节流到SEEK_THROTTLE_MS一次; 松手时finalizeSeek()补一次精确的最终位置,
    // 不会因为节流跳过了最后一次移动而停在不精确的地方。
    function throttledSeekAt(pt) {
      _lastBarPt = pt;
      onBarHover(pt);
      var now = Date.now();
      if (now - _lastSeekTs < SEEK_THROTTLE_MS) return;
      _lastSeekTs = now;
      seekAt(pt);
    }
    function finalizeSeek() {
      if (_lastBarPt) { seekAt(_lastBarPt); _lastBarPt = null; }
    }

    bar.addEventListener('mousemove', onBarHover);
    bar.addEventListener('mouseleave', function () { $('vpl-preview').classList.remove('on'); });
    bar.addEventListener('mousedown', function (e) { seeking = true; _lastSeekTs = Date.now(); seekAt(e); });
    document.addEventListener('mousemove', function (e) { if (seeking) throttledSeekAt(e); });
    document.addEventListener('mouseup', function () { if (seeking) finalizeSeek(); seeking = false; });

    // 2026-08-13: 进度条触摸拖拽(手机上原来只能点, 不能拖着走)
    bar.addEventListener('touchstart', function (e) {
      seeking = true;
      _lastSeekTs = Date.now();
      seekAt(e.touches[0]);
      e.stopPropagation();   // 别让画面区域那套滑动/长按手势也跟着触发
      e.preventDefault();
    }, { passive: false });
    bar.addEventListener('touchmove', function (e) {
      if (seeking) throttledSeekAt(e.touches[0]);
      e.stopPropagation();
      e.preventDefault();
    }, { passive: false });
    bar.addEventListener('touchend', function (e) {
      if (seeking) finalizeSeek();
      seeking = false;
      $('vpl-preview').classList.remove('on');
      e.stopPropagation();
    });

    el.addEventListener('mousemove', showUI);
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', function () { hideMenus(); });

    // 2026-08-13: 鼠标滚轮调节音量; 按住Ctrl+滚轮改成以鼠标为中心局部放大缩小(像素偏移量算法,
    // 不用transform-origin百分比 -- 那种算法缩放几次后中心点会跟着画面尺寸变化跑偏)
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.ctrlKey) {
        var rect = getVideoNaturalRect();   // 2026-08-13: 改用视频自己的真实渲染矩形(考虑黑边偏移), 不用外层容器(有黑边时容器跟视频实际画面对不齐, 会导致缩放中心点飘走)
        var mouseX = e.clientX - rect.left;
        var mouseY = e.clientY - rect.top;
        var localX = (mouseX - panX) / zoomScale;
        var localY = (mouseY - panY) / zoomScale;
        var zoomStep = 0.15;
        var newScale = Math.max(1, Math.min(5, zoomScale + (e.deltaY < 0 ? zoomStep : -zoomStep)));
        panX = mouseX - localX * newScale;
        panY = mouseY - localY * newScale;
        zoomScale = newScale;
        if (zoomScale === 1) { panX = 0; panY = 0; }   // 缩回1倍时顺手把偏移也清零, 避免残留
        applyFx();
        flash('缩放 ' + Math.round(zoomScale * 100) + '%');
        return;
      }
      var step = (cfg('volStep') || 10) / 100;
      if (e.deltaY < 0) {
        video.volume = Math.min(1, video.volume + step);
        video.muted = false;
      } else {
        video.volume = Math.max(0, video.volume - step);
      }
      syncVol();
      flash('音量 ' + Math.round(video.volume * 100));
    }, { passive: false });

    // 双击画面重置缩放+平移(单击本来就是"什么都不做", 双击不冲突)
    el.addEventListener('dblclick', function () {
      if (zoomScale !== 1 || panX || panY) {
        zoomScale = 1; panX = 0; panY = 0;
        applyFx();
        flash('已重置缩放');
      }
    });

    // 放大后拖动画面平移(只在zoomScale>1时生效, 不影响正常单击/进度条拖动等其他手势)
    var panDragging = false, panStartX = 0, panStartY = 0, panOrigX = 0, panOrigY = 0;
    video.addEventListener('mousedown', function (e) {
      if (zoomScale <= 1) return;
      panDragging = true;
      panStartX = e.clientX; panStartY = e.clientY;
      panOrigX = panX; panOrigY = panY;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!panDragging) return;
      panX = panOrigX + (e.clientX - panStartX);
      panY = panOrigY + (e.clientY - panStartY);
      applyFx();
    });
    document.addEventListener('mouseup', function () { panDragging = false; });
    // ── 手机触摸手势(2026-08-13加, 2026-09-20加上下滑切换): 横向滑动seek / 长按2倍速 /
    //    竖直滑动切上一个下一个(仿抖音: 上滑=下一个, 下滑=上一个) ──
    var TOUCH_SEEK_LEVELS = [3, 6, 12, 24, 48, 60, 90, 120];   // 2026-08-13: 改成按滑动距离分档, 不再按屏幕宽度比例
    var TOUCH_SEEK_LEVEL_PX = 40;   // 每滑多少像素跳到下一档
    var TOUCH_DRAG_PX = 10;        // 超过这个像素才算"在滑动", 否则算点击
    var TOUCH_VSWIPE_COMMIT_PX = 70;   // 竖直滑动超过这个距离才真的切换, 否则松手不动作
    var TOUCH_LONG_PRESS_MS = 500;
    var TOUCH_DOUBLE_TAP_MS = 300;
    var TOUCH_DOUBLE_TAP_DIST = 60;

    var ts = {
      startX: 0, startY: 0, startVideoTime: 0,
      isDragging: false, isVSwipe: false, isLongPress: false,
      longPressTimer: null, origRate: 1,
      lastTapTime: 0, lastTapX: 0
    };

    function touchSeekTarget(dx) {
      var absDx = Math.abs(dx);
      var levelIdx = Math.min(TOUCH_SEEK_LEVELS.length - 1, Math.floor(absDx / TOUCH_SEEK_LEVEL_PX));
      var seekSec = TOUCH_SEEK_LEVELS[levelIdx];
      var deltaSeconds = dx >= 0 ? seekSec : -seekSec;
      var dur = video.duration || 0;
      return Math.max(0, Math.min(dur, ts.startVideoTime + deltaSeconds));
    }

    el.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        // 2026-08-13: 双指捏合缩放+双指移动平移(跟桌面端Ctrl+滚轮共用zoomScale/panX/panY)
        clearTimeout(ts.longPressTimer);
        ts.isPinching = true;
        ts.isDragging = true;   // 复用这个标记, 阻止松手后误判成单击/双击
        var p0 = e.touches[0], p1 = e.touches[1];
        var pdx = p1.clientX - p0.clientX, pdy = p1.clientY - p0.clientY;
        ts.pinchStartDist = Math.sqrt(pdx * pdx + pdy * pdy);
        ts.pinchStartScale = zoomScale;
        ts.pinchStartPanX = panX;
        ts.pinchStartPanY = panY;
        ts.pinchRect = getVideoNaturalRect();   // 2026-08-13: 手势开始时量一次并缓存, 全程复用(避免每帧强制重排, 也避开黑边偏移问题)
        ts.pinchStartMidX = (p0.clientX + p1.clientX) / 2 - ts.pinchRect.left;
        ts.pinchStartMidY = (p0.clientY + p1.clientY) / 2 - ts.pinchRect.top;
        return;
      }
      if (e.touches.length !== 1) return;
      var t = e.touches[0];
      ts.startX = t.clientX; ts.startY = t.clientY;
      ts.startVideoTime = video.currentTime;
      ts.isDragging = false; ts.isVSwipe = false; ts.isLongPress = false;

      clearTimeout(ts.longPressTimer);
      ts.longPressTimer = setTimeout(function () {
        if (ts.isDragging) return;   // 已经在滑动就不触发长按
        ts.isLongPress = true;
        ts.origRate = video.playbackRate;
        video.playbackRate = 2;
        flash('2× 倍速');
      }, TOUCH_LONG_PRESS_MS);
    }, { passive: true });

    el.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && ts.isPinching) {
        e.preventDefault();
        var p0 = e.touches[0], p1 = e.touches[1];
        var pdx = p1.clientX - p0.clientX, pdy = p1.clientY - p0.clientY;
        var dist = Math.sqrt(pdx * pdx + pdy * pdy);
        var newScale = Math.max(1, Math.min(5, ts.pinchStartScale * (dist / ts.pinchStartDist)));
        var midX = (p0.clientX + p1.clientX) / 2 - ts.pinchRect.left;   // 2026-08-13: 用手势开始时缓存的真实矩形, 不用el(有黑边时会跟视频实际画面对不齐)
        var midY = (p0.clientY + p1.clientY) / 2 - ts.pinchRect.top;
        var localX = (ts.pinchStartMidX - ts.pinchStartPanX) / ts.pinchStartScale;
        var localY = (ts.pinchStartMidY - ts.pinchStartPanY) / ts.pinchStartScale;
        panX = midX - localX * newScale;
        panY = midY - localY * newScale;
        zoomScale = newScale;
        if (zoomScale === 1) { panX = 0; panY = 0; }
        applyFx();
        return;
      }
      if (e.touches.length !== 1) return;
      var t = e.touches[0];
      var dx = t.clientX - ts.startX;
      var dy = t.clientY - ts.startY;

      if (!ts.isDragging && !ts.isVSwipe && Math.abs(dx) > TOUCH_DRAG_PX && Math.abs(dx) > Math.abs(dy)) {
        ts.isDragging = true;
        clearTimeout(ts.longPressTimer);
        if (ts.isLongPress) {
          video.playbackRate = ts.origRate;
          ts.isLongPress = false;
        }
      }
      if (!ts.isDragging && !ts.isVSwipe && Math.abs(dy) > TOUCH_DRAG_PX && Math.abs(dy) > Math.abs(dx)) {
        ts.isVSwipe = true;
        clearTimeout(ts.longPressTimer);
        if (ts.isLongPress) {
          video.playbackRate = ts.origRate;
          ts.isLongPress = false;
        }
      }

      if (ts.isDragging) {
        e.preventDefault();   // 阻止页面跟着滑动
        var target = touchSeekTarget(dx);
        flash(fmt(target) + (dx >= 0 ? ' ▶ +' : ' ◀ ') + fmt(Math.abs(target - ts.startVideoTime)));
      } else if (ts.isVSwipe) {
        e.preventDefault();   // 阻止竖滑带动页面滚动/下拉刷新
        var ready = Math.abs(dy) > TOUCH_VSWIPE_COMMIT_PX;
        flash((dy < 0 ? '↑ 下一个' : '↓ 上一个') + (ready ? ' (松开切换)' : ''));
      }
    }, { passive: false });

    el.addEventListener('touchend', function (e) {
      clearTimeout(ts.longPressTimer);

      if (ts.isPinching) {
        // 2026-08-13: 双指手势结束, 只清标记, 不要走下面的seek提交逻辑(那是给单指滑动用的)
        ts.isPinching = false;
        ts.isDragging = false;
        return;
      }

      if (ts.isLongPress) {
        video.playbackRate = ts.origRate;
        ts.isLongPress = false;
        return;
      }

      if (ts.isDragging) {
        var t = e.changedTouches[0];
        var target = touchSeekTarget(t.clientX - ts.startX);
        video.currentTime = target;
        flash('已跳转到 ' + fmt(target));
        ts.isDragging = false;
        return;
      }

      if (ts.isVSwipe) {
        var t2 = e.changedTouches[0];
        var dy = t2.clientY - ts.startY;
        ts.isVSwipe = false;
        if (Math.abs(dy) > TOUCH_VSWIPE_COMMIT_PX) { if (dy < 0) jump(1); else jump(-1); }
        return;
      }
      // 2026-08-13: 去掉双击快进快退(全屏时体验不好, 改用进度条真实拖拽+滑动分档两种方式替代)
    }, { passive: false });

    el.addEventListener('touchcancel', function () {
      clearTimeout(ts.longPressTimer);
      if (ts.isLongPress) { video.playbackRate = ts.origRate; ts.isLongPress = false; }
      ts.isPinching = false;
      ts.isDragging = false;
      ts.isVSwipe = false;
    });
  }

  // ── 打开 / 关闭 ─────────────────────────────────────
  function open(v, all, i) {
    build();
    cur = v; list = all || [v]; idx = (typeof i === 'number') ? i : 0;
    el.classList.add('show');
    document.body.style.overflow = 'hidden';

    $('vpl-title').textContent = String(v.path || '').split('/').pop();
    renderCrumb(v.path);
    $('vpl-meta').textContent = [
      v.width && v.height ? (v.width + '×' + v.height) : '',
      v.vcodec || '',
      v.size ? (v.size / 1048576 > 1024
        ? (v.size / 1073741824).toFixed(1) + 'GB'
        : Math.round(v.size / 1048576) + 'MB') : ''
    ].filter(Boolean).join('  ·  ');

    loadFx();
    loadMarks();
    abA = abB = null; drawAB();
    var ds = cfg('defSpeed') || 1;
    video.playbackRate = ds;
    $('vpl-speed').textContent = ds + 'x';

    try {
      var vol = parseFloat(localStorage.getItem('vplVol'));
      if (isNaN(vol)) vol = (cfg('defVolume') !== null ? cfg('defVolume') : 100) / 100;
      video.volume = Math.max(0, Math.min(1, vol));
    } catch (e) {}
    syncVol();

    triedOriginal = false;
    video.src = srcOf(v);
    video.load();
    $('vpl-spin').classList.add('on');
    video.play().catch(function () {});
    showUI();
  }

  function getCur() { return cur; }

  function renderCrumb(path) {
    var box = $('vpl-crumb');
    if (!box) return;
    var parts = String(path || '').split('/').filter(Boolean);
    parts.pop();
    var h = '', acc = '';
    parts.forEach(function (seg, i) {
      acc += '/' + seg;
      var clickable = (i >= 2);
      h += (i ? '<i>/</i>' : '') +
           '<span class="' + (clickable ? 'cl' : '') + '"' +
           (clickable ? ' onclick="VPlayer.goDir(\'' + acc.replace(/'/g, "\\'") + '\')"' : '') +
           '>' + esc(seg) + '</span>';
    });
    box.innerHTML = h;
  }

  function goDir(d) {
    close();
    if (typeof pickDir === 'function') pickDir(d);
    else if (typeof window.pickDir === 'function') window.pickDir(d);
  }

  function onMeta() {
    try {
      var k = 'vplPos_' + cur.md5;
      var pos = parseFloat(localStorage.getItem(k));
      if (cfg('resumePlay') !== false && pos > 5 && video.duration && pos < video.duration - 15) {
        video.currentTime = pos;
        flash('已跳到上次位置 ' + fmt(pos));
      }
    } catch (e) {}
    drawBuf();
  }

  function onError() {
    // 2026-09-30查到的真正根因: web_ready>0 的视频播放器一律先请求"转换/"目录里的换壳/转码副本,
    // 可无损修复、换壳替换、转码顶替这些流程做完后, 副本已经被顶替进原位或清掉了(库里约2.2万个视频
    // 的副本已经不在), /convfiles 返回404, 浏览器把404报成"格式不支持"——跟编码根本无关。
    // 所以: 第一次失败如果用的是副本地址, 先退回原文件再试一次, 原文件也失败才算真的播不了。
    if (cur && !triedOriginal && video.currentSrc && video.currentSrc.indexOf('/convfiles/') >= 0) {
      triedOriginal = true;
      video.src = origUrl(cur);
      video.load();
      $('vpl-spin').classList.add('on');
      video.play().catch(function () {});
      return;
    }
    $('vpl-spin').classList.remove('on');
    // 只有"解码失败(3)/格式不支持(4)"才算这个浏览器播不了; 网络抖动(2)/被中断(1)不记
    var code = video && video.error ? video.error.code : 0;
    if (cur && (code === 3 || code === 4)) {
      markBad(cur.md5);
      // 列表里这张卡片的"在线"标签立刻去掉(app.js的refreshCard按canPlay重画)
      try { if (typeof window.refreshCard === 'function' && idx >= 0) window.refreshCard(idx); } catch (e) {}
    }
    $('vpl-center').innerHTML =
      '<div class="vpl-err">浏览器无法播放此格式<br>' +
      '<small>' + esc(cur.vcodec || '未知编码') + ' · ' + esc(extOf(cur.path)) +
      (cur.width && cur.height ? ' · ' + cur.width + '×' + cur.height : '') + '</small><br>' +
      '<button onclick="VPlayer.toPot()">用 PotPlayer 打开</button> ' +
      '<button onclick="VPlayer.close()">关闭</button></div>';
  }

  function close() {
    savePos();
    try { video.pause(); } catch (e) {}
    video.removeAttribute('src');
    video.load();
    el.classList.remove('show', 'wide');
    document.body.style.overflow = '';
    $('vpl-center').innerHTML = '';
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) {} }
  }

  function savePos() {
    if (!cur || !cur.md5 || !video.duration) return;
    try {
      var k = 'vplPos_' + cur.md5;
      if (video.currentTime > 5 && video.currentTime < video.duration - 15) {
        localStorage.setItem(k, String(Math.floor(video.currentTime)));
      } else localStorage.removeItem(k);
    } catch (e) {}
  }

  function jump(d) {
    savePos();
    var n = idx + d;
    if (n < 0 || n >= list.length) { if (d > 0 && window.vNextDir) { window.vNextDir(); return; } flash(d > 0 ? '已是最后一个' : '已是第一个'); return; }
    while (n >= 0 && n < list.length && (canPlay(list[n]) === 'no' || list[n]._deleted)) n += d;   // 2026-10-01: 也跳过已放进回收站的
    if (n < 0 || n >= list.length) { if (d > 0 && window.vNextDir) { window.vNextDir(); return; } flash('没有更多可在线播放的'); return; }
    open(list[n], list, n);
  }

  // ── 进度条 ──────────────────────────────────────────
  function onTime() {
    if (!video.duration) return;
    if (abA !== null && abB !== null && video.currentTime >= abB) video.currentTime = abA;
    $('vpl-played').style.width = (video.currentTime / video.duration * 100) + '%';
    $('vpl-time').textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
    if (Math.floor(video.currentTime) % 5 === 0) savePos();
  }

  function drawBuf() {
    if (!video.duration || !video.buffered.length) return;
    var e2 = video.buffered.end(video.buffered.length - 1);
    $('vpl-buf').style.width = (e2 / video.duration * 100) + '%';
  }

  function barPct(e) {
    var r = $('vpl-bar').getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }

  function seekAt(e) {
    if (!video.duration) return;
    video.currentTime = barPct(e) * video.duration;
  }

  function onBarHover(e) {
    if (!video.duration) return;
    var p = barPct(e);
    var pv = $('vpl-preview');
    var shots = parseInt(cur && cur.shots, 10) || 0;
    if (shots > 0 && cur.md5) {
      var n = Math.max(1, Math.min(shots, Math.round(p * shots) || 1));
      var img = $('vpl-pimg');
      var u = shotUrl(cur.md5, n);
      if (img.getAttribute('src') !== u) img.src = u;
      img.style.display = '';
      img.style.width = (cfg('previewWidth') || 168) + 'px';
    } else {
      $('vpl-pimg').style.display = 'none';
    }
    $('vpl-ptime').textContent = fmt(p * video.duration);
    var r = $('vpl-bar').getBoundingClientRect();
    pv.style.left = Math.max(60, Math.min(r.width - 60, e.clientX - r.left)) + 'px';
    pv.classList.add('on');
  }

  // ── A-B 循环 ────────────────────────────────────────
  function cycleAB() {
    if (abA === null) { abA = video.currentTime; flash('A 点 ' + fmt(abA)); }
    else if (abB === null) {
      abB = video.currentTime;
      if (abB <= abA) { var t = abA; abA = abB; abB = t; }
      flash('B 点 ' + fmt(abB) + ' · 循环中');
    } else { abA = abB = null; flash('已取消循环'); }
    drawAB();
  }

  function drawAB() {
    var d = $('vpl-ab');
    if (abA === null || abB === null || !video.duration) { d.style.display = 'none'; return; }
    d.style.display = '';
    d.style.left  = (abA / video.duration * 100) + '%';
    d.style.width = ((abB - abA) / video.duration * 100) + '%';
    $('vpl-ab-btn').classList.add('on');
  }

  // ── 菜单 ────────────────────────────────────────────
  function hideMenus() {
    if (!el) return;
    $('vpl-speedmenu').classList.remove('on');
    $('vpl-fxmenu').classList.remove('on');
    $('vpl-ratemenu').classList.remove('on');
  }

  function toggleMenu(id, render) {
    var m = $(id), was = m.classList.contains('on');
    hideMenus();
    if (was) return;
    render(m);
    m.classList.add('on');
  }

  function speedMenu(m) {
    m.innerHTML = SPEEDS.map(function (s) {
      return '<div class="vpl-mi' + (video.playbackRate === s ? ' on' : '') +
             '" onclick="VPlayer.setSpeed(' + s + ')">' + s + 'x</div>';
    }).join('');
  }

  function setSpeed(s) {
    video.playbackRate = s;
    $('vpl-speed').textContent = s + 'x';
    hideMenus();
    flash(s + 'x');
  }

  // ── 滤镜 ────────────────────────────────────────────
  function fxMenu(m) {
    var chips = PRESETS.map(function (p, i) {
      return '<span class="vpl-pc' + (fxPreset === i ? ' on' : '') +
             '" onclick="VPlayer.preset(' + i + ')">' + p.n + '</span>';
    }).join('');

    var row = function (label, key, min, max, step, unit) {
      return '<div class="vpl-fxr"><label>' + label + '</label>' +
             '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + filters[key] + '" ' +
             'oninput="VPlayer.setFx(\'' + key + '\', this.value)">' +
             '<span id="fxv-' + key + '">' + filters[key] + (unit || '') + '</span></div>';
    };

    m.innerHTML =
      '<div class="vpl-fxt">预设</div>' +
      '<div class="vpl-pcs">' + chips + '</div>' +
      '<div class="vpl-fxr vpl-pw"><label>强度</label>' +
        '<input type="range" min="0" max="150" step="5" value="' + fxPower + '" ' +
        'oninput="VPlayer.setPower(this.value)">' +
        '<span id="fxv-power">' + fxPower + '%</span></div>' +
      '<div class="vpl-fxt">微调</div>' +
      row('亮度', 'bright', 20, 200, 1, '%') +
      row('对比', 'contrast', 20, 200, 1, '%') +
      row('饱和', 'saturate', 0, 300, 1, '%') +
      row('色相', 'hue', -60, 60, 1, '°') +
      row('暖色', 'sepia', 0, 60, 1, '%') +
      row('暗角', 'vignette', 0, 90, 1, '%') +
      (IS_MOB ? '' : row('柔化', 'blur', 0, 3, 0.1, 'px')) +
      '<div class="vpl-fxb">' +
        '<button onclick="VPlayer.flip(\'H\')">水平翻转</button>' +
        '<button onclick="VPlayer.flip(\'V\')">垂直翻转</button>' +
        '<button onclick="VPlayer.rot()">旋转90</button>' +
        '<button onclick="VPlayer.resetFx(1)">重置</button>' +
      '</div>';
  }

  function preset(i) {
    fxPreset = i;
    applyPreset();
    saveFx();
    var m = $('vpl-fxmenu');
    if (m && m.classList.contains('on')) fxMenu(m);
    flash(PRESETS[i].n);
  }

  function setPower(v) {
    fxPower = parseInt(v, 10);
    var s2 = $('fxv-power');
    if (s2) s2.textContent = fxPower + '%';
    applyPreset();
    saveFx();
    var m = $('vpl-fxmenu');
    if (m && m.classList.contains('on')) {
      ['bright','contrast','saturate','hue','sepia','vignette','blur'].forEach(function (k) {
        var sp = $('fxv-' + k);
        if (sp) sp.textContent = filters[k] + (k === 'hue' ? '°' : (k === 'blur' ? 'px' : '%'));
      });
    }
  }

  function applyPreset() {
    var p = PRESETS[fxPreset] || PRESETS[0];
    var k = fxPower / 100;
    ['bright','contrast','saturate','hue','sepia','vignette','blur'].forEach(function (key) {
      var base = NEUTRAL[key], target = p[key];
      var val = base + (target - base) * k;
      filters[key] = (key === 'blur') ? Math.round(val * 10) / 10 : Math.round(val);
    });
    if (IS_MOB) filters.blur = 0;
    applyFx();
  }

  function setFx(k, v) {
    filters[k] = (k === 'blur') ? parseFloat(v) : parseInt(v, 10);
    var sp = $('fxv-' + k);
    if (sp) sp.textContent = filters[k] + (k === 'hue' ? '°' : (k === 'blur' ? 'px' : '%'));
    applyFx();
    saveFx();
  }

  function flip(d) { if (d === 'H') filters.flipH = !filters.flipH; else filters.flipV = !filters.flipV; applyFx(); }
  function rot() { filters.rotate = (filters.rotate + 90) % 360; applyFx(); }

  function resetFx(notify) {
    fxPreset = 0; fxPower = 100;
    filters = { bright:100, contrast:100, saturate:100, hue:0, sepia:0, blur:0, vignette:0,
                flipH:false, flipV:false, rotate:0 };
    applyFx();
    if (notify) {
      saveFx();
      var m = $('vpl-fxmenu');
      if (m && m.classList.contains('on')) fxMenu(m);
      flash('已重置');
    }
  }

  // 2026-08-13: 拿视频真实渲染的矩形(临时清空transform量一下再恢复, 避开当前缩放状态的干扰,
  // 也考虑到视频带黑边时跟外层容器不完全重合的情况)
  function getVideoNaturalRect() {
    var saved = video.style.transform;
    video.style.transform = 'none';
    var rect = video.getBoundingClientRect();
    video.style.transform = saved;
    return rect;
  }

  function applyFx() {
    if (!video) return;
    video.style.transformOrigin = '0 0';   // 2026-08-13: 固定左上角为缩放基准点, 配合像素偏移量算法(scale默认围绕中心点, 跟我们的算法假设的基准点对不上, 导致缩放时画面飘走)
    var f = [];
    f.push('brightness(' + filters.bright + '%)');
    f.push('contrast(' + filters.contrast + '%)');
    f.push('saturate(' + filters.saturate + '%)');
    if (filters.hue)   f.push('hue-rotate(' + filters.hue + 'deg)');
    if (filters.sepia) f.push('sepia(' + (filters.sepia / 100) + ')');
    if (filters.blur)  f.push('blur(' + filters.blur + 'px)');
    video.style.filter = f.join(' ');

    var t = [];
    // 2026-08-13: 放大平移放最前面(在屏幕坐标系操作), 旋转/翻转放后面(在视频自身坐标系操作), 两者互不干扰
    if (zoomScale !== 1 || panX || panY) {
      t.push('translate(' + panX + 'px,' + panY + 'px)');
      t.push('scale(' + zoomScale + ')');
    }
    if (filters.rotate) t.push('rotate(' + filters.rotate + 'deg)');
    t.push('scaleX(' + (filters.flipH ? -1 : 1) + ')');
    t.push('scaleY(' + (filters.flipV ? -1 : 1) + ')');
    video.style.transform = t.join(' ');

    var vg = $('vpl-vig');
    if (vg) vg.style.opacity = (filters.vignette / 100);
  }

  function saveFx() {
    try { localStorage.setItem('vplFx', JSON.stringify({ p: fxPreset, k: fxPower, f: filters })); } catch (e) {}
  }

  function loadFx() {
    try {
      var d = JSON.parse(localStorage.getItem('vplFx') || 'null');
      if (!d) return;
      fxPreset = d.p || 0;
      fxPower  = (typeof d.k === 'number') ? d.k : 100;
      if (d.f) for (var k in NEUTRAL) if (typeof d.f[k] === 'number') filters[k] = d.f[k];
      if (IS_MOB) filters.blur = 0;
      applyFx();
    } catch (e) {}
  }

  // ── 其它 ────────────────────────────────────────────
  function toggle() { if (video.paused) video.play().catch(function () {}); else video.pause(); }

  function syncVol() {
    $('vpl-volbar').value = Math.round((video.muted ? 0 : video.volume) * 100);
    $('vpl-mute').innerHTML = (video.muted || video.volume === 0) ? '&#128263;' : '&#128266;';
  }

  function fullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    (el.requestFullscreen ? el.requestFullscreen() : Promise.reject()).catch(function () {});
  }

  function pip() {
    if (!document.pictureInPictureEnabled) { flash('浏览器不支持画中画'); return; }
    if (document.pictureInPictureElement) document.exitPictureInPicture();
    else video.requestPictureInPicture().catch(function () { flash('画中画失败'); });
  }

  // ── 收藏 / 评分 ──────────────────────────────────────
  async function loadMarks() {
    _marks = { favorite: false, rating: 0 };
    syncFavBtn();
    if (!cur || !cur.md5) return;
    try {
      var d = await fetch('/api/marks?md5=' + cur.md5).then(function (r) { return r.json(); });
      _marks.favorite = d.favorite === 1;
      _marks.rating = d.rating || 0;
      syncFavBtn();
    } catch (e) {}
  }

  function syncFavBtn() {
    var b = $('vpl-fav');
    if (!b) return;
    b.innerHTML = _marks.favorite ? '&#9829;' : '&#9825;';
    b.classList.toggle('on', _marks.favorite);
  }

  async function toggleFav() {
    if (!cur || !cur.md5) { flash('该视频无 md5, 不支持收藏'); return; }
    try {
      var d = await fetch('/api/marks/toggle-fav', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ md5: cur.md5 })
      }).then(function (r) { return r.json(); });
      if (d.error) { flash('收藏失败: ' + d.error); return; }
      _marks.favorite = d.favorite === 1;
      syncFavBtn();
      flash(_marks.favorite ? '已收藏' : '已取消收藏');
      if (cur) cur.favorite = _marks.favorite;
    } catch (e) { flash('收藏失败'); }
  }

  function rateMenu(m) {
    var h = '';
    for (var i = 1; i <= 5; i++) {
      h += '<div class="vpl-mi' + (_marks.rating === i ? ' on' : '') +
           '" onclick="VPlayer.setRating(' + i + ')">' + RATING_LABELS[i] + '</div>';
    }
    h += '<div class="vpl-mi" style="border-top:1px solid #2a3d55;color:#8aa8c8" onclick="VPlayer.setRating(0)">清除</div>';
    m.innerHTML = h;
  }

  async function setRating(n) {
    if (!cur || !cur.md5) { flash('该视频无 md5, 不支持评分'); return; }
    if (n === _marks.rating) n = 0;
    try {
      var d = await fetch('/api/marks/set', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ md5: cur.md5, rating: n })
      }).then(function (r) { return r.json(); });
      if (d.error) { flash('评分失败: ' + d.error); return; }
      _marks.rating = d.rating;
      _marks.favorite = d.favorite === 1;
      syncFavBtn();
      hideMenus();
      flash(n ? RATING_LABELS[n] : '已清除评分');
      if (cur) cur.rating = _marks.rating;
    } catch (e) { flash('评分失败'); }
  }

  // ── 手动标签 ──────────────────────────────────────
  function openTagModal() {
    if (!cur || !cur.md5) { flash('该视频无 md5，不支持标签'); return; }
    document.getElementById('vpl-tag-modal')?.remove();

    var modal = document.createElement('div');
    modal.id = 'vpl-tag-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center';
    modal.innerHTML =
      '<div style="background:#161d28;border:1px solid #2a3d55;border-radius:12px;padding:20px 24px;min-width:340px;max-width:440px">' +
        '<div id="vpl-tag-title" style="font-size:.9rem;font-weight:700;color:#f0f6ff;margin-bottom:12px;user-select:none">' +
          '🏷 标签管理 <span style="font-size:.68rem;color:#507090;font-weight:400">(可拖动)</span>' +
        '</div>' +
        '<div id="vpl-tag-list" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;min-height:28px">' +
          '<span style="font-size:.72rem;color:#507090">加载中...</span>' +
        '</div>' +
        '<input id="vpl-tag-input" style="width:100%;background:#0f1620;border:1px solid #263548;border-radius:6px;color:#f0f6ff;padding:8px 10px;font-size:.85rem" placeholder="输入新标签，回车添加">' +
        '<div style="display:flex;gap:8px;margin-top:14px">' +
          '<button onclick="submitVideoTag()" style="flex:1;padding:8px;border-radius:6px;background:#40d0ff;color:#000;border:none;cursor:pointer;font-weight:700">添加</button>' +
          '<button onclick="document.getElementById(\'vpl-tag-modal\').remove()" style="flex:1;padding:8px;border-radius:6px;background:transparent;color:#8aa8c8;border:1px solid #2a3d55;cursor:pointer">关闭</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    // 可拖拽
    var box = modal.firstElementChild;
    var handle = document.getElementById('vpl-tag-title');
    makeDraggable(box, handle);

    renderTagList(cur.md5);
    var inp = document.getElementById('vpl-tag-input');
    inp.focus();
    inp.onkeydown = function (e) { if (e.key === 'Enter') submitVideoTag(); };
  }

  function makeDraggable(box, handle) {
    var sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.style.cursor = 'move';
    handle.onmousedown = function (e) {
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      var r = box.getBoundingClientRect();
      ox = r.left; oy = r.top;
      box.style.position = 'fixed';
      box.style.margin = '0';
      box.style.left = ox + 'px';
      box.style.top = oy + 'px';
      e.preventDefault();
    };
    document.onmousemove = function (e) {
      if (!dragging) return;
      box.style.left = (ox + e.clientX - sx) + 'px';
      box.style.top = (oy + e.clientY - sy) + 'px';
    };
    document.onmouseup = function () { dragging = false; };
  }

  async function renderTagList(md5) {
    var list = document.getElementById('vpl-tag-list');
    if (!list) return;
    try {
      var r = await fetch('/api/photo-tags?md5=' + md5);
      var data = await r.json();
      var tags = data.tags || [];
      if (!tags.length) {
        list.innerHTML = '<span style="font-size:.72rem;color:#507090">(暂无标签)</span>';
        return;
      }
      list.innerHTML = tags.map(function (t) {
        var c = (t.source === 'manual') ? '#ffa500' : '#40d0ff';
        return '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:.72rem;' +
          'background:rgba(255,165,0,.12);border:1px solid ' + c + ';color:' + c + ';margin:2px">' +
          esc(t.tag) +
          '<span onclick="VPlayer.deleteVideoTag(\'' + md5 + '\',\'' + escJs(t.tag) + '\',\'' + t.source + '\')" ' +
          'style="cursor:pointer;margin-left:5px;opacity:.6">×</span></span>';
      }).join('');
    } catch (e) {
      list.innerHTML = '<span style="font-size:.72rem;color:#ff5567">加载失败</span>';
    }
  }

  async function submitVideoTag() {
    if (!cur || !cur.md5) return;
    var inp = document.getElementById('vpl-tag-input');
    var tag = (inp?.value || '').trim();
    if (!tag) return;
    try {
      await fetch('/api/photo-tags/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ md5: cur.md5, tag: tag })
      });
      inp.value = '';
      renderTagList(cur.md5);
      flash('已添加标签: ' + tag);
    } catch (e) {
      flash('添加失败: ' + e.message);
    }
  }

  async function deleteVideoTag(md5, tag, source) {
    try {
      await fetch('/api/photo-tags/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ md5: md5, tag: tag, source: source })
      });
      renderTagList(md5);
      flash('已删除标签: ' + tag);
    } catch (e) {
      flash('删除失败: ' + e.message);
    }
  }

  function toPot() {
    // 2026-08-12: 改用HTTP地址而非本地盘符路径, 原因同 app.js 的 playPot() ——
    // PotPlayer的potplayer:协议入口不会对本地路径做%XX解码, 传编码过的盘符路径始终打不开;
    // 单冒号(不带//)是为了不让浏览器把它当"带主机名的URL"解析、避免被自动补上结尾斜杠。
    if (typeof toOriginalUrl !== 'function') { flash('无法生成播放地址'); return; }
    var a = document.createElement('a');
    a.href = 'potplayer:' + toOriginalUrl(cur.path);
    a.style.display = 'none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    flash('已调起 PotPlayer');
  }

  function flash(msg) {
    var t = $('vpl-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.classList.remove('on'); }, 1600);
  }

  function showUI() {
    el.classList.remove('idle');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { if (!video.paused) el.classList.add('idle'); }, cfg('uiHideDelay') || 2600);
  }

  // ── 快捷键 ──────────────────────────────────────────
  function onKey(e) {
    if (!el || !el.classList.contains('show')) return;
    var tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    var k = e.key, handled = true;
    switch (k) {
      case ' ': case 'k': toggle(); break;
      case 'ArrowRight': { var st = e.shiftKey ? (cfg('seekBigStep') || 30) : (cfg('seekStep') || 5); video.currentTime += st; flash('+' + st + 's'); break; }
      case 'ArrowLeft':  { var st2 = e.shiftKey ? (cfg('seekBigStep') || 30) : (cfg('seekStep') || 5); video.currentTime -= st2; flash('-' + st2 + 's'); break; }
      case 'ArrowUp':    video.volume = Math.min(1, video.volume + (cfg('volStep') || 10) / 100); video.muted = false; syncVol(); flash('音量 ' + Math.round(video.volume * 100)); break;
      case 'ArrowDown':  video.volume = Math.max(0, video.volume - (cfg('volStep') || 10) / 100); syncVol(); flash('音量 ' + Math.round(video.volume * 100)); break;
      case 'f': fullscreen(); break;
      case 't': el.classList.toggle('wide'); break;
      case 'm': video.muted = !video.muted; syncVol(); break;
      case 'i': abA = video.currentTime; abB = null; drawAB(); flash('A 点 ' + fmt(abA)); break;
      case 'o': if (abA !== null) { abB = video.currentTime; drawAB(); flash('B 点 ' + fmt(abB)); } break;
      case 'n': jump(1); break;
      case 'p': jump(-1); break;
      case 't': if (!e.ctrlKey && !e.metaKey) { /* 已处理网页全屏 */ } else { handled = false; } break;
      case ',': video.pause(); video.currentTime -= 1 / (cfg('frameStep') || 25); flash('上一帧'); break;
      case '.': video.pause(); video.currentTime += 1 / (cfg('frameStep') || 25); flash('下一帧'); break;
      case 'Escape': close(); break;
      default:
        if (k >= '0' && k <= '9' && video.duration) {
          video.currentTime = video.duration * parseInt(k, 10) / 10;
        } else handled = false;
    }
    if (handled) { e.preventDefault(); showUI(); }
  }

  // ── 导出 ────────────────────────────────────────────
  return {
    open: open,
    close: close,
    canPlay: canPlay,
    clearBad: clearBad,
    getCur: getCur,
    setSpeed: setSpeed,
    setFx: setFx,
    flip: flip,
    rot: rot,
    resetFx: resetFx,
    preset: preset,
    setPower: setPower,
    goDir: goDir,
    toPot: toPot,
    setRating: setRating,
    toggleFav: toggleFav,
    deleteVideoTag: deleteVideoTag,
    submitVideoTag: submitVideoTag
  };
})();