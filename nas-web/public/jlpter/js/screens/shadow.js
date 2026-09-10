"use strict";

function shadowTemplate() {
  var hasResult = !!state.shadowResult;
  var resultBlock = "";
  if (hasResult) {
    var chars = state.shadowResult.chars.map(function (c) {
      return '<div class="char-box ' + c.cls + '">' + c.ch + "</div>";
    }).join("");
    resultBlock = '<div style="text-align:center; margin-top:6px"><div class="similarity-badge mono">' +
      state.shadowResult.similarity + '%</div><div class="similarity-lbl">整体相似度</div></div>' +
      '<div class="char-row" style="flex-wrap:wrap">' + chars + "</div>" +
      '<button class="ghost-btn" data-act="resetShadow">重录</button>';
  }

  return '<div><h1 class="screen-title">跟读练习</h1><p class="screen-sub">先听范读，再录音跟读</p></div>' +
    '<div class="sentence-card"><div class="sentence-jp"><ruby>今日<rt>きょう</rt></ruby>は<ruby>天気<rt>てんき</rt></ruby>が いい です。</div>' +
    '<div class="sentence-cn">今天天气很好。</div></div>' +
    '<div class="control-row">' +
    '<button class="round-btn ' + (state.shadowPlaying ? "playing" : "") + '" data-act="playShadow">音<span class="lbl">播放范读</span></button>' +
    '<button class="round-btn mic ' + (state.shadowMicState === "recording" ? "recording" : "") + '" data-act="toggleRecord">' +
    (state.shadowMicState === "recording" ? "止" : "録") +
    '<span class="lbl">' + (state.shadowMicState === "recording" ? "停止" : "开始录音") + "</span></button>" +
    "</div>" + resultBlock;
}

function doToggleRecord() {
  if (state.shadowMicState === "idle") {
    state.shadowMicState = "recording";
    state.shadowResult = null;
    render();
  } else {
    var base = toKanaChars("きょうはてんきがいいです");
    var variants = [
      { similarity: 92, chars: base.map(function (ch) { return { ch: ch, cls: "fb-ok" }; }) },
      { similarity: 68, chars: base.map(function (ch, i) { return { ch: ch, cls: (i === 4 || i === 9) ? "fb-bad" : "fb-ok" }; }) }
    ];
    state.shadowMicState = "idle";
    state.shadowResult = variants[Math.random() < 0.5 ? 0 : 1];
    render();
  }
}
