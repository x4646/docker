const { spawnSync } = require('child_process');

module.exports = {
  name:        '股票链接',
  description: '获取股票监控访问地址',
  icon:        '🌐',

  async execute(params) {
    const r = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', 'stock-monitor'], { encoding:'utf8' });
    const running = r.stdout.trim() === 'true';
    return {
      type: 'text',
      data: `股票监控\n状态：${running ? '✅ 运行中' : '⛔ 已停止'}\nhttp://192.168.0.3:3000`
    };
  }
};
