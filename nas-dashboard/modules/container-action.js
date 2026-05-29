const { spawnSync } = require('child_process');

module.exports = {
  name:        '容器操作',
  description: '启动/停止/重启指定容器',
  icon:        '🔧',

  async execute(params) {
    const { action, container } = params;

    if (!action || !container) {
      return { type: 'error', data: '缺少参数：action, container' };
    }

    const allowed = ['start', 'stop', 'restart'];
    if (!allowed.includes(action)) {
      return { type: 'error', data: `不支持的操作：${action}` };
    }

    const r = spawnSync('docker', [action, container], { encoding: 'utf8', timeout: 30000 });

    if (r.error) return { type: 'error', data: r.error.message };
    if (r.status !== 0) return { type: 'error', data: r.stderr || '操作失败' };

    return {
      type: 'toast',
      data: `✅ ${container} ${action} 成功`
    };
  }
};
