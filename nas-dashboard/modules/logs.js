const { spawn } = require('child_process');

module.exports = {
  name:        '查看日志',
  description: '查看容器最近日志',
  icon:        '📋',

  async execute(params) {
    const container = params.container || 'nas-bot';
    const lines     = params.lines    || 30;

    return new Promise((resolve) => {
      const r      = spawn('docker', ['logs', container, '--tail', String(lines)]);
      let stdout   = '';
      let stderr   = '';

      r.stdout.on('data', d => stdout += d);
      r.stderr.on('data', d => stderr += d);

      r.on('close', () => {
        const output = (stdout + stderr).trim();
        resolve({
          type: 'text',
          data: output || '无日志'
        });
      });

      r.on('error', (e) => {
        resolve({ type: 'error', data: e.message });
      });

      // 5秒超时
      setTimeout(() => {
        r.kill();
        const output = (stdout + stderr).trim();
        resolve({
          type: 'text',
          data: output || '超时，无输出'
        });
      }, 5000);
    });
  }
};
