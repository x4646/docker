const { spawnSync } = require('child_process');

module.exports = {
  name:        '容器列表',
  description: '查看所有运行中的Docker容器',
  icon:        '🐳',

  async execute(params) {
    const r = spawnSync('docker', [
      'ps',
      '--format', '{{.Names}}||{{.Status}}||{{.Ports}}'
    ], { encoding: 'utf8' });

    if (r.error) return { type: 'error', data: r.error.message };

    const rows = r.stdout.trim().split('\n').filter(Boolean).map(line => {
      const [name, status, ports] = line.split('||');
      return { name, status, ports: ports || '-' };
    });

    return { type: 'table', data: rows };
  }
};
