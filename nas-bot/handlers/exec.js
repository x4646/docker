const { send } = require('../utils');
const { execSync } = require('child_process');

const DANGEROUS = ['rm -rf', 'mkfs', 'dd if', 'format', '> /dev'];

async function run(chatId, cmd) {
  if (DANGEROUS.some(d => cmd.includes(d))) {
    send(chatId, '⛔ 危险命令已拦截');
    return;
  }
  try {
    const out = execSync(cmd, { timeout: 10000 }).toString().trim();
    send(chatId, out.length ? out : '执行完成（无输出）');
  } catch(e) {
    send(chatId, '错误：' + e.message);
  }
}

module.exports = { run };
