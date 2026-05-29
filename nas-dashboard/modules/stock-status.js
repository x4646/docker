const { spawnSync } = require('child_process');
const http = require('http');

module.exports = {
  name:        '股票状态',
  description: '查看股票监控容器状态',
  icon:        '📈',

  async execute(params) {
    const r = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', 'stock-monitor'], { encoding:'utf8' });
    const running = r.stdout.trim() === 'true';
    return {
      type: 'toast',
      data: `股票监控：${running ? '✅ 运行中' : '⛔ 已停止'}`
    };
  }
};
