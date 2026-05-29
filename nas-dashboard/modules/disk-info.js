const { spawnSync } = require('child_process');

module.exports = {
  name:        '磁盘状态',
  description: '查看NAS磁盘使用情况',
  icon:        '💾',

  async execute(params) {
    const r = spawnSync('df', ['-h'], { encoding: 'utf8' });
    if (r.error) return { type: 'error', data: r.error.message };

    const lines = r.stdout.trim().split('\n');
    const rows  = lines.slice(1).map(line => {
      const cols = line.split(/\s+/);
      return {
        filesystem: cols[0],
        size:       cols[1],
        used:       cols[2],
        avail:      cols[3],
        use:        cols[4],
        mount:      cols[5],
      };
    });

    return { type: 'table', data: rows };
  }
};
