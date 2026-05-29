// ── js/utils.js  共通ユーティリティ ──────────────────

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escJs(s) {
  return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
}

function showToast(msg, type = 'success') {
  const icons  = { success:'✓', error:'✕', alert:'🔔' };
  const colors = { success:'var(--up)', error:'var(--down)', alert:'var(--gold)' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span style="color:${colors[type]}">${icons[type]}</span> ${msg}`;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), type === 'alert' ? 8000 : 3500);
}
