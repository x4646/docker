const { spawn } = require('child_process');

module.exports = {
  name:        '重启控制面板',
  description: '延迟3秒重启Dashboard自身',
  icon:        '🔄',

  async execute(params) {
    // 先返回成功，3秒后再重启
    setTimeout(() => {
      spawn('docker', ['restart', 'nas-dashboard'], {
        detached: true,
        stdio: 'ignore'
      }).unref();
    }, 3000);

    return {
      type: 'toast',
      data: '✅ 将在3秒后重启，页面会短暂断开'
    };
  }
};
