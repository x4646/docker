// path-utils.js — NAS 路径转换公共工具
//
// 收拢各模块里重复的 toRealPath/toDbPath/toWinPath 逻辑, 供【以后新写的模块】引用。
// 不改动、不替换任何现有模块里已经写好的同名函数 —— 那些能跑的代码保持原样,
// 避免为了"消除重复"而引入不必要的改动风险。
//
// 用法(新模块里):
//   var PathUtils = require('./path-utils.js');
//   PathUtils.toRealPath('/share/Person/x.mp4')   -> '/share/CACHEDEV4_DATA/Person/x.mp4'
//   PathUtils.toDbPath(realPath)                  -> '/share/Person/x.mp4'
//   PathUtils.toWinPath('/share/Media/x.mp4')     -> 'M:\\x.mp4'

var fs = require('fs');

// NAS 挂载路径 <-> Windows 盘符 (与 potlaunch.ps1 / video_thumbs.ps1 等保持一致)
var SHARE_MAP = [
  ['/share/Person',    'P:'],
  ['/share/Bak',       'B:'],
  ['/share/BAK',       'B:'],
  ['/share/Media',     'M:'],
  ['/share/Container', 'X:']
];

// 入库风格路径(/share/Xxx/...) -> 磁盘真实路径(/share/CACHEDEVn_DATA/Xxx/...)
// 依次尝试各个 CACHEDEV 卷直到找到真实存在的那个; 全部失败则原样返回
function toRealPath(dbPath) {
  if (typeof dbPath !== 'string') return dbPath;
  if (dbPath.indexOf('/share/CACHEDEV') === 0) return dbPath;
  var m = dbPath.match(/^\/share\/([^\/]+)(\/.*)?$/);
  if (!m) return dbPath;
  for (var i = 1; i <= 8; i++) {
    var cand = '/share/CACHEDEV' + i + '_DATA/' + m[1] + (m[2] || '');
    try { if (fs.existsSync(cand)) return cand; } catch (e) { /* 候选卷不存在, 继续试下一个, 预期行为 */ }
  }
  return dbPath;
}

// 磁盘真实路径 -> 入库风格路径
function toDbPath(realPath) {
  if (typeof realPath !== 'string') return realPath;
  var m = realPath.match(/^\/share\/CACHEDEV\d+_DATA(\/.*)$/);
  return m ? ('/share' + m[1]) : realPath;
}

// NAS 路径 -> Windows 盘符路径, 供 PC 端脚本/潜在的浏览器端提示使用
function toWinPath(p) {
  var s = String(p || '');
  for (var i = 0; i < SHARE_MAP.length; i++) {
    if (s.indexOf(SHARE_MAP[i][0]) === 0) {
      return SHARE_MAP[i][1] + s.slice(SHARE_MAP[i][0].length).replace(/\//g, '\\');
    }
  }
  return s.replace(/\//g, '\\');
}

module.exports = {
  SHARE_MAP: SHARE_MAP,
  toRealPath: toRealPath,
  toDbPath: toDbPath,
  toWinPath: toWinPath
};
