const { spawnSync } = require('child_process');

module.exports = {
  name:        '股票关闭',
  description: '停止股票监控',
  icon:        '⏹️',

  async execute(params) {
    const r = spawnSync('docker', ['stop', 'stock-monitor'], { encoding:'utf8', timeout:15000 });
    return {
      type: 'toast',
      data: r.status === 0 ? '✅ 股票监控已停止' : `❌ 停止失败：${r.stderr}`
    };
  }
};
