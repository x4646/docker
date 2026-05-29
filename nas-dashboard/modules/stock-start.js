const { spawnSync } = require('child_process');

module.exports = {
  name:        '股票开启',
  description: '启动股票监控',
  icon:        '▶️',

  async execute(params) {
    const r = spawnSync('docker', ['start', 'stock-monitor'], { encoding:'utf8', timeout:15000 });
    return {
      type: 'toast',
      data: r.status === 0 ? '✅ 股票监控已启动' : `❌ 启动失败：${r.stderr}`
    };
  }
};
