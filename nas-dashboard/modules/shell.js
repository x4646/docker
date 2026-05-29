const { spawn } = require('child_process');

module.exports = {
  name:        '后台执行',
  description: '后台异步执行命令，立即返回不等待',
  icon:        '⚡',

  async execute(params) {
    const cmd = params.cmd;
    if (!cmd) return { type: 'error', data: '缺少cmd参数' };

    const parts = cmd.split(' ');
    const child = spawn(parts[0], parts.slice(1), {
      detached: true,
      stdio:    'ignore',
    });
    child.unref();

    return {
      type: 'toast',
      data: `✅ 已在后台启动，请稍后查看结果`
    };
  }
};
