// videoer/js/app.js — 视频库
//
// 数据: /api/photo-tags/photos?mediaType=video  (与照片共用一套接口)
// 评分收藏: /api/marks  (md5 主键, 与照片完全共用)
// 播放: PC -> potplayer:// 协议调起 PotPlayer; 移动端 -> 内嵌 <video>

'use strict';

// ══ 状态 ══════════════════════════════════════════════
var RATING_LABELS = [null, '不好', '普通', '不错', '喜欢', '最爱'];

// NAS 路径 -> Windows 盘符
var SHARE_MAP = [
  ['/share/Person',    'P:'],
  ['/share/Media',     'M:'],
  ['/share/Container', 'X:']
];

// 2026-09-20加: 默认家庭内容, 切到"成人"/"全部"要输密码, 密码对了只在当前浏览器
// 会话(sessionStorage, 关标签页/浏览器就失效)内记住, 不写进localStorage长期免密。
var NONFAMILY_PASSWORD = '1';
function isNonFamilyUnlocked() {
  try { return sessionStorage.getItem('vNonFamilyUnlocked') === '1'; } catch (e) { return false; }
}
function unlockNonFamily() {
  try { sessionStorage.setItem('vNonFamilyUnlocked', '1'); } catch (e) {}
}

// 2026-09-24加: 默认浏览用的文件夹随机种子, 存sessionStorage——同一次浏览器会话内
// 保持不变(翻页顺序稳定, 不重不漏), 关掉标签页/浏览器再打开才会换一批顺序。
// 跟viewer(照片)是同一套机制, key不同避免两个页面互相干扰。
function _getVideoDirSeed() {
  try {
    var s = sessionStorage.getItem('videoer_dir_seed');
    if (!s) { s = String(1 + Math.floor(Math.random() * 999999937)); sessionStorage.setItem('videoer_dir_seed', s); }
    return s;
  } catch (e) { return '1'; }
}

// 成人/家庭分类偏好: 存 localStorage, 刷新页面记住选择。
// 本次会话没解锁过的话, 哪怕localStorage里存的是旧的"成人"/"全部"偏好也不直接采用,
// 一律先按家庭处理, 避免这个功能上线前就选过"全部"的人绕过密码。
function loadCategoryPref() {
  try {
    var v = localStorage.getItem('vCategory') || 'family';
    if (v !== 'family' && !isNonFamilyUnlocked()) return 'family';
    return v;
  } catch (e) { return 'family'; }
}
function saveCategoryPref(v) {
  try { localStorage.setItem('vCategory', v); } catch (e) {}
}

var state = {
  page: 1, loading: false, hasMore: true,
  videos: [], total: 0,
  filter: { q: '', dirPath: '', favorite: false, ratings: [],
            fileName: '', folderName: '', sizeMin: 0, sizeMax: 0, durMin: 0, durMax: 0,
            resBucket: '', tags: [], tagMode: 'or', dateMin: 0, dateMax: 0, watchedOnly: false, sortFields: [] },
  category: loadCategoryPref(),   // 'both' | 'adult' | 'family', 存 localStorage
  stats: null,
  dirsOpen: false,
  shuffleSeed: 0,
  viewMode: (function(){ try { return localStorage.getItem('videoer-view-mode') || 'grid'; } catch(e){ return 'grid'; } })()
};

var IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

function cfg(k) { return (typeof VCfg !== 'undefined') ? VCfg.get(k) : null; }

// 设置变更后重绘列表(供 VCfg 回调)
function onCfgChange() {
  var g = document.getElementById('grid');
  if (g) renderGrid(true);
}

// ══ 工具 ══════════════════════════════════════════════
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function fmtSize(n) {
  if (!n) return '';
  var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)) + u[i];
}

function fmtDur(sec) {
  sec = parseInt(sec, 10) || 0;
  if (!sec) return '';
  var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  return h ? (h + ':' + p2(m) + ':' + p2(s)) : (m + ':' + p2(s));
}

// 缩略图按 md5 直接拼, 不依赖 thumb_path 字段
// 抽帧脚本写的是 vthumbs/<md5前2位>/<md5>_NN.jpg
function shotUrl(md5, n) {
  if (!md5 || md5.length < 2) return '';
  return '/vthumbs/' + md5.slice(0, 2) + '/' + md5 + '_' + (n < 10 ? '0' : '') + n + '.jpg';
}

function baseName(p) { return String(p || '').split('/').pop(); }
function dirName(p)  { return String(p || '').split('/').slice(0, -1).join('/'); }
function extName(p)  { var m = String(p || '').match(/\.([A-Za-z0-9]{1,5})$/); return m ? m[1] : ''; }

function toWinPath(p) {
  var s = String(p || '');
  for (var i = 0; i < SHARE_MAP.length; i++) {
    if (s.indexOf(SHARE_MAP[i][0]) === 0) {
      return SHARE_MAP[i][1] + s.slice(SHARE_MAP[i][0].length).replace(/\//g, '\\');
    }
  }
  return s.replace(/\//g, '\\');
}

// 生成可从外部直接访问的完整播放地址(给 potplayer: 协议用, 详见 playPot/playVideo 里的说明)
// 按路径段各自 encodeURIComponent, 而不是整段 encodeURI, 避免 # ? & 等文件名里常见字符引发URL解析歧义
function toOriginalUrl(p) {
  var segs = String(p || '').split('/').map(function (s) { return encodeURIComponent(s); });
  return location.origin + '/original' + segs.join('/');
}

var _toastTimer = null;
function toast(msg) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2000);
}

// 2026-09-27补: 目录树右键菜单"加入抽帧队列"点了没反应——这个函数之前只在菜单里
// 被调用, 从没被定义过(浏览器控制台里其实一直报ReferenceError, 只是没人点开看过)。
// 对应后端 POST /api/video/queue-dir {path, includeDone}, 把这个目录下所有视频的
// shots重置成0, 排到PC端video_thumbs.ps1下次巡检的待处理队列里。includeDone=true:
// 哪怕这个目录下的视频之前已经抽过帧, 也强制重新排队(用户主动点这个菜单项,
// 就是想手动补救/重新生成, 不应该被"已经做过"挡住)。
//
// 抽帧本身是PC端agent在后台跑的持续过程, 不是"点一下立刻做完"的一次性任务,
// 光弹个toast看不出进度——点了之后打开一个轮询/api/video/progress的小面板,
// 跟"扫描视频入库"共用同一个面板(扫描完如果有新视频, 紧接着也要抽帧, 直接续上看进度)。
function dtwVideoShots(path) {
  fetch('/api/video/queue-dir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path, includeDone: true })
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (j && j.ok) {
      toast('已加入抽帧队列: ' + j.queued + '/' + j.total + ' 个视频');
      openVideoProgress(path, '🎞 抽帧进度: ' + path);
    } else {
      toast('加入抽帧队列失败: ' + ((j && j.error) || '未知错误'));
    }
  }).catch(function (e) { toast('加入抽帧队列失败: ' + e.message); });
}

// 同一个右键菜单里的"扫描视频入库", 也是从来没定义过的死代码。对应后端
// POST /api/video/scan-dir {path}——递归扫这个目录下的视频文件, 新文件插入photos表
// (media_type='video', shots=0默认值, 会被/api/video/pending自动捡起来抽帧, 不用
// 手动再点一次"加入抽帧队列")。扫完如果有新增视频, 直接接上抽帧进度面板——新入库的
// 视频本来就是shots=0, 天然在等着被抽帧, 不用用户再多点一次菜单。
function dtwVideoScan(path) {
  toast('扫描中...');
  fetch('/api/video/scan-dir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: path })
  }).then(function (r) { return r.json(); }).then(function (j) {
    if (j && j.ok) {
      toast('扫描完成: 共' + j.scanned + '个, 新增' + j.added + '个' + (j.note ? '(' + j.note + ')' : ''));
      if (j.added > 0) openVideoProgress(path, '🎞 抽帧进度: ' + path);
    } else {
      toast('扫描失败: ' + ((j && j.error) || '未知错误'));
    }
  }).catch(function (e) { toast('扫描失败: ' + e.message); });
}

// ── 抽帧进度面板(轮询 GET /api/video/progress?dir=xxx) ──────────────
// 跟common/progress-modal.js不是一回事: 那个是给"有明确taskId、跑完就结束"的
// 一次性任务用的; 抽帧是PC端agent持续在后台巡检的常驻队列, 没有taskId、也没有
// "done"这个终态(关掉面板不代表停止处理, 面板只是个可以随时打开看一眼的窗口)。
var _vpmTimer = null;
function _vpmEnsureDom() {
  var modal = document.getElementById('video-progress-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'video-progress-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML =
    '<div style="background:#161d28;border:1px solid #2a3d55;border-radius:14px;padding:20px;width:min(480px,92vw);box-sizing:border-box">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">'
    + '<span id="vpm-title" style="font-size:.92rem;font-weight:700;color:#f0f6ff;word-break:break-all"></span>'
    + '</div>'
    + '<div id="vpm-agent" style="display:none;font-size:.78rem;color:#ffcf40;background:#2a2410;border:1px solid #5a4a10;border-radius:8px;padding:10px;margin-bottom:12px"></div>'
    + '<div id="vpm-body" style="font-size:.82rem;color:#c8dff5">加载中...</div>'
    + '<button id="vpm-close" style="width:100%;padding:10px;border-radius:7px;background:#40d0ff;color:#000;border:none;cursor:pointer;font-weight:700;margin-top:14px">关闭（后台继续处理）</button>'
    + '</div>';
  document.body.appendChild(modal);
  document.getElementById('vpm-close').onclick = closeVideoProgress;
  return modal;
}
function _vpmCopyCmd(btn) {
  var input = btn.parentElement.querySelector('.vpm-cmd');
  if (!input) return;
  input.select();
  navigator.clipboard && navigator.clipboard.writeText(input.value).then(function () {
    toast('已复制命令');
  }).catch(function () { toast('复制失败, 请手动选中复制'); });
}
function openVideoProgress(path, title) {
  var modal = _vpmEnsureDom();
  document.getElementById('vpm-title').textContent = title || '🎞 抽帧进度';
  modal.style.display = 'flex';
  clearInterval(_vpmTimer);
  var tick = function () {
    // 2026-09-27加: PC端video_thumbs.ps1没启动的话, 缩略图队列会一直堆着不动, 用户
    // 光看进度条不知道该干嘛——查一下agent最近有没有来领过任务, 没有就把启动命令
    // 直接摆在面板里, 复制粘贴到PowerShell就行, 不用来回问怎么启动。
    fetch('/api/video/agent-status').then(function (r) { return r.json(); }).then(function (a) {
      var agentEl = document.getElementById('vpm-agent');
      if (!agentEl) return;
      if (a && a.online) {
        agentEl.style.display = 'none';
      } else {
        agentEl.style.display = 'block';
        agentEl.innerHTML =
          '⚠ 没检测到PC端抽帧程序在跑, 队列会一直堆着——在PC上打开PowerShell执行:<br>'
          + '<input class="vpm-cmd" readonly value="' + (a && a.startCmd ? a.startCmd.replace(/"/g, '&quot;') : '') + '" '
          + 'style="width:100%;margin:6px 0;padding:6px;background:#0d1420;color:#3ddc84;border:1px solid #3a4d65;border-radius:5px;font-family:monospace;font-size:.74rem;box-sizing:border-box" '
          + 'onclick="this.select()">'
          + '<button onclick="_vpmCopyCmd(this)" style="padding:5px 10px;border-radius:5px;background:#40d0ff;color:#000;border:none;cursor:pointer;font-size:.74rem">复制命令</button>';
      }
    }).catch(function () {});

    fetch('/api/video/progress?dir=' + encodeURIComponent(path)).then(function (r) { return r.json(); }).then(function (d) {
      var body = document.getElementById('vpm-body');
      if (!body) return;
      var total = d.total || 0, done = d.done || 0, pending = d.pending || 0, failed = d.failed || 0;
      var pct = total ? Math.round(done / total * 100) : 0;
      body.innerHTML =
        '<div style="height:6px;background:#1e2838;border-radius:99px;overflow:hidden;margin-bottom:8px">'
        + '<div style="height:100%;width:' + pct + '%;background:#40d0ff;border-radius:99px;transition:width .4s"></div></div>'
        + '<div>已完成 <b style="color:#3ddc84">' + done + '</b> / ' + total
        + ' · 待处理 <b style="color:#ffcf40">' + pending + '</b>'
        + (failed ? ' · 失败 <b style="color:#ff5567">' + failed + '</b>' : '')
        + '</div>'
        + (pending === 0 && total > 0 ? '<div style="color:#3ddc84;margin-top:6px">✅ 全部处理完毕</div>' : '<div style="color:#507090;margin-top:6px">PC端agent处理中, 每3秒自动刷新...</div>');
    }).catch(function () {});
  };
  tick();
  _vpmTimer = setInterval(tick, 3000);
}
function closeVideoProgress() {
  clearInterval(_vpmTimer);
  var modal = document.getElementById('video-progress-modal');
  if (modal) modal.style.display = 'none';
}

// ══ 播放 ══════════════════════════════════════════════
// 在线播放(浏览器) —— 富播放器
// 2026-08-13: 播放历史上报, 三个播放入口(在线播放/Pot按钮/缩略图默认动作)都调这个
function reportWatched(md5) {
  if (!md5) return;
  fetch('/api/marks/watched', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ md5: md5 })
  }).catch(function () {});
}

function playOnline(idx) {
  var v = state.videos[idx];
  if (!v) return;
  if (typeof VPlayer === 'undefined') { toast('播放器未加载'); return; }
  reportWatched(v.md5);
  VPlayer.open(v, state.videos, idx);
}

// 明确点 Pot 按钮才调起 PotPlayer
function playPot(idx) {
  var v = state.videos[idx];
  if (!v) return;
  reportWatched(v.md5);
  // 2026-08-12: 改用HTTP地址而非本地盘符路径 -- PotPlayer的potplayer:协议入口不会对本地路径做%XX解码,
  // 传编码过的盘符路径始终打不开; 改成网络地址后走PotPlayer标准的"打开网络流"逻辑, 稳定可用(代价是走网络流而非本地直读)
  try {
    var a = document.createElement('a');
    a.href = 'potplayer:' + toOriginalUrl(v.path);
    a.style.display = 'none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast('已调起 PotPlayer');
  } catch (e) { toast('调起失败'); }
}

function playVideo(idx) {
  var v = state.videos[idx];
  if (!v) return;
  // 桌面端可配置点缩略图的默认动作
  if (!IS_MOBILE && cfg('cardClick') === 'online' &&
      typeof VPlayer !== 'undefined' && VPlayer.canPlay(v) !== 'no') {
    reportWatched(v.md5);
    VPlayer.open(v, state.videos, idx);
    return;
  }
  if (IS_MOBILE) {
    // 手机没有 PotPlayer, 能播就用网页播, 不能播只提示
    if (typeof VPlayer !== 'undefined' && VPlayer.canPlay(v) !== 'no') { reportWatched(v.md5); VPlayer.open(v, state.videos, idx); }
    else toast('此格式手机无法播放: ' + (v.vcodec || extName(v.path)));
    return;
  }

  reportWatched(v.md5);
  var url = 'potplayer:' + toOriginalUrl(v.path);   // 2026-08-12: 改用HTTP地址, 原因同 playPot()
  try {
    var a = document.createElement('a');
    a.href = url;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast('已调起 PotPlayer');
  } catch (e) {
    toast('调起失败, 可复制路径手动打开');
  }
}

// 移动端内嵌播放
function openPlayer(v) {
  var box  = document.getElementById('vp');
  var vid  = document.getElementById('vp-video');
  var name = document.getElementById('vp-name');
  var foot = document.getElementById('vp-foot');
  if (!box || !vid) return;

  name.textContent = baseName(v.path);
  vid.src = '/original' + v.path;
  foot.innerHTML = '放不了的格式可用电脑打开 &nbsp;·&nbsp; ' +
                   '<span class="chip ghost" onclick="copyPath(' + v._idx + ')">复制路径</span>';
  box.classList.add('show');
  vid.play().catch(function () { /* 用户手势限制, 让用户自己点 */ });
}

function closePlayer() {
  var box = document.getElementById('vp');
  var vid = document.getElementById('vp-video');
  if (vid) { try { vid.pause(); } catch (e) {} vid.removeAttribute('src'); vid.load(); }
  if (box) box.classList.remove('show');
}

function copyPath(idx) {
  var v = state.videos[idx];
  if (!v) return;
  var win = toWinPath(v.path);
  var done = function () { toast('路径已复制'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(win).then(done, function () { fallbackCopy(win); });
  } else fallbackCopy(win);
}

function fallbackCopy(text) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    toast(ok ? '路径已复制' : '复制失败');
  } catch (e) { toast('复制失败'); }
}

// ══ 加载 ══════════════════════════════════════════════
function buildUrl() {
  var f = state.filter;
  var u = '/api/photo-tags/photos?mediaType=video&limit=' + (cfg('pageSize') || 50) + '&page=' + state.page;
  if (f.q)            u += '&q=' + encodeURIComponent(f.q);
  if (f.dirPath)      u += '&dirPath=' + encodeURIComponent(f.dirPath);
  if (f.favorite)     u += '&favorite=1';
  if (f.ratings.length) u += '&ratings=' + f.ratings.join(',');
  if (f.fileName)     u += '&fileName=' + encodeURIComponent(f.fileName);
  if (f.folderName)   u += '&folderName=' + encodeURIComponent(f.folderName);
  if (f.sizeMin) u += '&minSize=' + f.sizeMin;
  if (f.sizeMax) u += '&maxSize=' + f.sizeMax;
  if (f.durMin)  u += '&minDuration=' + f.durMin;
  if (f.durMax)  u += '&maxDuration=' + f.durMax;
  if (f.dateMin) u += '&minDate=' + f.dateMin;
  if (f.dateMax) u += '&maxDate=' + f.dateMax;
  if (f.watchedOnly) u += '&watchedOnly=1&sortBy=watched';
  if (f.sortFields && f.sortFields.length) {
    u += '&sortFields=' + f.sortFields.map(function (s) { return s.field + ':' + s.dir; }).join(',');
  }
  if (f.resBucket && RES_BUCKET_MAP[f.resBucket]) {
    var rb = RES_BUCKET_MAP[f.resBucket];
    u += '&minWidth=' + rb.minW;
    if (rb.maxW) u += '&maxWidth=' + rb.maxW;
  }
  if (f.tags.length) {
    u += '&tags=' + f.tags.map(encodeURIComponent).join(',') + '&mode=' + f.tagMode + '&manualOnly=1';
  }
  if (state.shuffleSeed) u += '&seed=' + state.shuffleSeed;
  // 2026-09-24加: 跟viewer(照片)统一逻辑——默认浏览(没有任何筛选条件、也没手动点过
  // "随机播放")时, 改成"文件夹随机排序, 文件夹内部顺序不变", 不然默认按时间倒序,
  // 每次打开总是最新那一批视频排最前面。手动shuffleSeed(用户主动点随机播放)优先级更高,
  // 那种情况下不叠加dirSeed。
  var _noFilter = !f.q && !f.dirPath && !f.favorite && !f.ratings.length && !f.fileName &&
    !f.folderName && !f.sizeMin && !f.sizeMax && !f.durMin && !f.durMax && !f.dateMin &&
    !f.dateMax && !f.watchedOnly && !(f.sortFields && f.sortFields.length) &&
    !(f.resBucket && RES_BUCKET_MAP[f.resBucket]) && !f.tags.length;
  if (_noFilter && !state.shuffleSeed) u += '&dirSeed=' + _getVideoDirSeed();
  if (f.dirPath && !state.shuffleSeed && !(f.sortFields && f.sortFields.length)) u += '&sortFields=name:asc';   // 选了目录默认按文件名顺序
  if (state.category && state.category !== 'both') u += '&category=' + state.category;
  return u;
}

// 成人/家庭图标: 点一下切换该项的开关。都关掉时自动回到"两个都选"(等于不筛选),
// 不允许出现"两个都不选"这种什么都看不到的状态。
// 2026-08-16改: 三态单选按钮(成人/家庭/全部), 点哪个就切到哪个, 互斥, 不再是两个独立
// 开关拼state的老逻辑(那种设计下"两个都关掉"这种状态不清晰, 得靠兜底逻辑硬掰回both)
function toggleCategory(which) {
  // 2026-09-20加: 切到"成人"/"全部"要输密码, 家庭一直免密(默认档位, 不应该被拦)
  if (which !== 'family' && !isNonFamilyUnlocked()) {
    var pwd = prompt('切换到"' + (which === 'adult' ? '成人' : '全部') + '"需要输入密码:');
    if (pwd === null) return;   // 用户点了取消, 什么都不做
    if (pwd !== NONFAMILY_PASSWORD) { toast('密码错误'); return; }
    unlockNonFamily();
  }
  state.category = which;   // 'adult' | 'family' | 'both', 直接赋值, 不用再摸两个开关的当前状态推算
  saveCategoryPref(state.category);
  renderCategoryBtns();
  _dirStat = {}; _dirLvlInflight = {}; if (_dirRaw && _dirRaw.length) { var _b = document.getElementById('dirs'); if (_b) _b.innerHTML = ''; initTree(); }   // 目录树按当前分类重建(分类下为空的目录不显示)
  loadVideos(true);
}

function renderCategoryBtns() {
  var cur = state.category;
  var a = document.getElementById('btn-cat-adult');
  var f = document.getElementById('btn-cat-family');
  var b = document.getElementById('btn-cat-both');
  if (a) a.classList.toggle('on', cur === 'adult');
  if (f) f.classList.toggle('on', cur === 'family');
  if (b) b.classList.toggle('on', cur === 'both');
}


// 随机播放: 换一个新种子重新排列当前筛选结果; 再点一次也是重新洗一次牌
function shuffleVideos() {
  state.shuffleSeed = Math.floor(Math.random() * 2147483647) || 1;
  toast('已随机排序');
  loadVideos(true);
}

// 回到固定顺序(时间倒序) —— 仅内部使用, 不再暴露成按钮开关
function unshuffleVideos() {
  state.shuffleSeed = 0;
  loadVideos(true);
}

// 点一下就重新洗一次牌(不是开关)
function onShuffleClick() {
  shuffleVideos();
}


var _videoLoadGen = 0;
// 粗略估算一屏能放几张卡片(格子大小不用很精确, 够用就行)
function _screenVideoCount() {
  var grid = document.getElementById('grid');
  var cellW = 200, cellH = 160;
  var w = (grid && grid.clientWidth) || window.innerWidth || 1200;
  var h = window.innerHeight || 800;
  var cols = Math.max(1, Math.floor(w / cellW));
  var rows = Math.max(2, Math.ceil(h / cellH));
  return Math.max(12, cols * rows);
}

// 连视频列表数据都还没拿到的时候(第一次进这个目录/筛选, 缓存和peek都还没回来那一小段空窗期),
// 网格是全空的, 跟viewer那边一样的问题。先铺一屏"通用骨架卡片"占位, 数据一到就整个替换掉。
function renderVideoSkeletonGrid() {
  var grid = document.getElementById('grid');
  if (!grid || grid.children.length) return;
  var n = _screenVideoCount();
  var html = '';
  for (var i = 0; i < n; i++) html += '<div class="card video-skeleton-only"><div class="card-thumb"></div></div>';
  grid.innerHTML = html;
}

async function loadVideos(reset) {
  if (state.loading) return;
  if (reset) { state.page = 1; state.videos = []; state.hasMore = true; _videoLoadGen++; }
  if (!state.hasMore) return;
  var myGen = _videoLoadGen;   // 切目录/切筛选很快连点时, 丢弃过期请求的结果
  state.loading = true;
  if (reset) {
    var _grid = document.getElementById('grid');
    if (_grid) _grid.innerHTML = '';
    renderVideoSkeletonGrid();
  }

  var more = document.getElementById('more');
  if (more) more.innerHTML = '载入中…';

  var url = buildUrl();

  // 缓存优先(只对切目录/切筛选这种"进新视图"的第一屏做, 只存一屏的量, 不多存)
  var cacheKey = (reset && window.LocalCache) ? LocalCache.key('videoer', 'nas', 'videos1', url) : null;
  var painted = false;
  if (cacheKey) {
    try {
      var cached = await LocalCache.get(cacheKey);
      if (myGen === _videoLoadGen && cached && Array.isArray(cached.videos) && cached.videos.length) {
        state.videos = cached.videos;
        state.total  = cached.total || cached.videos.length;
        renderGrid(true);
        renderStats();
        painted = true;
      }
    } catch (e) {}
  }

  // 没缓存(第一次进这个目录/筛选): 并行发一个"一屏量"的小请求, 谁先回来先画谁, 不要一直空白
  if (reset && !painted) {
    var screenN = _screenVideoCount();
    var peekUrl = url.replace(/([?&])limit=\d+/, '$1limit=' + screenN);
    fetch(peekUrl).then(function (r) { return r.json(); }).then(function (d) {
      if (myGen !== _videoLoadGen) return;
      var grid = document.getElementById('grid');
      if (grid && grid.querySelector('.card:not(.video-skeleton-only), .row')) return; // 真实数据(不是占位骨架)已经先画出来了
      var arr = d.photos || [];
      if (arr.length) {
        state.videos = arr;
        state.total  = d.total || arr.length;
        renderGrid(true);
        renderStats();
      }
    }).catch(function () {});
  }

  try {
    var d = await fetch(url).then(function (r) { return r.json(); });
    if (myGen !== _videoLoadGen) { state.loading = false; return; }
    if (d.error) { toast('加载失败: ' + d.error); state.loading = false; return; }
    var arr = d.photos || [];
    if (reset) { state.videos = arr; } else { arr.forEach(function (v) { state.videos.push(v); }); }
    state.total   = d.total || 0;
    state.hasMore = !!d.hasMore;
    state.page++;
    renderGrid(reset);
    renderStats();
    if (cacheKey) LocalCache.set(cacheKey, { videos: arr.slice(0, _screenVideoCount()), total: state.total });
  } catch (e) {
    toast('加载失败');
    if (more) more.innerHTML = '<button onclick="loadVideos(false)">重试</button>';
  }
  if (myGen === _videoLoadGen) state.loading = false;
}

function renderStats() {
  var el = document.getElementById('stats');
  if (el) el.textContent = '共 ' + state.total + ' 个 / 已显示 ' + state.videos.length;
}

// ══ 渲染 ══════════════════════════════════════════════
// 缩略图提前预取: 跟viewer统一逻辑, rootMargin提前800px开始加载, 不等真正滚进视口。
var _thumbObserver = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (!entry.isIntersecting) return;
    var img = entry.target;
    if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute('data-src'); }
    _thumbObserver.unobserve(img);
  });
}, { rootMargin: '800px 0px' });

function renderGrid(reset) {
  var grid = document.getElementById('grid');
  if (!grid) return;
  if (reset) grid.innerHTML = '';
  grid.classList.toggle('list-mode', state.viewMode === 'list');   // 2026-08-13: 视图切换(缩略图/列表)

  var start = reset ? 0 : (state._renderedCount || 0);   // 2026-10-01: 原来用 grid.children.length, 删除过卡片后追加会错位/重复
  var html = '';
  var renderFn = (state.viewMode === 'list') ? listRowHtml : cardHtml;
  for (var i = start; i < state.videos.length; i++) {
    if (state.videos[i]._deleted) continue;      // 已放进回收站的不再显示(下标保持不变)
    html += renderFn(state.videos[i], i);
  }
  state._renderedCount = state.videos.length;
  grid.insertAdjacentHTML('beforeend', html);
  var _newImgs = grid.querySelectorAll('img[data-src]');
  for (var j = 0; j < _newImgs.length; j++) _thumbObserver.observe(_newImgs[j]);

  var more = document.getElementById('more');
  if (!more) return;
  if (!state.videos.length) {
    more.innerHTML = '没有符合条件的视频';
  } else if (state.hasMore) {
    more.innerHTML = '<button onclick="loadVideos(false)">加载更多</button>';
  } else {
    more.innerHTML = '已全部加载 (' + state.videos.length + ')';
  }
}

function toggleViewMode() {
  state.viewMode = (state.viewMode === 'list') ? 'grid' : 'list';
  try { localStorage.setItem('videoer-view-mode', state.viewMode); } catch (e) {}
  loadVideos(true);
}

// 列表视图: 缩略图在最左, 一行一个视频竖着排(仿Windows 11文件管理器列表视图)
function listRowHtml(v, i) {
  v._idx = i;
  var name = baseName(v.path);
  var dir  = dirName(v.path);
  var r    = v.rating || 0;
  var shots = parseInt(v.shots, 10) || 0;
  var thumb = shots > 0
    ? '<img data-src="' + shotUrl(v.md5, 1) + '" alt="">'
    : '<span class="row-play">▶</span>';

  var resTxt = (v.width && v.height) ? (v.width + '×' + v.height) : '';

  var checkboxHtml2 = state.filter.watchedOnly
    ? '<span class="hist-check' + (historySelected[v.md5] ? ' on' : '') + '" onclick="event.stopPropagation();toggleHistorySelect(\'' + v.md5 + '\')">' + (historySelected[v.md5] ? '☑' : '☐') + '</span>'
    : '';
  var h = '<div class="row" id="c' + i + '" ' +
          'oncontextmenu="event.preventDefault();openVideoMenu(' + i + ', event)">' + checkboxHtml2;
  h += '<div class="row-thumb" onclick="playVideo(' + i + ')">' + thumb + '</div>';
  h += '<div class="row-main">';
  h += '<div class="row-name" title="' + esc(name) + '">' + esc(name) + '</div>';
  h += '<div class="row-dir" onclick="pickDir(\'' + esc(dir).replace(/'/g, "\\'") + '\')">' + esc(dir.split('/').slice(-2).join('/')) + '</div>';
  h += '</div>';
  h += '<div class="row-meta">';
  if (v.duration) h += '<span>' + fmtDur(v.duration) + '</span>';
  if (v.size) h += '<span>' + fmtSize(v.size) + '</span>';
  if (resTxt) h += '<span>' + resTxt + '</span>';
  h += '</div>';
  h += '<div class="row-bar">';
  h += '<span class="fav' + (v.favorite ? ' on' : '') + '" onclick="toggleFav(' + i + ')">' +
       (v.favorite ? '❤' : '♡') + '</span>';
  for (var k = 1; k <= 5; k++) {
    h += '<span class="rt' + (k === r ? ' on' : '') + '" onclick="setRating(' + i + ',' + k + ')" title="' +
         RATING_LABELS[k] + '">' + RATING_LABELS[k] + '</span>';
  }
  h += '</div>';
  h += playBtns(v, i);
  h += '</div>';
  return h;
}

function cardHtml(v, i) {
  v._idx = i;
  var name = baseName(v.path);
  var dir  = dirName(v.path);
  var r    = v.rating || 0;
  var shots = parseInt(v.shots, 10) || 0;
  var thumb = shots > 0
    ? '<img id="t' + i + '" data-src="' + shotUrl(v.md5, 1) + '" alt="">'
    : '<span class="card-play">▶</span>';

  var hoverAttr = shots > 1
    ? ' onmouseenter="shotHover(' + i + ')" onmouseleave="shotLeave(' + i + ')"'
    : '';

  // 瀑布流: 卡片高度按视频真实宽高比展示, 没有元数据(还没抽帧/处理过)的兜底用 16:9,
  // 宽高比过于极端(等宽视频拼接错误等脏数据)也兜底, 避免出现异常瘦高/瘦扁的卡片
  var ratio = '16/9';
  var w = parseInt(v.width, 10), h2 = parseInt(v.height, 10);
  if (w > 0 && h2 > 0) {
    var r2 = w / h2;
    if (r2 >= 0.35 && r2 <= 3) ratio = w + '/' + h2;
  }

  var checkboxHtml = state.filter.watchedOnly
    ? '<span class="hist-check' + (historySelected[v.md5] ? ' on' : '') + '" onclick="event.stopPropagation();toggleHistorySelect(\'' + v.md5 + '\')">' + (historySelected[v.md5] ? '☑' : '☐') + '</span>'
    : '';
  var h = '<div class="card" id="c' + i + '" ' +
          'oncontextmenu="event.preventDefault();openVideoMenu(' + i + ', event)" ' +
          'onmouseenter="removeVideoMenu()">' + checkboxHtml;
  h += '<div class="card-thumb" style="aspect-ratio:' + ratio + '"' + hoverAttr + '>' + thumb +
       '<span class="card-ext">' + esc(extName(v.path)) + '</span>' +
       (v.duration ? '<span class="card-dur">' + fmtDur(v.duration) + '</span>' : '') +
       (v.size ? '<span class="card-size">' + fmtSize(v.size) + '</span>' : '') +
       (shots > 1 ? '<span class="card-bar-i"><i id="p' + i + '"></i></span>' : '') +
       playBtns(v, i) +
       '</div>';
  h += '<div class="card-name" title="' + esc(name) + '">' + esc(name) + '</div>';
  h += '<div class="card-dir" title="' + esc(dir) + '" onclick="pickDir(\'' +
       esc(dir).replace(/'/g, "\\'") + '\')">' + esc(dir.split('/').slice(-2).join('/')) + '</div>';

  h += '<div class="card-bar">';
  h += '<span class="fav' + (v.favorite ? ' on' : '') + '" onclick="toggleFav(' + i + ')">' +
       (v.favorite ? '❤' : '♡') + '</span>';
  for (var k = 1; k <= 5; k++) {
    h += '<span class="rt' + (k === r ? ' on' : '') + '" onclick="setRating(' + i + ',' + k + ')" title="' +
         RATING_LABELS[k] + '">' + RATING_LABELS[k] + '</span>';
  }
  h += '</div></div>';
  return h;
}

// ── 悬停轮播 (修复: 移出时恢复第一帧 + 进度条归零) ──
var _shotTimers = {};
var _hoverDelay = {};

function shotHover(i) {
  clearTimeout(_hoverDelay[i]);
  _hoverDelay[i] = setTimeout(function () { 
    shotStart(i); 
  }, cfg('hoverDelay') || 500);
}

function shotLeave(i) {
  // 清除延迟启动定时器
  clearTimeout(_hoverDelay[i]);
  delete _hoverDelay[i];
  
  // 停止轮播
  shotStop(i);
  
  // 强制恢复第一帧
  var v = state.videos[i];
  var img = document.getElementById('t' + i);
  if (img && v && v.md5 && (parseInt(v.shots, 10) || 0) > 0) {
    img.src = shotUrl(v.md5, 1);
  }
  
  // 进度条归零
  var bar = document.getElementById('p' + i);
  if (bar) bar.style.width = '0%';
  
  delete _previewed[i];
}

function shotStart(i) {
  var v = state.videos[i];
  if (!v) return;
  var total = parseInt(v.shots, 10) || 0;
  if (total < 2) return;
  shotStop(i);
  // 固定总时长约 6 秒掠过全片: 张数多就放快, 但不低于 90ms/张
  var interval = Math.max(90, Math.round((cfg('hoverLoop') || 6000) / total));
  var n = 1;
  _shotTimers[i] = setInterval(function () {
    var img = document.getElementById('t' + i);
    if (!img) { shotStop(i); return; }
    n = n % total + 1;
    img.src = shotUrl(v.md5, n);
    var bar = document.getElementById('p' + i);
    if (bar) bar.style.width = Math.round(n / total * 100) + '%';
  }, interval);
}

function shotStop(i) {
  if (_shotTimers[i]) { 
    clearInterval(_shotTimers[i]); 
    delete _shotTimers[i]; 
  }
}

// 移动端: 点一下先轮播预览, 再点才播放
var _previewed = {};
function thumbTap(i) {
  if (!IS_MOBILE) { playVideo(i); return; }
  if (_previewed[i]) { delete _previewed[i]; shotStop(i); playVideo(i); return; }
  _previewed[i] = 1;
  shotStart(i);
  setTimeout(function () { if (_previewed[i]) { delete _previewed[i]; shotStop(i); } }, 7000);
}

// 播放按钮: 在线(可播时) + PotPlayer, 由用户自己选, 不再默认行为
function playBtns(v, i) {
  var h = '<span class="card-btns">';
  if (typeof VPlayer !== 'undefined' && cfg('showOnlineTag') !== false) {
    var r = VPlayer.canPlay(v);
    if (r !== 'no') {
      h += '<span class="cb cb-on' + (r === 'maybe' ? ' maybe' : '') + '"' +
           ' title="' + (r === 'maybe' ? '可能可播 (HEVC, 取决于系统解码器)' : '浏览器直接播放') + '"' +
           ' onclick="event.stopPropagation();playOnline(' + i + ')">在线</span>';
    }
  }
  if (!IS_MOBILE) {
    h += '<span class="cb cb-pot" title="用 PotPlayer 打开"' +
         ' onclick="event.stopPropagation();playPot(' + i + ')">Pot</span>';
  }
  return h + '</span>';
}

function refreshCard(i) {
  var old = document.getElementById('c' + i);
  if (!old) return;
  if (_shotTimers[i]) { clearInterval(_shotTimers[i]); delete _shotTimers[i]; }
  old.outerHTML = cardHtml(state.videos[i], i);
}

// ══ 评分 / 收藏 ═══════════════════════════════════════
async function setRating(i, n) {
  var v = state.videos[i];
  if (!v || !v.md5) { toast('该视频无 md5'); return; }
  if (n === (v.rating || 0)) n = 0;          // 点已选中的档位 = 取消
  try {
    var d = await fetch('/api/marks/set', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ md5: v.md5, rating: n })
    }).then(function (r) { return r.json(); });
    if (d.error) { toast('评分失败: ' + d.error); return; }
    v.rating = d.rating;
    v.favorite = d.favorite === 1;
    refreshCard(i);
    loadStats();
    toast(n ? RATING_LABELS[n] : '已清除评分');
  } catch (e) { toast('评分失败'); }
}

async function toggleFav(i) {
  var v = state.videos[i];
  if (!v || !v.md5) { toast('该视频无 md5'); return; }
  try {
    var d = await fetch('/api/marks/toggle-fav', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ md5: v.md5 })
    }).then(function (r) { return r.json(); });
    if (d.error) { toast('操作失败: ' + d.error); return; }
    v.favorite = d.favorite === 1;
    refreshCard(i);
    loadStats();
  } catch (e) { toast('操作失败'); }
}

// ══ 筛选栏 ════════════════════════════════════════════
async function loadStats() {
  try { state.stats = await fetch('/api/marks/stats?mediaType=video').then(function (r) { return r.json(); }); }
  catch (e) { state.stats = { favorite: 0, ratings: {} }; }
  renderFilters();
}

function renderFilters() {
  var el = document.getElementById('filters');
  if (!el) return;
  var f = state.filter;
  var st = state.stats || { favorite: 0, ratings: {} };

  var h = '<span class="chip' + (f.favorite ? ' on' : '') + '" onclick="toggleFavFilter()">❤ 收藏' +
          '<small>' + (st.favorite || 0) + '</small></span>';
  h += '<span class="chip' + (f.watchedOnly ? ' on' : '') + '" onclick="toggleWatchedFilter()">🕐 播放历史</span>';
  h += '<span class="sep"></span>';
  for (var i = 1; i <= 5; i++) {
    var cnt = (st.ratings && st.ratings[i]) || 0;
    var on  = f.ratings.indexOf(i) >= 0;
    h += '<span class="chip' + (on ? ' on' : (cnt ? '' : ' dim')) + '" onclick="toggleRating(' + i + ')">' +
         RATING_LABELS[i] + '<small>' + cnt + '</small></span>';
  }
  var rm = ratingMode();
  h += '<span class="chip mode' + (rm === 'multi' ? ' multi' : '') + '"' +
       ' title="点击切换 单选/多选" onclick="toggleRateMode()">' +
       (rm === 'single' ? '单选' : '多选') + '</span>';

  h += '<span class="sep"></span>';
  h += '<span class="chip' + (moreFiltersOpen ? ' on' : '') + '" onclick="toggleMoreFilters()">⚙ 更多筛选</span>';

  if (f.dirPath) {
    h += '<span class="sep"></span>';
    h += '<span class="chip on" onclick="pickDir(\'\')">📁 ' +
         esc(f.dirPath.split('/').slice(-2).join('/')) + ' ✕</span>';
  }
  if (f.q) {
    h += '<span class="chip on" onclick="clearQ()">🔍 ' + esc(f.q) + ' ✕</span>';
  }
  if (f.fileName) {
    h += '<span class="chip on" onclick="clearMfField(\'fileName\')">📄 ' + esc(f.fileName) + ' ✕</span>';
  }
  if (f.folderName) {
    h += '<span class="chip on" onclick="clearMfField(\'folderName\')">📁 ' + esc(f.folderName) + ' ✕</span>';
  }
  if (f.sizeMin || f.sizeMax) {
    h += '<span class="chip on" onclick="resetSizeSlider()">📦 ' + esc(fmtSizeRange(f.sizeMin, f.sizeMax)) + ' ✕</span>';
  }
  if (f.durMin || f.durMax) {
    h += '<span class="chip on" onclick="resetDurSlider()">⏱ ' + esc(fmtDurRange(f.durMin, f.durMax)) + ' ✕</span>';
  }
  if (f.dateMin || f.dateMax) {
    h += '<span class="chip on" onclick="resetDateSlider()">📅 ' + esc(fmtDateRange(f.dateMin, f.dateMax)) + ' ✕</span>';
  }
  if (f.resBucket && RES_BUCKET_MAP[f.resBucket]) {
    h += '<span class="chip on" onclick="setResBucket(\'\')">🖥 ' + esc(RES_BUCKET_MAP[f.resBucket].label) + ' ✕</span>';
  }
  if (f.tags.length) {
    h += '<span class="chip on" onclick="clearVideoTags()">🏷 ' + f.tags.map(esc).join(', ') + ' ✕</span>';
  }

  var hasActive = f.favorite || f.ratings.length || f.dirPath || f.q ||
                  f.fileName || f.folderName || f.sizeMin || f.sizeMax ||
                  f.durMin || f.durMax || f.dateMin || f.dateMax || f.resBucket || f.tags.length || f.watchedOnly;
  if (hasActive) {
    h += '<span class="chip ghost" onclick="clearAll()">清除全部</span>';
  }
  el.innerHTML = h;
  renderSortChips();   // 2026-08-13: 排序区独立在顶部, 跟着筛选栏一起刷新, 保证初始加载和状态变化都能同步
}

function toggleFavFilter() { state.filter.favorite = !state.filter.favorite; renderFilters(); loadVideos(true); }
function toggleWatchedFilter() {
  state.filter.watchedOnly = !state.filter.watchedOnly;
  if (!state.filter.watchedOnly) historySelected = {};
  renderFilters();
  renderHistoryToolbar();
  loadVideos(true);
}

// 评分筛选模式: single(默认) / multi
function ratingMode() {
  try { return localStorage.getItem('vRateMode') || 'single'; } catch (e) { return 'single'; }
}

function toggleRateMode() {
  var m = ratingMode() === 'single' ? 'multi' : 'single';
  try { localStorage.setItem('vRateMode', m); } catch (e) {}
  if (m === 'single' && state.filter.ratings.length > 1) {
    state.filter.ratings = [state.filter.ratings[state.filter.ratings.length - 1]];
    renderFilters(); loadVideos(true);
  } else {
    renderFilters();
  }
  toast(m === 'single' ? '评分筛选: 单选' : '评分筛选: 多选');
}

function toggleRating(n) {
  if (!state.filter.ratings) state.filter.ratings = [];
  var s = state.filter.ratings, i = s.indexOf(n);
  if (ratingMode() === 'single') {
    // 单选: 点已选中的取消, 否则只保留这一个
    state.filter.ratings = (i >= 0) ? [] : [n];
  } else {
    if (i >= 0) s.splice(i, 1); else s.push(n);
    s.sort(function (a, b) { return a - b; });
  }
  renderFilters(); loadVideos(true);
}

function clearQ() {
  state.filter.q = '';
  var q = document.getElementById('q');
  if (q) q.value = '';
  renderFilters(); loadVideos(true);
}

function clearAll() {
  // 2026-08-13: 字段名同步成滑块版本(之前误留着改滑块前的旧字段名sizePreset/durPreset,
  // 点"清除全部"会导致state.filter形状跟renderMoreFilters期待的对不上), 顺带加上日期字段
  state.filter = { q: '', dirPath: '', favorite: false, ratings: [],
                    fileName: '', folderName: '', sizeMin: 0, sizeMax: 0, durMin: 0, durMax: 0,
                    dateMin: 0, dateMax: 0, resBucket: '', tags: [], tagMode: 'or', watchedOnly: false, sortFields: [] };
  var q = document.getElementById('q');
  if (q) q.value = '';
  var fn = document.getElementById('mf-filename');
  if (fn) fn.value = '';
  var dn = document.getElementById('mf-foldername');
  if (dn) dn.value = '';
  renderFilters(); renderDirs();
  if (moreFiltersOpen) renderMoreFilters();
  loadVideos(true);
}

// ══ 目录树 (复用通用控件 DirTreeWidget) ═══════════════
// 控件默认走 /api/dir-tree + /api/dir-stat(照片体系),
// 这里注入 rootsFn/childrenFn/statFn, 改用 /api/photo-tags/dirs 的视频目录数据。
var _dirRaw  = [];       // [{dir, count}] 全路径 + 视频数
var _dirMap  = {};       // path -> {kids:[], own, total}
var _roots   = [];       // 实际存在的根目录, 如 /share/Person /share/Media
var _tree    = null;

// 2026-10-01: 目录树统一成"按数据库逐层取"(与 viewer 同一个接口 /api/dir-tree?media=video): 展开一层请求一层, 只显示库里有视频的目录。
// 原来是一次取整棵树(/api/photo-tags/dirs, 最多6层, 更深的会被并进上一层)再在浏览器里拼, 现在没有层数限制, 数字由服务器算好随目录一起返回。
var _dirStat = {};       // path -> {total, own}  (来自 /api/dir-tree 返回的 count/own)
async function fetchDirLevel(p) {
  var url = '/api/dir-tree?source=nas&media=video' + (state.category && state.category !== 'both' ? '&category=' + state.category : '') + (p ? '&path=' + encodeURIComponent(p) : '');
  var r = await fetch(url).then(function (x) { return x.json(); });
  if (!Array.isArray(r)) return [];
  r.forEach(function (k) { _dirStat[k.path] = { total: k.count || 0, own: k.own || 0 }; });
  return r;
}
var _dirLvlInflight = {};
var _origFetchDirLevel = fetchDirLevel;
fetchDirLevel = function (p) {
  var k = p || '';
  if (_dirLvlInflight[k]) return _dirLvlInflight[k];
  var pr = _origFetchDirLevel(p);
  _dirLvlInflight[k] = pr;
  setTimeout(function () { delete _dirLvlInflight[k]; }, 3000);
  return pr;
};
async function loadDirs() {
  _dirRaw = [1];       // 仅作"已加载"标记(toggleDirs 用)
  initTree();
}

function initTree() {
  var box = document.getElementById('dirs');
  if (!box) return;
  if (typeof DirTreeWidget === 'undefined') {
    box.innerHTML = '<div style="padding:12px;color:#ff5567;font-size:.74rem">' +
                    '目录树控件未加载<br>请确认 index.html 引入了 dir-tree-widget.js</div>';
    return;
  }

  _tree = new DirTreeWidget({
    container:  box,
    instanceId: 'video_' + (state.category || 'both'),
    source:     'nas',
    icons:      { root: '🎬', child: '📁' },
    showRefresh: false,
    rootsFn: async function () {
      // 有多个根(Person / Media / BAK ...)时并列显示; 只有一个根时直接展开它的第一级, 少点一次
      var roots = await fetchDirLevel('');
      if (roots.length > 1) return roots;
      return roots.length ? await fetchDirLevel(roots[0].path) : [];
    },
    childrenFn: function (p) { return fetchDirLevel(p); },
    statFn: async function (p) {
      // 2026-10-01: 目录列表可能先用浏览器缓存渲染出来, 这时本地表里还没有这个目录的视频数, 不能直接当 0(会显示成"空")——先向服务器取它所在的那一层
      if (!_dirStat[p]) { try { await fetchDirLevel(p.slice(0, p.lastIndexOf('/'))); } catch (e) {} }
      var st = _dirStat[p] || { total: 0, own: 0 };
      // 视频页的规则: 没有视频的目录不显示(缓存里的旧目录、后来视频被删/移走的目录都会在这里被隐藏)
      if (!st.total) setTimeout(function () { var ns = document.querySelectorAll('#dirs .dtw-node'); for (var i = 0; i < ns.length; i++) if (ns[i].dataset.path === p) { ns[i].style.display = 'none'; break; } }, 0);
      return st;
    },
    renderStat: function (st) {
      if (!st || !st.total) return '<span style="color:#507090">空</span>';
      return '<span style="color:#40d0ff">' + st.total + '</span>';
    },
    onSelect: function (p) { pickDir(p); },
    contextMenu: function (path) {
      return [
        { icon: '🎬', label: '查看此目录视频', action: function () { pickDir(path); } },
        { sep: true },
        { icon: '🔍', label: '扫描视频入库', action: function () { dtwVideoScan(path); } },
        { icon: '🎞', label: '加入抽帧队列', action: function () { dtwVideoShots(path); } },
        { icon: '🧹', label: '清理孤立记录', action: function () { dtwCleanOrphan(path); } },
      ];
    }
  });
  _tree.init();
  _tree.bind();
}

function toggleDirs() {
  state.dirsOpen = !state.dirsOpen;
  var el  = document.getElementById('dirs');
  var btn = document.getElementById('btn-dirs');
  var mask = document.getElementById('dirs-mask');   // 2026-08-13: 移动端背景遮罩跟目录树同步开关
  if (el)  el.classList.toggle('show', state.dirsOpen);
  if (btn) btn.classList.toggle('on', state.dirsOpen);
  if (mask) mask.classList.toggle('show', state.dirsOpen);
  if (state.dirsOpen && !_dirRaw.length) loadDirs();
  try { localStorage.setItem('videoerDirsOpen', state.dirsOpen ? '1' : '0'); } catch (e) {}
  // 2026-08-13: 目录树刚显示出来时宽度才是真实值, 之前算的拖拽条位置(面板还隐藏, 宽度是0)是错的,
  // 这里显示切换后重新算一次; 用setTimeout等一帧, 确保display:none->block的样式已经生效
  if (typeof syncDirsResizerPos === 'function') setTimeout(syncDirsResizerPos, 0);
}

function pickDir(d) {
  state.filter.dirPath = (state.filter.dirPath === d) ? '' : d;
  renderFilters();
  loadVideos(true);
}

function renderDirs() { /* 由控件自行维护, 此处留空以兼容旧调用 */ }

// ══ 更多筛选(文件名/文件夹名/大小/时长滑块/分辨率/手动标签) ═══════════
var SIZE_SLIDER_MAX_MB = 8192;   // 滑块拉到底代表"不限"(8GB+)
var SIZE_SLIDER_STEP_MB = 50;
var DUR_SLIDER_MAX_MIN = 180;    // 滑块拉到底代表"不限"(3小时+)
var DUR_SLIDER_STEP_MIN = 1;
var SIZE_TICKS = [{v:0,l:'0'},{v:500,l:'500M'},{v:1024,l:'1G'},{v:2048,l:'2G'},{v:4096,l:'4G'},{v:8192,l:'8G+'}];
var DUR_TICKS  = [{v:0,l:'0'},{v:5,l:'5分'},{v:15,l:'15分'},{v:30,l:'30分'},{v:60,l:'1时'},{v:120,l:'2时'},{v:180,l:'3时+'}];

var moreFiltersOpen  = false;
var videoTagList     = [];
var videoTagsLoaded  = false;
var _mfTimer         = null;
var _tSizeMin = null, _tSizeMax = null, _tDurMin = null, _tDurMax = null;
var RES_BUCKET_MAP   = {};   // key -> {key,label,minW,maxW,count}
var RES_BUCKET_LIST  = [];
var resBucketsLoaded = false;

function fmtBytes(n) {
  if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, '') + 'GB';
  return Math.round(n / (1024 * 1024)) + 'MB';
}
function fmtSizeRange(min, max) {
  if (!min && !max) return '不限大小';
  if (min && !max)  return '≥' + fmtBytes(min);
  if (!min && max)  return '≤' + fmtBytes(max);
  return fmtBytes(min) + '-' + fmtBytes(max);
}
function fmtDur(sec) {
  var m = Math.round(sec / 60);
  if (m < 60) return m + '分钟';
  var h = Math.floor(m / 60), r = m % 60;
  return r ? (h + '小时' + r + '分') : (h + '小时');
}
function fmtDurRange(min, max) {
  if (!min && !max) return '不限时长';
  if (min && !max)  return '≥' + fmtDur(min);
  if (!min && max)  return '≤' + fmtDur(max);
  var mm = Math.round(min / 60), mx = Math.round(max / 60);
  if (mm < 60 && mx < 60) return mm + '-' + mx + '分钟';
  return fmtDur(min) + '-' + fmtDur(max);
}

// 生成滑块下方的刻度标签(绝对定位百分比)
function buildTicks(ticks, max) {
  return ticks.map(function (t) {
    var pct = t.v / max * 100;
    return '<span class="mf-tick" style="left:' + pct + '%">' + t.l + '</span>';
  }).join('');
}

function toggleMoreFilters() {
  moreFiltersOpen = !moreFiltersOpen;
  var el = document.getElementById('more-filters');
  var modal = document.getElementById('filter-modal');   // 2026-08-13: 移动端合并模态+遮罩跟着一起开关
  var mask = document.getElementById('filter-mask');
  if (el) el.classList.toggle('show', moreFiltersOpen);
  if (modal) modal.classList.toggle('show', moreFiltersOpen);
  if (mask) mask.classList.toggle('show', moreFiltersOpen);
  renderFilters();
  if (moreFiltersOpen) {
    renderMoreFilters();
    loadDtsScanStatus();
    loadDtsSpeedConfig();
    loadVconvStatus();
    if (!_dtsPollTimer) _dtsPollTimer = setInterval(loadDtsScanStatus, 5000);
    if (!_vconvPollTimer) _vconvPollTimer = setInterval(loadVconvStatus, 5000);
  } else {
    if (_dtsPollTimer) { clearInterval(_dtsPollTimer); _dtsPollTimer = null; }
    if (_vconvPollTimer) { clearInterval(_vconvPollTimer); _vconvPollTimer = null; }
  }
}

function renderMoreFilters() {
  var el = document.getElementById('more-filters');
  if (!el) return;
  var f = state.filter;

  var sizeMinMB = f.sizeMin ? Math.round(f.sizeMin / (1024 * 1024)) : 0;
  var sizeMaxMB = f.sizeMax ? Math.round(f.sizeMax / (1024 * 1024)) : SIZE_SLIDER_MAX_MB;
  var durMinM   = f.durMin  ? Math.round(f.durMin / 60) : 0;
  var durMaxM   = f.durMax  ? Math.round(f.durMax / 60) : DUR_SLIDER_MAX_MIN;

  var sizeTicksHtml = buildTicks(SIZE_TICKS, SIZE_SLIDER_MAX_MB);
  var durTicksHtml  = buildTicks(DUR_TICKS, DUR_SLIDER_MAX_MIN);

  var resChips = '<div class="mf-tagbar" id="res-bucket-bar">' + renderResChipsInner() + '</div>';

  el.innerHTML =
    '<div class="mf-row"><label>文件名</label>' +
      '<input class="mf-input" id="mf-filename" placeholder="文件名关键词…" value="' + esc(f.fileName) + '" oninput="onMfTextInput()"></div>' +
    '<div class="mf-row"><label>文件夹名</label>' +
      '<input class="mf-input" id="mf-foldername" placeholder="文件夹名关键词…" value="' + esc(f.folderName) + '" oninput="onMfTextInput()"></div>' +

    '<div class="mf-row" style="align-items:flex-start"><label style="margin-top:5px">文件大小</label>' +
      '<div style="flex:1">' +
        '<div class="mf-slider-single">' +
          '<div class="mf-slider-single-head"><span>最小</span><span id="size-min-label">' + (f.sizeMin ? esc(fmtBytes(f.sizeMin)) : '不限') + '</span></div>' +
          '<input type="range" class="mf-range-single" id="size-min" min="0" max="' + SIZE_SLIDER_MAX_MB + '" step="' + SIZE_SLIDER_STEP_MB + '" value="' + sizeMinMB + '" oninput="onSizeMinInput()">' +
          '<div class="mf-ticks">' + sizeTicksHtml + '</div>' +
        '</div>' +
        '<div class="mf-slider-single" style="margin-top:14px">' +
          '<div class="mf-slider-single-head"><span>最大</span><span id="size-max-label">' + (f.sizeMax ? esc(fmtBytes(f.sizeMax)) : '不限') + '</span></div>' +
          '<input type="range" class="mf-range-single" id="size-max" min="0" max="' + SIZE_SLIDER_MAX_MB + '" step="' + SIZE_SLIDER_STEP_MB + '" value="' + sizeMaxMB + '" oninput="onSizeMaxInput()">' +
          '<div class="mf-ticks">' + sizeTicksHtml + '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="mf-row" style="align-items:flex-start"><label style="margin-top:5px">时长</label>' +
      '<div style="flex:1">' +
        '<div class="mf-slider-single">' +
          '<div class="mf-slider-single-head"><span>最小</span><span id="dur-min-label">' + (f.durMin ? esc(fmtDur(f.durMin)) : '不限') + '</span></div>' +
          '<input type="range" class="mf-range-single" id="dur-min" min="0" max="' + DUR_SLIDER_MAX_MIN + '" step="' + DUR_SLIDER_STEP_MIN + '" value="' + durMinM + '" oninput="onDurMinInput()">' +
          '<div class="mf-ticks">' + durTicksHtml + '</div>' +
        '</div>' +
        '<div class="mf-slider-single" style="margin-top:14px">' +
          '<div class="mf-slider-single-head"><span>最大</span><span id="dur-max-label">' + (f.durMax ? esc(fmtDur(f.durMax)) : '不限') + '</span></div>' +
          '<input type="range" class="mf-range-single" id="dur-max" min="0" max="' + DUR_SLIDER_MAX_MIN + '" step="' + DUR_SLIDER_STEP_MIN + '" value="' + durMaxM + '" oninput="onDurMaxInput()">' +
          '<div class="mf-ticks">' + durTicksHtml + '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="mf-row" style="align-items:flex-start"><label style="margin-top:5px">拍摄日期</label>' +
      '<div style="flex:1" id="date-slider-container">' + renderDateSliderInner() + '</div>' +
    '</div>' +

    '<div class="mf-row"><label>分辨率</label>' + resChips + '</div>' +

    '<div class="mf-row"><label>DTS巡检</label><div id="dts-scan-status" class="mf-empty">加载中…</div></div>' +
    '<div class="mf-row"><label>巡检速度</label><div id="dts-speed-config" class="mf-empty">加载中…</div></div>' +

    '<div class="mf-row"><label>视频转换</label><div id="vconv-status" class="mf-empty">加载中…</div></div>' +

    '<div class="mf-row" style="align-items:flex-start"><label style="margin-top:5px">标签</label>' +
      '<div style="flex:1">' +
        '<div class="mf-tagbar" id="video-tag-bar"><span class="mf-empty">加载中…</span></div>' +
        '<div style="margin-top:6px">' +
          '<span class="chip mode' + (f.tagMode === 'and' ? ' multi' : '') + '" onclick="setVideoTagMode(\'and\')">且</span> ' +
          '<span class="chip mode' + (f.tagMode === 'or' ? ' multi' : '') + '" onclick="setVideoTagMode(\'or\')">或</span> ' +
          '<span class="chip mode' + (f.tagMode === 'single' ? ' multi' : '') + '" onclick="setVideoTagMode(\'single\')">单选</span>' +
        '</div>' +
      '</div>' +
    '</div>';

  if (!videoTagsLoaded) loadVideoTagBar(); else renderVideoTagBar();
  if (!resBucketsLoaded) loadResolutionBuckets();
}

function onSizeMinInput() {
  var el = document.getElementById('size-min');
  if (!el) return;
  var v = parseInt(el.value, 10) || 0;
  var bytes = v ? v * 1024 * 1024 : 0;
  var lbl = document.getElementById('size-min-label');
  if (lbl) lbl.textContent = v ? fmtBytes(bytes) : '不限';
  clearTimeout(_tSizeMin);
  _tSizeMin = setTimeout(function () {
    state.filter.sizeMin = bytes;
    renderFilters();
    loadVideos(true);
  }, 300);
}

function onSizeMaxInput() {
  var el = document.getElementById('size-max');
  if (!el) return;
  var v = parseInt(el.value, 10) || 0;
  var unlimited = v >= SIZE_SLIDER_MAX_MB;
  var bytes = unlimited ? 0 : v * 1024 * 1024;
  var lbl = document.getElementById('size-max-label');
  if (lbl) lbl.textContent = unlimited ? '不限' : fmtBytes(bytes);
  clearTimeout(_tSizeMax);
  _tSizeMax = setTimeout(function () {
    state.filter.sizeMax = bytes;
    renderFilters();
    loadVideos(true);
  }, 300);
}

function onDurMinInput() {
  var el = document.getElementById('dur-min');
  if (!el) return;
  var v = parseInt(el.value, 10) || 0;
  var sec = v ? v * 60 : 0;
  var lbl = document.getElementById('dur-min-label');
  if (lbl) lbl.textContent = v ? fmtDur(sec) : '不限';
  clearTimeout(_tDurMin);
  _tDurMin = setTimeout(function () {
    state.filter.durMin = sec;
    renderFilters();
    loadVideos(true);
  }, 300);
}

function onDurMaxInput() {
  var el = document.getElementById('dur-max');
  if (!el) return;
  var v = parseInt(el.value, 10) || 0;
  var unlimited = v >= DUR_SLIDER_MAX_MIN;
  var sec = unlimited ? 0 : v * 60;
  var lbl = document.getElementById('dur-max-label');
  if (lbl) lbl.textContent = unlimited ? '不限' : fmtDur(sec);
  clearTimeout(_tDurMax);
  _tDurMax = setTimeout(function () {
    state.filter.durMax = sec;
    renderFilters();
    loadVideos(true);
  }, 300);
}

function resetSizeSlider() {
  state.filter.sizeMin = 0;
  state.filter.sizeMax = 0;
  renderFilters();
  if (moreFiltersOpen) renderMoreFilters();
  loadVideos(true);
}

function resetDurSlider() {
  state.filter.durMin = 0;
  state.filter.durMax = 0;
  renderFilters();
  if (moreFiltersOpen) renderMoreFilters();
  loadVideos(true);
}

function renderResChipsInner() {
  var f = state.filter;
  if (!resBucketsLoaded) return '<span class="mf-empty">加载中…</span>';
  if (!RES_BUCKET_LIST.length) return '<span class="mf-empty">还没有可用的分辨率数据(补录中)</span>';
  return RES_BUCKET_LIST.map(function (b) {
    return '<span class="chip' + (f.resBucket === b.key ? ' on' : '') + '" onclick="setResBucket(\'' + b.key + '\')">' +
           b.label + '<small>' + b.count + '</small></span>';
  }).join('');
}

// 只更新分辨率chip这一小块, 不重绘整个面板 —— 避免异步数据回来时
// 打断用户正在拖动的滑块(跟标签选择器同一套做法, 见 renderVideoTagBar)
function renderResChips() {
  var bar = document.getElementById('res-bucket-bar');
  if (bar) bar.innerHTML = renderResChipsInner();
}

async function loadResolutionBuckets() {
  try {
    var r = await fetch('/api/video/resolution-buckets');
    var list = await r.json();
    RES_BUCKET_LIST = list;
    RES_BUCKET_MAP = {};
    list.forEach(function (b) { RES_BUCKET_MAP[b.key] = b; });
    resBucketsLoaded = true;
  } catch (e) {
    resBucketsLoaded = true;
    RES_BUCKET_LIST = [];
  }
  renderResChips();
}

function setResBucket(key) {
  state.filter.resBucket = (state.filter.resBucket === key) ? '' : key;
  renderFilters();
  renderResChips();
  loadVideos(true);
}

function onMfTextInput() {
  clearTimeout(_mfTimer);
  _mfTimer = setTimeout(function () {
    var fn = document.getElementById('mf-filename');
    var dn = document.getElementById('mf-foldername');
    state.filter.fileName   = fn ? fn.value.trim() : '';
    state.filter.folderName = dn ? dn.value.trim() : '';
    renderFilters();
    loadVideos(true);
  }, 350);
}

function clearMfField(field) {
  state.filter[field] = '';
  var input = document.getElementById(field === 'fileName' ? 'mf-filename' : 'mf-foldername');
  if (input) input.value = '';
  renderFilters();
  loadVideos(true);
}

async function loadVideoTagBar() {
  var bar = document.getElementById('video-tag-bar');
  if (bar) bar.innerHTML = '<span class="mf-empty">加载中…</span>';
  try {
    var r = await fetch('/api/photo-tags/cloud?mediaType=video&manualOnly=1');
    videoTagList = await r.json();
    videoTagsLoaded = true;
  } catch (e) {
    if (bar) bar.innerHTML = '<span class="mf-empty">标签加载失败</span>';
    return;
  }
  renderVideoTagBar();
}

function renderVideoTagBar() {
  var bar = document.getElementById('video-tag-bar');
  if (!bar) return;
  if (!videoTagList.length) { bar.innerHTML = '<span class="mf-empty">暂无手动标签</span>'; return; }
  bar.innerHTML = videoTagList.map(function (t) {
    var active = state.filter.tags.indexOf(t.tag) >= 0;
    return '<span class="chip' + (active ? ' on' : '') + '" onclick="toggleVideoTag(\'' + escJs(t.tag) + '\')">' +
           escHtml(t.tag) + '<small>' + t.cnt + '</small></span>';
  }).join('');
}

function toggleVideoTag(name) {
  var s = state.filter.tags, i = s.indexOf(name);
  if (state.filter.tagMode === 'single') {
    state.filter.tags = (i >= 0) ? [] : [name];
  } else {
    if (i >= 0) s.splice(i, 1); else s.push(name);
  }
  renderFilters();
  renderVideoTagBar();
  loadVideos(true);
}

function clearVideoTags() {
  state.filter.tags = [];
  renderFilters();
  renderVideoTagBar();
  loadVideos(true);
}

function setVideoTagMode(mode) {
  state.filter.tagMode = (['and', 'or', 'single'].indexOf(mode) >= 0) ? mode : 'or';
  if (state.filter.tagMode === 'single' && state.filter.tags.length > 1) {
    state.filter.tags = [state.filter.tags[0]];
  }
  if (moreFiltersOpen) renderMoreFilters();
  renderFilters();
  if (state.filter.tags.length) loadVideos(true);
}

// ══ DTS完整性巡检: 网页启停开关(2026-08-13加) ══════════════
// 真正干活的是PC上常驻的后台助手(DtsScanAgent.ps1), 这里只是改一个开关状态 +
// 轮询显示进度, 网页本身不做任何解码工作
var _dtsPollTimer = null;
var _vconvPollTimer = null;

async function loadVconvStatus() {
  var el = document.getElementById('vconv-status');
  if (!el) return;
  try {
    var r = await fetch('/api/vconv/status');
    var s = await r.json();
    renderVconvStatus(s);
  } catch (e) {
    el.textContent = '状态加载失败';
  }
}

function renderVconvStatus(s) {
  var el = document.getElementById('vconv-status');
  if (!el) return;
  var btn = s.running
    ? '<span class="chip on" onclick="toggleVconv()">■ 停止</span>'
    : '<span class="chip" onclick="toggleVconv()">▶ 启动</span>';
  var curLine = s.current
    ? '<div style="margin-top:4px;font-size:.68rem;color:var(--text3)">正在处理(' +
      (s.current.mode === 'transcode' ? '转码' : '换壳') + '): ' + esc(s.current.path.split('/').pop()) + '</div>'
    : '';
  var failBtn = s.failed
    ? '<span class="chip ghost" onclick="loadVconvFailList()" style="margin-left:6px">查看失败详情</span>'
    : '';
  // 2026-08-17加: 绿/灰圆点, 反映PC端进程是不是真的还活着(靠心跳判断, 不是靠开关状态)
  var dot = '<span class="agent-dot' + (s.agentAlive ? ' alive' : '') + '" title="' +
    (s.agentAlive ? 'PC端进程存活' : 'PC端进程无响应') + '"></span>';
  el.innerHTML = dot +
    (s.running ? '运行中' : '已停止') +
    ' · 换壳 ' + s.remuxDone + '/' + s.remuxTotal +
    ' · 转码 ' + s.transDone + '/' + s.transTotal +
    (s.failed ? (' · 失败 ' + s.failed) : '') +
    ' &nbsp; ' + btn + failBtn + curLine +
    '<div id="vconv-fail-list"></div>';
}

async function loadVconvFailList() {
  var el = document.getElementById('vconv-fail-list');
  if (!el) return;
  el.innerHTML = '<span class="mf-empty">加载中…</span>';
  try {
    var r = await fetch('/api/vconv/fail-list');
    var d = await r.json();
    if (!d.items.length) { el.innerHTML = '<span class="mf-empty">没有失败记录</span>'; return; }
    el.innerHTML = '<div style="margin-top:6px;max-height:200px;overflow-y:auto;font-size:.68rem;color:var(--text3)">' +
      d.items.map(function (it) {
        return '<div style="margin-bottom:4px;padding:4px 6px;background:rgba(255,255,255,.04);border-radius:4px">' +
               esc(it.path.split('/').pop()) + '<br>' +
               '<span style="color:#ff8080">' + esc(it.vconv_error || '(暂无详细原因, 可能是补丁部署前的旧失败记录)') + '</span>' +
               '</div>';
      }).join('') + '</div>';
  } catch (e) {
    el.innerHTML = '<span class="mf-empty">加载失败</span>';
  }
}

async function toggleVconv() {
  try {
    var r0 = await fetch('/api/vconv/status');
    var cur = await r0.json();
    var action = cur.running ? 'stop' : 'start';
    var r = await fetch('/api/vconv/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action })
    });
    await r.json();
    toast(action === 'start' ? '已启动转换(需要PC端后台助手在运行)' : '已停止转换');
    loadVconvStatus();
  } catch (e) {
    toast('操作失败');
  }
}

async function loadDtsScanStatus() {
  var el = document.getElementById('dts-scan-status');
  if (!el) return;
  try {
    var r = await fetch('/api/video/dts-scan/status');
    var s = await r.json();
    renderDtsScanStatus(s);
  } catch (e) {
    el.textContent = '状态加载失败';
  }
}

function renderDtsScanStatus(s) {
  var el = document.getElementById('dts-scan-status');
  if (!el) return;
  var pct = s.total ? Math.round(s.checked / s.total * 100) : 0;
  var btn = s.running
    ? '<span class="chip on" onclick="toggleDtsScan()">■ 停止</span>'
    : '<span class="chip" onclick="toggleDtsScan()">▶ 启动</span>';
  var curNames = (s.current || []).map(function (c) {
    return esc(c.path.split('/').pop());
  });
  var curLine = curNames.length
    ? '<div style="margin-top:4px;font-size:.68rem;color:var(--text3)">正在处理: ' + curNames.join(', ') + '</div>'
    : '';
  // 2026-08-17加: 绿/灰圆点, 反映PC端进程是不是真的还活着(靠心跳判断, 不是靠开关状态)
  var dot = '<span class="agent-dot' + (s.agentAlive ? ' alive' : '') + '" title="' +
    (s.agentAlive ? 'PC端进程存活' : 'PC端进程无响应') + '"></span>';
  el.innerHTML = dot +
    (s.running ? '运行中' : '已停止') + ' · 已查 ' + s.checked + '/' + s.total + ' (' + pct + '%)' +
    ' · 发现问题 ' + s.bad + ' 个 &nbsp; ' + btn + curLine;
}

async function toggleDtsScan() {
  try {
    var r0 = await fetch('/api/video/dts-scan/status');
    var cur = await r0.json();
    var action = cur.running ? 'stop' : 'start';
    var r = await fetch('/api/video/dts-scan/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action })
    });
    var d = await r.json();
    toast(action === 'start' ? '已启动巡检(需要PC端后台助手在运行)' : '已停止巡检');
    loadDtsScanStatus();
  } catch (e) {
    toast('操作失败');
  }
}

// ══ 启动 ══════════════════════════════════════════════
var _qTimer = null;
document.addEventListener('DOMContentLoaded', function () {
  var q = document.getElementById('q');
  if (q) {
    q.addEventListener('input', function () {
      clearTimeout(_qTimer);
      _qTimer = setTimeout(function () {
        state.filter.q = q.value.trim();
        renderFilters();
        loadVideos(true);
      }, 350);
    });
  }

  // 滚到底自动加载
  window.addEventListener('scroll', function () {
    if (state.loading || !state.hasMore) return;
    if (cfg('autoLoad') === false) return;
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) loadVideos(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePlayer();
  });

  loadStats();
  loadDirs();
  // 2026-10-01: 电脑(宽屏)上打开时目录树默认直接展开, 不用再点按钮; 手机/窄屏仍然收起。
  // 你手动收起过(记在 localStorage)就尊重你的选择, 下次不再自动展开。
  try {
    if (window.innerWidth > 900 && localStorage.getItem('videoerDirsOpen') !== '0' && !state.dirsOpen) toggleDirs();
  } catch (e) {}
  renderCategoryBtns();
  state.shuffleSeed = Math.floor(Math.random() * 2147483647) || 1;   // 每次打开页面自动换一批顺序
  loadVideos(true);
});

// ── 移除右键菜单 ──────────────────────────────────────
function removeVideoMenu() {
  var menus = document.querySelectorAll('.video-ctx-menu');
  menus.forEach(function(menu) {
    menu.remove();
  });
  if (typeof ctxMenu !== 'undefined' && ctxMenu.hide) {
    ctxMenu.hide();
  }
}

// ── 视频右键菜单 ──────────────────────────────────────
function openVideoMenu(idx, e) {
  var v = state.videos[idx];
  if (!v) return;

  var items = [
    { icon: "▶️",  text: "播放", action: function() { playVideo(idx); } },
    { sep: true },
    { icon: "🏷",  text: "编辑标签", action: function() { openTagModal(v); } },
    { icon: "❤️", text: v.favorite ? "取消收藏" : "收藏", action: function() { toggleFav(idx); } },
    { icon: "🩺",  text: "检测能否播放", action: function() { requestDtsCheck(idx); } },
    { icon: "🔄",  text: "转换成可播放格式", action: function() { requestConvert(idx); } },
    { icon: "⚙️",  text: "转码（电脑GPU，生成转码副本）", action: function() { requestTranscode(idx); } },
    { sep: true },
    { icon: "📋",  text: "复制路径", action: function() { copyPath(idx); } },
    { sep: true },
    { icon: "🗑",  text: "放入回收站", action: function() { softDeleteVideo(idx); } },
  ];

  // 复用图片页的右键菜单组件
  if (typeof ctxMenu !== 'undefined') {
    ctxMenu.show(e.clientX, e.clientY, items);
  } else {
    showSimpleMenu(e.clientX, e.clientY, items);
  }
}

// 2026-09-30: 逻辑删除。只给这条记录打 pending_delete=1 的标记(沿用 /api/photos/soft-delete),
// 不动任何文件——视频立刻从视频库列表里消失, 去 /videoer/trash.html 回收站里恢复、导出物理删除清单。
async function softDeleteVideo(idx) {
  var v = state.videos[idx];
  if (!v || !v.id) { toast('该视频没有 id, 删不了'); return; }
  try {
    var r = await fetch('/api/photos/soft-delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [v.id] })
    }).then(function (x) { return x.json(); });
    if (!r || !r.ok) { toast('逻辑删除失败: ' + ((r && r.error) || '未知错误')); return; }
    var el = document.getElementById('c' + idx);
    if (el) el.remove();
    v._deleted = true;   // 数组下标保持不变(别的卡片的下标还指着它), 只是不再显示
    toast('已放入回收站（右上角"🗑 回收站"可恢复）');
  } catch (e) { toast('逻辑删除失败: ' + e.message); }
}

// 简易右键菜单（如果 ctxMenu 未加载）
function showSimpleMenu(x, y, items) {
  document.querySelector('.video-ctx-menu')?.remove();

  var menu = document.createElement('div');
  menu.className = 'video-ctx-menu';
  menu.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;' +
    'background:#1e2838;border:1px solid #2a3d55;border-radius:8px;' +
    'padding:4px 0;z-index:99999;min-width:150px;box-shadow:0 4px 16px rgba(0,0,0,.5)';

  var filtered = items.filter(function(it) { return !it.sep; });
  menu.innerHTML = items.map(function(it) {
    if (it.sep) return '<div style="border-top:1px solid #2a3d55;margin:4px 8px"></div>';
    return '<div class="vmi" style="padding:8px 16px;cursor:pointer;font-size:.82rem;color:#c8dff5" ' +
      'onmouseover="this.style.background=\'#2a3d55\'" onmouseout="this.style.background=\'transparent\'">' +
      it.icon + ' ' + it.text + '</div>';
  }).join('');

  document.body.appendChild(menu);

  menu.querySelectorAll('.vmi').forEach(function(el, i) {
    var action = filtered[i]?.action;
    el.onclick = function() {
      if (action) action();
      menu.remove();
    };
  });

  var close = function(ev) {
    if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); }
  };
  setTimeout(function() { document.addEventListener('click', close); }, 10);
}

// ── 单个视频"立刻检测能否播放"(右键菜单用, DTS 流完整性检查, 插队到检测队列) ──
// 真正干活的是 PC 端常驻的 DtsScanAgent.ps1, 检测结果(dts_bad)会影响转换时
// 选"换壳"还是"转码"。这里只管插队, 结果要过一会儿(PC端处理完)才会体现,
// 想看结果就重新打开这个视频的右键菜单/详情, 或者过会儿再点一次转换。
async function requestDtsCheck(idx) {
  var v = state.videos[idx];
  if (!v || !v.md5) { toast('该视频无 md5，没法检测'); return; }
  try {
    var r = await fetch('/api/video/dts-check-priority', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ md5: v.md5 }),
    });
    var data = await r.json();
    if (!r.ok) { toast(data.error || '插队失败'); return; }
    toast('已插队检测，等 PC 端处理（需要电脑上的 DtsScanAgent 在跑）');
  } catch (e) {
    toast('请求失败: ' + e.message);
  }
}

// ── 单个视频"加入转换队列"(右键菜单用) ──
// 真正干活的是 PC 端常驻的 VconvAgent.ps1, 这里只是把它排进队列、顺手把开关打开。
// 队列列表 + 每个视频的实时状态在专门的转换页面看(/videoer/convert.html)。
async function requestConvert(idx) {
  var v = state.videos[idx];
  if (!v || !v.md5) { toast('该视频无 md5，没法转换'); return; }
  try {
    var r = await fetch('/api/vconv/priority', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ md5: v.md5 }),
    });
    var data = await r.json();
    if (!r.ok) { toast(data.error || '加入队列失败'); return; }
    if (data.alreadyOk) { toast('这个视频本来就能直接播,不用转换'); return; }
    if (data.alreadyQueued) { toast('已经在队列里了，去"转换队列"页面看进度'); return; }
    toast((data.mode === 'transcode' ? '已加入队列(转码,较慢)' : '已加入队列(换壳,很快)') + '，去"转换队列"页面看进度');
  } catch (e) {
    toast('请求失败: ' + e.message);
  }
}

// 2026-09-30: 右键"转码": 强制走转码(不按格式自动判断)。超过6GB默认不转, 确认后才 force。
async function requestTranscode(idx) {
  var v = state.videos[idx];
  if (!v || !v.md5) { toast('该视频无 md5，没法转码'); return; }
  var force = false;
  if (v.size > 6e9) {
    if (!confirm('这个视频超过 6GB，按规则默认不转码。仍要转码吗？')) return;
    force = true;
  }
  try {
    var r = await fetch('/api/vconv/priority', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ md5: v.md5, transcode: true, force: force }) });
    var data = await r.json();
    if (!r.ok) { toast(data.error || '加入队列失败'); return; }
    if (data.alreadyQueued) { toast('已经在转码队列里了，去"转换队列"页面看进度'); return; }
    toast('已加入转码队列（需要电脑上的 VconvAgent 在跑），去"转换队列"页面看进度');
  } catch (e) { toast('请求失败: ' + e.message); }
}

// ── 视频标签弹窗 ──────────────────────────────────────
function openTagModal(v) {
  var md5 = v.md5;
  if (!md5) { toast('该视频无 md5，不支持标签'); return; }

  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = 
    '<div style="background:#161d28;border:1px solid #2a3d55;border-radius:12px;padding:20px 24px;min-width:340px;max-width:440px">' +
      '<div style="font-size:.9rem;font-weight:700;color:#f0f6ff;margin-bottom:12px">🏷 编辑标签</div>' +
      '<div id="vtag-list" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;min-height:28px">加载中...</div>' +
      '<input id="vtag-input" style="width:100%;background:#0f1620;border:1px solid #263548;border-radius:6px;color:#f0f6ff;padding:8px 10px;font-size:.85rem" placeholder="输入标签，回车添加">' +
      '<div style="display:flex;gap:8px;margin-top:14px">' +
        '<button onclick="submitVTag(\'' + md5 + '\')" style="flex:1;padding:8px;border-radius:6px;background:#40d0ff;color:#000;border:none;cursor:pointer;font-weight:700">添加</button>' +
        '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="flex:1;padding:8px;border-radius:6px;background:transparent;color:#8aa8c8;border:1px solid #2a3d55;cursor:pointer">关闭</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  loadVTags(md5);

  var inp = overlay.querySelector('#vtag-input');
  inp.focus();
  inp.onkeydown = function(e) { if (e.key === 'Enter') submitVTag(md5); };
}

async function loadVTags(md5) {
  var list = document.getElementById('vtag-list');
  if (!list) return;
  try {
    var r = await fetch('/api/photo-tags?md5=' + md5);
    var data = await r.json();
    var tags = data.tags || [];
    if (!tags.length) {
      list.innerHTML = '<span style="font-size:.72rem;color:#507090">(暂无标签)</span>';
      return;
    }
    list.innerHTML = tags.map(function(t) {
      var color = t.source === 'manual' ? '#ffa500' : '#40d0ff';
      return '<span style="padding:3px 10px;border-radius:12px;font-size:.72rem;background:rgba(255,165,0,.12);border:1px solid ' + color + ';color:' + color + ';margin:2px">' +
        escHtml(t.tag) +
        '<span onclick="deleteVTag(\'' + md5 + '\',\'' + escJs(t.tag) + '\',\'' + t.source + '\')" style="cursor:pointer;margin-left:5px;opacity:.6">×</span>' +
      '</span>';
    }).join('');
  } catch (e) {
    list.innerHTML = '<span style="font-size:.72rem;color:#ff5567">加载失败</span>';
  }
}

async function submitVTag(md5) {
  var inp = document.getElementById('vtag-input');
  var tag = (inp?.value || '').trim();
  if (!tag) return;
  try {
    await fetch('/api/photo-tags/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ md5: md5, tag: tag })
    });
    inp.value = '';
    loadVTags(md5);
    toast('已添加标签: ' + tag);
  } catch (e) {
    toast('添加失败: ' + e.message);
  }
}

async function deleteVTag(md5, tag, source) {
  try {
    await fetch('/api/photo-tags/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ md5: md5, tag: tag, source: source })
    });
    loadVTags(md5);
    toast('已删除标签: ' + tag);
  } catch (e) {
    toast('删除失败: ' + e.message);
  }
}

// 工具函数
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escJs(s) { return String(s).replace(/'/g,"\\'"); }

// 2026-08-16加: DTS巡检速度设置(网页上直接调, PC端脚本每一批任务会自动读取最新值)
async function loadDtsSpeedConfig() {
  var el = document.getElementById('dts-speed-config');
  if (!el) return;
  try {
    var r = await fetch('/api/video/dts-scan/speed-config');
    var s = await r.json();
    el.innerHTML =
      '并行数 <input type="number" id="dts-speed-parallel" min="1" max="10" value="' + s.maxParallel + '" style="width:48px">' +
      '  每实例线程 <input type="number" id="dts-speed-threads" min="1" max="8" value="' + s.ffmpegThreads + '" style="width:48px">' +
      '  <span class="chip" onclick="applyDtsSpeedConfig()">应用</span>' +
      '  <span style="font-size:.65rem;color:var(--text3)">(改完最多等几秒下一批任务生效, 不用重启PC脚本)</span>';
  } catch (e) {
    el.textContent = '加载失败';
  }
}
async function applyDtsSpeedConfig() {
  var pEl = document.getElementById('dts-speed-parallel');
  var tEl = document.getElementById('dts-speed-threads');
  if (!pEl || !tEl) return;
  var maxParallel = parseInt(pEl.value, 10);
  var ffmpegThreads = parseInt(tEl.value, 10);
  try {
    var r = await fetch('/api/video/dts-scan/speed-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxParallel: maxParallel, ffmpegThreads: ffmpegThreads })
    });
    var d = await r.json();
    if (d.error) { toast('设置失败: ' + d.error); return; }
    toast('已更新, 下一批任务生效');
  } catch (e) {
    toast('设置失败');
  }
}

// ── 播放历史清理: 复选框多选/全选/删除(2026-08-13加) ──────
var historySelected = {};   // md5 -> true

function toggleHistorySelect(md5) {
  if (historySelected[md5]) delete historySelected[md5];
  else historySelected[md5] = true;
  renderGrid(true);
  renderHistoryToolbar();
}

function selectAllHistory() {
  var allSelected = state.videos.length > 0 && state.videos.every(function (v) { return historySelected[v.md5]; });
  if (allSelected) {
    historySelected = {};
  } else {
    state.videos.forEach(function (v) { historySelected[v.md5] = true; });
  }
  renderGrid(true);
  renderHistoryToolbar();
}

function renderHistoryToolbar() {
  var el = document.getElementById('history-toolbar');
  if (!el) return;
  if (!state.filter.watchedOnly) { el.innerHTML = ''; return; }
  var n = Object.keys(historySelected).length;
  var allSelected = state.videos.length > 0 && state.videos.every(function (v) { return historySelected[v.md5]; });
  el.innerHTML =
    '<span class="chip' + (allSelected ? ' on' : '') + '" onclick="selectAllHistory()">' + (allSelected ? '☑' : '☐') + ' 全选</span>' +
    '<span style="margin-left:8px;font-size:.72rem;color:var(--text3)">已选 ' + n + ' 个</span>' +
    '<span class="chip ghost" style="margin-left:8px" onclick="deleteSelectedHistory()">删除选中的播放记录</span>' +
    '<span class="chip ghost" style="margin-left:6px" onclick="toggleHistoryManageMode()">完成</span>';
}

async function deleteSelectedHistory() {
  var md5s = Object.keys(historySelected);
  if (!md5s.length) { toast('还没选中任何视频'); return; }
  if (!confirm('确定要清除这 ' + md5s.length + ' 条播放记录吗? (不会删除视频文件本身, 也不影响收藏/评分)')) return;
  try {
    var r = await fetch('/api/marks/clear-watched', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ md5s: md5s })
    });
    var d = await r.json();
    toast('已清除 ' + d.cleared + ' 条播放记录');
    historySelected = {};
    renderHistoryToolbar();
    loadVideos(true);
  } catch (e) {
    toast('清除失败');
  }
}

// ── 级联排序: 拖拽排序按钮组(2026-08-13加) ──────────────
var SORT_FIELD_LABELS = { date: '日期', size: '大小', duration: '时长', resolution: '分辨率' };
var SORT_FIELD_ORDER = ['date', 'size', 'duration', 'resolution'];
var _sortDragField = null;

function renderSortChipsInner() {
  var active = state.filter.sortFields || [];
  var activeKeys = active.map(function (s) { return s.field; });

  var activeHtml = active.map(function (s, idx) {
    return '<span class="chip on sort-chip" data-field="' + s.field + '" onmousedown="startSortDrag(event,\'' + s.field + '\')">' +
      '<b>' + (idx + 1) + '</b> ' + SORT_FIELD_LABELS[s.field] +
      '<span onclick="event.stopPropagation();toggleSortDir(\'' + s.field + '\')" style="margin-left:4px;cursor:pointer">' + (s.dir === 'asc' ? '↑' : '↓') + '</span>' +
      '<span onclick="event.stopPropagation();removeSortField(\'' + s.field + '\')" style="margin-left:4px;cursor:pointer">✕</span>' +
    '</span>';
  }).join('');

  var availHtml = SORT_FIELD_ORDER.filter(function (k) { return activeKeys.indexOf(k) < 0; }).map(function (k) {
    return '<span class="chip ghost" onclick="addSortField(\'' + k + '\')">+ ' + SORT_FIELD_LABELS[k] + '</span>';
  }).join('');

  return '<div id="sort-chips-active" class="mf-tagbar">' +
           (activeHtml || '<span class="mf-empty">默认排序(点下面的按钮自定义, 拖动已选按钮调整优先级)</span>') +
         '</div>' +
         '<div style="margin-top:6px" class="mf-tagbar">' + availHtml + '</div>';
}

function renderSortChips() {
  var el = document.getElementById('sort-bar');   // 2026-08-13: 挪到独立顶部区域, 不再放筛选面板里
  if (el) el.innerHTML = renderSortChipsInner();
}

function addSortField(field) {
  if (!state.filter.sortFields) state.filter.sortFields = [];
  if (state.filter.sortFields.some(function (s) { return s.field === field; })) return;
  state.filter.sortFields.push({ field: field, dir: 'desc' });
  renderSortChips();
  loadVideos(true);
}

function removeSortField(field) {
  state.filter.sortFields = (state.filter.sortFields || []).filter(function (s) { return s.field !== field; });
  renderSortChips();
  loadVideos(true);
}

function toggleSortDir(field) {
  var s = (state.filter.sortFields || []).filter(function (s) { return s.field === field; })[0];
  if (s) { s.dir = (s.dir === 'asc') ? 'desc' : 'asc'; renderSortChips(); loadVideos(true); }
}

function _sortIndexOf(field) {
  var arr = state.filter.sortFields || [];
  for (var i = 0; i < arr.length; i++) if (arr[i].field === field) return i;
  return -1;
}

function _sortSwap(fieldA, fieldB) {
  var arr = state.filter.sortFields;
  var ia = _sortIndexOf(fieldA), ib = _sortIndexOf(fieldB);
  if (ia < 0 || ib < 0) return;

  // FLIP动画(2026-08-13加): 记录换位前每个chip的位置, 换位渲染后从旧位置滑到新位置
  var container = document.getElementById('sort-chips-active');
  var firstRects = {};
  if (container) {
    Array.prototype.forEach.call(container.querySelectorAll('.sort-chip'), function (c) {
      firstRects[c.getAttribute('data-field')] = c.getBoundingClientRect();
    });
  }

  var tmp = arr[ia]; arr[ia] = arr[ib]; arr[ib] = tmp;
  renderSortChips();

  var newContainer = document.getElementById('sort-chips-active');
  if (newContainer) {
    Array.prototype.forEach.call(newContainer.querySelectorAll('.sort-chip'), function (c) {
      var field = c.getAttribute('data-field');
      var first = firstRects[field];
      if (!first) return;
      var last = c.getBoundingClientRect();
      var dx = first.left - last.left;
      if (dx) {
        c.style.transition = 'none';
        c.style.transform = 'translateX(' + dx + 'px)';
        requestAnimationFrame(function () {
          c.style.transition = 'transform .18s ease';
          c.style.transform = '';
        });
      }
      if (field === _sortDragField) c.classList.add('dragging');   // 保持抓取中的视觉状态
    });
  }
}

function startSortDrag(e, field) {
  _sortDragField = field;
  var container = document.getElementById('sort-chips-active');
  if (container) {
    var el = container.querySelector('[data-field="' + field + '"]');
    if (el) el.classList.add('dragging');
  }
  document.addEventListener('mousemove', onSortDragMove);
  document.addEventListener('mouseup', onSortDragEnd);
}

function onSortDragMove(e) {
  if (!_sortDragField) return;
  var container = document.getElementById('sort-chips-active');
  if (!container) return;
  var chips = Array.prototype.slice.call(container.querySelectorAll('.sort-chip'));
  var curIdx = _sortIndexOf(_sortDragField);
  for (var i = 0; i < chips.length; i++) {
    var f2 = chips[i].getAttribute('data-field');
    if (f2 === _sortDragField) continue;
    var rect = chips[i].getBoundingClientRect();
    var mid = rect.left + rect.width / 2;
    var i2 = _sortIndexOf(f2);
    if ((i2 < curIdx && e.clientX < mid) || (i2 > curIdx && e.clientX > mid)) {
      _sortSwap(_sortDragField, f2);
      break;
    }
  }
}

function onSortDragEnd() {
  document.removeEventListener('mousemove', onSortDragMove);
  document.removeEventListener('mouseup', onSortDragEnd);
  var container = document.getElementById('sort-chips-active');
  if (container && _sortDragField) {
    var el = container.querySelector('[data-field="' + _sortDragField + '"]');
    if (el) el.classList.remove('dragging');
  }
  if (_sortDragField) loadVideos(true);
  _sortDragField = null;
}

// ── 目录树拖拽调宽(2026-08-13加, 照搬照片页sidebar那套) ──────
(function () {
  var dirs, resizer;

  function syncResizerPos() {
    if (!dirs || !resizer) return;
    var rect = dirs.getBoundingClientRect();   // 2026-08-13: 改用真实渲染位置, 不再用offsetLeft/offsetWidth手算
    resizer.style.left = rect.right + 'px';
    resizer.style.top = rect.top + 'px';
    resizer.style.height = rect.height + 'px';
  }
  window.syncDirsResizerPos = syncResizerPos;   // 2026-08-13: 暴露成全局函数, 给toggleDirs()在面板显示/隐藏时调用

  document.addEventListener('DOMContentLoaded', function () {
    dirs = document.getElementById('dirs');
    resizer = document.getElementById('dirs-resizer');
    if (!dirs || !resizer) return;

    var savedW = localStorage.getItem('videoer-dirs-width');
    if (savedW) dirs.style.width = savedW + 'px';
    syncResizerPos();
    window.addEventListener('scroll', syncResizerPos, true);   // 2026-08-13: .dirs是sticky定位, 滚动时位置会变, 必须监听scroll持续同步

    // 目录树内容随时可能被组件整体重绘, 每次尺寸变化后重新贴合拖拽条位置
    new MutationObserver(syncResizerPos).observe(dirs, { childList: true, subtree: false });
    window.addEventListener('resize', syncResizerPos);

    resizer.addEventListener('mouseenter', function () { resizer.classList.add('active'); });
    resizer.addEventListener('mouseleave', function () { if (!dragging) resizer.classList.remove('active'); });
    resizer.addEventListener('dblclick', function () { dirs.style.width = '230px'; try { localStorage.setItem('videoer-dirs-width', 230); } catch (e) {} syncResizerPos(); });   // 双击恢复默认宽度

    var dragging = false, startX = 0, startW = 0;
    resizer.addEventListener('mousedown', function (e) {
      dragging = true;
      startX = e.clientX;
      startW = dirs.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      resizer.classList.add('active');

      function onMove(e) {
        var maxW = Math.max(300, Math.min(800, Math.floor(window.innerWidth * 0.7)));   // 最宽 800px(原来 480), 不超过窗口的 70%
        var newW = Math.max(160, Math.min(maxW, startW + e.clientX - startX));
        dirs.style.width = newW + 'px';
        syncResizerPos();
      }
      function onUp() {
        dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        resizer.classList.remove('active');
        localStorage.setItem('videoer-dirs-width', dirs.offsetWidth);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });
})();

// ── 日期区间滑块(2026-08-13加, 独立最小/最大两条, 跟大小/时长同一风格) ──
var DATE_RANGE_MIN = 0, DATE_RANGE_MAX = 0;
var dateRangeLoaded = false, dateRangeLoading = false;
var _tDateMin = null, _tDateMax = null;

function fmtDate(epoch) {
  if (!epoch) return '';
  var d = new Date(epoch * 1000);
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function fmtDateRange(min, max) {
  if (!min && !max) return '不限日期';
  if (min && !max)  return '≥' + fmtDate(min);
  if (!min && max)  return '≤' + fmtDate(max);
  return fmtDate(min) + ' ~ ' + fmtDate(max);
}

function buildDateTicks(minEpoch, maxEpoch, maxDays) {
  var ticks = [], n = 5;
  for (var i = 0; i <= n; i++) {
    var frac = i / n;
    var epoch = minEpoch + frac * (maxEpoch - minEpoch);
    ticks.push({ v: Math.round(frac * maxDays), l: String(new Date(epoch * 1000).getFullYear()) });
  }
  return ticks;
}

function renderDateSliderInner() {
  if (!dateRangeLoaded) {
    if (!dateRangeLoading) loadDateRange();
    return '<span class="mf-empty">加载中…</span>';
  }
  if (!DATE_RANGE_MIN || !DATE_RANGE_MAX || DATE_RANGE_MIN >= DATE_RANGE_MAX) {
    return '<span class="mf-empty">暂无日期数据</span>';
  }
  var f = state.filter;
  // 2026-08-16改: 滑块换成两个日期输入框(开始/结束), min/max属性用真实数据范围限制可选区间
  var minAttr = fmtDate(DATE_RANGE_MIN);
  var maxAttr = fmtDate(DATE_RANGE_MAX);
  var startVal = f.dateMin ? fmtDate(f.dateMin) : '';
  var endVal = f.dateMax ? fmtDate(f.dateMax) : '';

  return (
    '<div class="mf-date-range">' +
      '<div class="mf-date-field">' +
        '<label>开始</label>' +
        '<input type="date" id="date-start" min="' + minAttr + '" max="' + maxAttr + '" value="' + startVal + '" onchange="onDateStartChange()">' +
      '</div>' +
      '<span class="mf-date-sep">至</span>' +
      '<div class="mf-date-field">' +
        '<label>结束</label>' +
        '<input type="date" id="date-end" min="' + minAttr + '" max="' + maxAttr + '" value="' + endVal + '" onchange="onDateEndChange()">' +
      '</div>' +
    '</div>'
  );
}

// 只更新日期这一小块, 不重绘整个面板 —— 避免异步数据回来时打断用户正在操作的其他控件
function renderDateSliderBlock() {
  var el = document.getElementById('date-slider-container');
  if (el) el.innerHTML = renderDateSliderInner();
}

async function loadDateRange() {
  dateRangeLoading = true;
  try {
    var r = await fetch('/api/video/date-range');
    var d = await r.json();
    DATE_RANGE_MIN = d.min || 0;
    DATE_RANGE_MAX = d.max || 0;
  } catch (e) {}
  dateRangeLoaded = true;
  dateRangeLoading = false;
  renderDateSliderBlock();
}

// "YYYY-MM-DD"字符串按本地时区解析成当天0点的epoch秒(跟fmtDate的本地时区约定保持一致,
// 不用Date.parse/UTC那套, 避免时区不一致导致日期偏差一天)
function parseDateInputToEpoch(str, endOfDay) {
  if (!str) return 0;
  var parts = str.split('-');
  if (parts.length !== 3) return 0;
  var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1, d = parseInt(parts[2], 10);
  var dt = endOfDay ? new Date(y, m, d, 23, 59, 59) : new Date(y, m, d, 0, 0, 0);
  return Math.floor(dt.getTime() / 1000);
}

function onDateStartChange() {
  var el = document.getElementById('date-start');
  if (!el) return;
  state.filter.dateMin = parseDateInputToEpoch(el.value, false);
  renderFilters();
  loadVideos(true);
}

function onDateEndChange() {
  var el = document.getElementById('date-end');
  if (!el) return;
  // 结束日期取当天23:59:59, 让选中的这一整天都被囊括进去(比原来滑块版本更符合直觉)
  state.filter.dateMax = parseDateInputToEpoch(el.value, true);
  renderFilters();
  loadVideos(true);
}

function resetDateSlider() {
  state.filter.dateMin = 0;
  state.filter.dateMax = 0;
  renderFilters();
  if (moreFiltersOpen) renderDateSliderBlock();
  loadVideos(true);
}

// ── 筛选面板高度拖拽调整(2026-08-13加) ──────────────────
(function () {
  var panel, resizer;

  function syncHeightResizerPos() {
    if (!panel || !resizer) return;
    var show = panel.classList.contains('show');
    resizer.classList.toggle('show', show);
    if (show) {
      var rect = panel.getBoundingClientRect();
      resizer.style.position = 'fixed';
      resizer.style.left = rect.left + 'px';
      resizer.style.width = rect.width + 'px';
      resizer.style.top = rect.bottom + 'px';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    panel = document.getElementById('more-filters');
    resizer = document.getElementById('mf-height-resizer');
    if (!panel || !resizer) return;

    var savedH = localStorage.getItem('videoer-mf-height');
    if (savedH) panel.style.maxHeight = savedH + 'px';

    // 面板内容随时可能被整体重绘或展开/收起, 定期同步一下拖拽条位置(不用事件驱动, 简单可靠)
    setInterval(syncHeightResizerPos, 300);
    window.addEventListener('resize', syncHeightResizerPos);

    var dragging = false, startY = 0, startH = 0;
    resizer.addEventListener('mousedown', function (e) {
      dragging = true;
      startY = e.clientY;
      startH = panel.offsetHeight;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      resizer.classList.add('active');
      e.preventDefault();

      function onMove(e) {
        var newH = Math.max(100, Math.min(window.innerHeight * 0.8, startH + e.clientY - startY));
        panel.style.maxHeight = newH + 'px';
        syncHeightResizerPos();
      }
      function onUp() {
        dragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        resizer.classList.remove('active');
        localStorage.setItem('videoer-mf-height', panel.offsetHeight);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });
})();


// ══ 2026-10-01 筛选悬浮图标 + 悬浮面板(桌面端): 面板标题栏可拖动(位置记住)、✕ 或 Esc 关闭; 图标角标显示生效的筛选条数 ══
(function () {
  var isDesktop = function () { return window.innerWidth > 700; };
  var panelEl = function () { return document.getElementById('more-filters'); };
  function loadPos() { try { return JSON.parse(localStorage.getItem('videoerMfPos') || 'null'); } catch (e) { return null; } }
  function applyPos() {
    var el = panelEl(); if (!el) return;
    var p = isDesktop() ? loadPos() : null;
    if (p) { el.style.left = Math.max(0, Math.min(p.x, window.innerWidth - 120)) + 'px'; el.style.top = Math.max(0, Math.min(p.y, window.innerHeight - 60)) + 'px'; el.style.right = 'auto'; }
    else { el.style.left = ''; el.style.top = ''; el.style.right = ''; }
  }
  // 面板内容每次重绘都会整体替换, 所以在重绘后补上标题栏
  var _origRMF = renderMoreFilters;
  renderMoreFilters = function () {
    _origRMF.apply(this, arguments);
    var el = panelEl(); if (!el || !isDesktop()) return;
    el.insertAdjacentHTML('afterbegin', '<div id="mf-head" title="按住这一栏可以拖动面板"><b>🔎 更多筛选</b><span style="flex:1"></span><button onclick="mfResetPos()" title="把面板放回默认位置">复位</button><button onclick="toggleMoreFilters()" title="关闭（Esc）">✕</button></div>');
    applyPos();
  };
  window.mfResetPos = function () { try { localStorage.removeItem('videoerMfPos'); } catch (e) {} applyPos(); };
  // 图标角标
  function fabUpdate() {
    var f = state.filter, n = 0;
    [f.favorite, f.watchedOnly, f.ratings && f.ratings.length, f.dirPath, f.q, f.fileName, f.folderName, f.sizeMin || f.sizeMax, f.durMin || f.durMax, f.dateMin || f.dateMax, f.resBucket, f.tags && f.tags.length].forEach(function (x) { if (x) n++; });
    var c = document.getElementById('fp-fab-count'), b = document.getElementById('fp-fab');
    if (c) { c.textContent = n ? String(n) : ''; c.style.display = n ? 'flex' : 'none'; }
    if (b) { b.classList.toggle('has', n > 0); b.classList.toggle('on', !!moreFiltersOpen); }
  }
  var _origRF = renderFilters;
  renderFilters = function () { _origRF.apply(this, arguments); fabUpdate(); };
  document.addEventListener('DOMContentLoaded', fabUpdate);
  // 拖动
  var drag = null;
  document.addEventListener('mousedown', function (e) {
    var hd = e.target.closest && e.target.closest('#mf-head'); var el = panelEl();
    if (!hd || !el || !isDesktop() || e.target.closest('button')) return;
    var r = el.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; e.preventDefault();
  });
  document.addEventListener('mousemove', function (e) {
    if (!drag) return; var el = panelEl(); if (!el) return;
    var x = Math.max(0, Math.min(e.clientX - drag.dx, window.innerWidth - 120)), y = Math.max(0, Math.min(e.clientY - drag.dy, window.innerHeight - 60));
    el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.right = 'auto'; drag.pos = { x: x, y: y };
  });
  document.addEventListener('mouseup', function () { if (drag && drag.pos) { try { localStorage.setItem('videoerMfPos', JSON.stringify(drag.pos)); } catch (e) {} } drag = null; });
  // Esc 关闭(输入框里按 Esc 不关; 播放器打开时 Esc 归播放器)
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !moreFiltersOpen || !isDesktop()) return;
    var t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) return;
    if (document.querySelector('.player-overlay.show, #player.show, .vpl-overlay.show')) return;
    toggleMoreFilters();
  });
  window.addEventListener('resize', applyPos);
})();


// ══════════════════════════════════════════════════════════════════════
// 2026-10-01 与图片库(viewer)保持一致: 排布(等高行/瀑布/网格) + 列数 1~10 + 批量选择放入回收站 + 播放器里 Del 删除 / Ctrl+Z 撤销
// ══════════════════════════════════════════════════════════════════════
var VCOL_MIN = 1, VCOL_MAX = 20, VCOL_DEFAULT = IS_MOBILE ? 2 : 4;
function _vRatio(v) { var w = parseInt(v.width, 10), h = parseInt(v.height, 10); return (w > 0 && h > 0) ? Math.max(0.35, Math.min(3, w / h)) : 1.78; }
function _vCols() { try { var n = parseInt(localStorage.getItem('videoerColCount') || '', 10); return (n >= VCOL_MIN && n <= VCOL_MAX) ? n : VCOL_DEFAULT; } catch (e) { return VCOL_DEFAULT; } }
function _vLayout() { try { var m = localStorage.getItem('videoerLayout'); return ['justified', 'masonry', 'grid'].indexOf(m) >= 0 ? m : 'justified'; } catch (e) { return 'justified'; } }
function setLayout(m) { try { localStorage.setItem('videoerLayout', m); } catch (e) {} _vApplyLayout(true); }
function adjustColCount(d) { var n = Math.max(VCOL_MIN, Math.min(VCOL_MAX, _vCols() + d)); try { localStorage.setItem('videoerColCount', String(n)); } catch (e) {} _vApplyLayout(true); }

// 等高行算法(与图片库同一套): 从头往后一张张放进当前行, 行高降到目标以下时比较"带上这张/不带这张"哪个更接近目标行高, 在那里换行;
// 每张卡片宽度 = 宽高比 × 该行行高, 行宽刚好铺满 → 一行内缩略图高度完全相同(卡片下面的文件名/目录/评分条高度固定, 所以整张卡片也对齐); 最后一行不拉伸。
var _vSig = '';
function _vJustify(grid, force) {
  var items = [].slice.call(grid.children).filter(function (el) { return el.classList && el.classList.contains('card'); });
  var W = grid.clientWidth, target = parseFloat(getComputedStyle(grid).getPropertyValue('--row-h')) || 180, gap = 8;
  var sig = W + '|' + items.length + '|' + Math.round(target);
  if (!force && sig === _vSig) return;
  _vSig = sig;
  if (!W) return;
  var row = [], sum = 0;
  function flush(last) {
    if (!row.length) return;
    var hh = (W - gap * (row.length - 1)) / sum;
    if (last) hh = Math.min(hh, target * 1.3);
    row.forEach(function (it) { it.el.style.flex = 'none'; it.el.style.width = Math.floor(it.r * hh) + 'px'; });
    row = []; sum = 0;
  }
  for (var k = 0; k < items.length; k++) {
    var el = items[k], r = parseFloat(el.style.getPropertyValue('--r')) || 1.78;
    row.push({ el: el, r: r }); sum += r;
    var h2 = (W - gap * (row.length - 1)) / sum;
    if (h2 < target) {
      if (row.length > 1) {
        var hWithout = (W - gap * (row.length - 2)) / (sum - r);
        if (Math.abs(hWithout - target) < Math.abs(h2 - target)) {
          var last = row.pop(); sum -= last.r; flush(false); row = [last]; sum = last.r;
          if ((W - gap * (row.length - 1)) / sum >= target) continue;
        }
      }
      flush(false);
    }
  }
  flush(true);
}
function _vClearJustify(grid) { [].slice.call(grid.children).forEach(function (el) { if (el.style) { el.style.width = ''; el.style.flex = ''; } }); _vSig = ''; }
function _vApplyLayout(force) {
  var grid = document.getElementById('grid'); if (!grid) return;
  var list = state.viewMode === 'list';
  var mode = list ? 'list' : _vLayout();
  var n = _vCols();
  if (grid.dataset.layout !== mode) { grid.dataset.layout = mode; if (mode !== 'justified') _vClearJustify(grid); force = true; }
  grid.style.setProperty('--col-count', n); grid.dataset.cols = String(n);
  var w = grid.clientWidth || 1000;
  var rs = state.videos.slice(-200).map(_vRatio);
  var avg = rs.length ? rs.reduce(function (a, b) { return a + b; }, 0) / rs.length : 1.78;
  grid.style.setProperty('--row-h', Math.round(Math.max(28, (w / n) / Math.max(0.6, Math.min(1.8, avg)))) + 'px');
  if (mode === 'justified') _vJustify(grid, force);
  var v = document.getElementById('col-count-val'); if (v) v.textContent = n;
  var sl = document.getElementById('col-count-slider'); if (sl) sl.value = n;
  var mi = document.getElementById('col-count-minus'), pl = document.getElementById('col-count-plus');
  if (mi) mi.disabled = n <= VCOL_MIN; if (pl) pl.disabled = n >= VCOL_MAX;
  var sel = document.getElementById('layout-mode'); if (sel) { sel.value = _vLayout(); sel.disabled = list; }
  var ft = document.getElementById('float-total'); if (ft) ft.textContent = state.total || 0;
}
// 重新渲染后重排; 窗口/目录树宽度变化时重排
var _vOrigRG = renderGrid;
renderGrid = function () { _vOrigRG.apply(this, arguments); setTimeout(function () { _vApplyLayout(true); }, 0); };
var _vOrigCH = cardHtml;
cardHtml = function (v, i) {   // 每张卡片带宽高比变量 + 选择框
  var h = _vOrigCH(v, i), tag = 'onmouseenter="removeVideoMenu()">', k = h.indexOf(tag);
  if (k < 0) return h;
  return h.slice(0, k) + 'onmouseenter="removeVideoMenu()" style="--r:' + _vRatio(v) + '">' +
    '<input type="checkbox" class="sel-check" onclick="event.stopPropagation();vToggleSel(' + i + ')">' + h.slice(k + tag.length);
};
document.addEventListener('DOMContentLoaded', function () {
  _vApplyLayout(true);
  var g = document.getElementById('grid');
  if (g && window.ResizeObserver) new ResizeObserver(function () { _vApplyLayout(false); }).observe(g);
});

// ── 批量选择 → 放入回收站 ──
state.selectMode = false; var _vSel = {};
function vToggleSel(i) {
  var v = state.videos[i]; if (!v || v._deleted) return;
  if (_vSel[i]) delete _vSel[i]; else _vSel[i] = 1;
  var el = document.getElementById('c' + i);
  if (el) { el.classList.toggle('selected', !!_vSel[i]); var cb = el.querySelector('.sel-check'); if (cb) cb.checked = !!_vSel[i]; }
  _vUpdBatch();
}
function _vUpdBatch() {
  var n = Object.keys(_vSel).length;
  var c = document.getElementById('batch-count'); if (c) c.textContent = n;
  var bb = document.getElementById('batch-bar'), ft = document.getElementById('floating-toolbar');
  if (bb) bb.classList.toggle('show', state.selectMode);
  if (ft) ft.classList.toggle('hide', state.selectMode);
  var bs = document.getElementById('btn-select-mode'); if (bs) bs.classList.toggle('active', state.selectMode);
}
function toggleSelectMode() { if (state.selectMode) exitSelectMode(); else { state.selectMode = true; var g = document.getElementById('grid'); if (g) g.classList.add('select-mode'); _vUpdBatch(); } }
function exitSelectMode() {
  state.selectMode = false; _vSel = {};
  var g = document.getElementById('grid'); if (g) { g.classList.remove('select-mode'); [].slice.call(g.querySelectorAll('.card.selected')).forEach(function (e) { e.classList.remove('selected'); var cb = e.querySelector('.sel-check'); if (cb) cb.checked = false; }); }
  _vUpdBatch();
}
function vSelectAllVisible() { state.videos.forEach(function (v, i) { if (!v._deleted && document.getElementById('c' + i)) { if (!_vSel[i]) vToggleSel(i); } }); }
async function vBatchDelete() {
  var idxs = Object.keys(_vSel).map(Number); if (!idxs.length) { toast('还没选择任何视频'); return; }
  var ids = idxs.map(function (i) { return state.videos[i] && state.videos[i].id; }).filter(Boolean);
  try {
    var r = await fetch('/api/photos/soft-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ids }) }).then(function (x) { return x.json(); });
    if (!r || !r.ok) { toast('操作失败: ' + ((r && r.error) || '未知错误')); return; }
    idxs.forEach(function (i) { var el = document.getElementById('c' + i); if (el) el.remove(); if (state.videos[i]) state.videos[i]._deleted = true; });
    state.total = Math.max(0, (state.total || 0) - ids.length);
    exitSelectMode(); renderStats(); _vApplyLayout(true);
    toast('已放入回收站 ' + ids.length + ' 个');
  } catch (e) { toast('操作失败: ' + e.message); }
}
// 选择模式下: 点卡片(播放/Pot/在线)改成"选中/取消选中", 不播放
['playVideo', 'playOnline', 'playPot', 'thumbTap'].forEach(function (nm) {
  var o = window[nm]; if (typeof o !== 'function') return;
  window[nm] = function (i) { if (state.selectMode) { vToggleSel(i); return; } return o.apply(this, arguments); };
});
// 单个放入回收站(右键)也同步总数/排布
var _vOrigSD = softDeleteVideo;
softDeleteVideo = async function (idx) { await _vOrigSD.apply(this, arguments); state.total = Math.max(0, (state.total || 0) - (state.videos[idx] && state.videos[idx]._deleted ? 1 : 0)); renderStats(); _vApplyLayout(true); };

// ── 播放器(相当于图片库的"大图")里: 按 Del(按下再抬起) 放入回收站并播放下一个; 刚删的立刻按 Ctrl+Z 恢复, 一旦切换就不能再恢复 ──
var _vDelArmed = false, _vBusy = false, _vLastDel = null;
function _vPlayerOpen() { var e = document.getElementById('vpl'); return !!(e && e.classList.contains('show')); }
function _vTyping(e) { var t = e.target; return !!(t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable)); }
document.addEventListener('keydown', function (e) {
  if (!_vPlayerOpen() || _vTyping(e)) return;
  if (e.key === 'Delete') { e.preventDefault(); _vDelArmed = true; }
  else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'z') { e.preventDefault(); vUndoDelete(); }
});
document.addEventListener('keyup', function (e) { if (e.key === 'Delete' && _vDelArmed) { _vDelArmed = false; if (_vPlayerOpen()) vDeleteCurrent(); } });
async function vDeleteCurrent() {
  if (_vBusy) return;
  var cur = VPlayer.getCur(); if (!cur || !cur.id) return;
  var idx = state.videos.indexOf(cur); if (idx < 0) return;
  _vBusy = true;
  try {
    var r = await fetch('/api/photos/soft-delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [cur.id] }) }).then(function (x) { return x.json(); });
    if (!r || !r.ok) throw new Error((r && r.error) || '失败');
    cur._deleted = true; var el = document.getElementById('c' + idx); if (el) el.remove();
    state.total = Math.max(0, (state.total || 0) - 1); renderStats(); _vApplyLayout(true);
    var n = -1, k;
    for (k = idx + 1; k < state.videos.length; k++) if (!state.videos[k]._deleted && VPlayer.canPlay(state.videos[k]) !== 'no') { n = k; break; }
    if (n < 0) for (k = idx - 1; k >= 0; k--) if (!state.videos[k]._deleted && VPlayer.canPlay(state.videos[k]) !== 'no') { n = k; break; }
    if (n >= 0) { _vLastDel = { v: cur, idx: idx, shownMd5: state.videos[n].md5 }; VPlayer.open(state.videos[n], state.videos, n); }
    else { _vLastDel = null; VPlayer.close(); }
    toast('已放入回收站（Ctrl+Z 撤销）');
  } catch (e) { toast('操作失败: ' + e.message); }
  finally { _vBusy = false; }
}
async function vUndoDelete() {
  var d = _vLastDel; if (!d || _vBusy) return;
  var cur = VPlayer.getCur();
  if (!cur || cur.md5 !== d.shownMd5) { _vLastDel = null; return; }    // 已经切到别的视频了 → 不再恢复
  _vLastDel = null; _vBusy = true;
  try {
    var r = await fetch('/api/photos/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [d.v.id] }) }).then(function (x) { return x.json(); });
    if (!r || !r.ok) throw new Error((r && r.error) || '失败');
    d.v._deleted = false; state.total = (state.total || 0) + 1;
    renderGrid(true); renderStats();
    VPlayer.open(d.v, state.videos, d.idx);
    toast('已恢复');
  } catch (e) { _vLastDel = d; toast('恢复失败: ' + e.message); }
  finally { _vBusy = false; }
}

// 列数滑块: 拖动直接设置
function setColCount(v) { var n = Math.max(VCOL_MIN, Math.min(VCOL_MAX, parseInt(v, 10) || VCOL_DEFAULT)); try { localStorage.setItem('videoerColCount', String(n)); } catch (e) {} _vApplyLayout(true); }

// ── 播放到头: 自动接着播"离当前目录最近的下一个有视频的目录"(2026-10-01) ──
var _vEdgeBusy = false;
function _vFirstPlayable() {
  for (var i = 0; i < state.videos.length; i++) {
    var v = state.videos[i];
    if (!v._deleted && VPlayer.canPlay(v) !== 'no') return i;
  }
  return -1;
}
window.vNextDir = async function () {
  if (_vEdgeBusy || typeof VPlayer === 'undefined') return;
  _vEdgeBusy = true;
  try {
    // 先把当前列表剩余的分页加载完(别在还有没加载的视频时就跳目录)
    if (state.hasMore) {
      var cur0 = state.videos.length;
      await loadVideos(false);
      var j = cur0;
      while (j < state.videos.length && (state.videos[j]._deleted || VPlayer.canPlay(state.videos[j]) === 'no')) j++;
      if (j < state.videos.length) { VPlayer.open(state.videos[j], state.videos, j); return; }
      if (state.hasMore) return;
    }
    var c = VPlayer.getCur && VPlayer.getCur();
    var scope = state.filter.dirPath || (c && c.path ? String(c.path).replace(/\/[^\/]+$/, '') : '');
    for (var i = 0; i < 15 && scope; i++) {
      var u = '/api/photo-tags/dir-neighbor?media=video&dir=next&path=' + encodeURIComponent(scope) +
              (state.category && state.category !== 'both' ? '&category=' + state.category : '');
      var r = await fetch(u).then(function (x) { return x.json(); });
      if (!r.dir) { toast('已经是最后一个目录了'); return; }
      state.filter.dirPath = r.dir;
      renderFilters();
      await loadVideos(true);
      var k = _vFirstPlayable();
      if (k >= 0) { toast('下一个目录: ' + r.dir.split('/').slice(-2).join('/')); VPlayer.open(state.videos[k], state.videos, k); return; }
      scope = r.dir;
    }
  } catch (e) { console.error('下一个目录失败', e); }
  finally { _vEdgeBusy = false; }
};
