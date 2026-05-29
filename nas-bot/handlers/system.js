const { send } = require('../utils');
const { execSync } = require('child_process');

function exec(cmd) {
  try {
    return { ok: true, out: execSync(cmd, { timeout: 10000 }).toString().trim() };
  } catch(e) {
    return { ok: false, out: e.message };
  }
}

// ── 系统状态 ──────────────────────────────────────────
async function status(chatId) {
  const disk = exec("df -h / | tail -1 | awk '{print $3\"/\"$2\" 已用\"$5}'").out;
  const mem  = exec("free -h | grep Mem | awk '{print $3\"/\"$2}'").out;
  send(chatId, 'NAS状态\n内存：' + mem + '\n磁盘：' + disk);
}

// ── 容器列表 ──────────────────────────────────────────
async function containers(chatId) {
  const r = exec("docker ps --format '{{.Names}}  {{.Status}}'");
  send(chatId, r.ok ? r.out : '获取失败');
}

module.exports = { status, containers };
