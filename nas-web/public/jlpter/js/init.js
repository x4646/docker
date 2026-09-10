"use strict";

// 首屏只等设置 + 分类列表（都很小），不再等全量词库——这是"秒开"的关键。
// 具体某个分类/等级的词条内容，只有用户真正点进去看时才会按需懒加载（见 core.js 的 getScopedWords）
function init() {
  loadUiScale();
  Promise.all([loadSettings(), loadCategories()]).then(function () {
    render();
    refreshHomeStats();
  }).catch(function () {});
}

// 双击兜底：CSS 的 user-select:none / touch-action:manipulation 挡不住的场景
// （比如某些浏览器双击仍然弹系统菜单）在这再拦一次
document.addEventListener("dblclick", function (e) { e.preventDefault(); });

init();
