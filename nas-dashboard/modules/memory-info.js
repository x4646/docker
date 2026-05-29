const { spawnSync } = require('child_process');

module.exports = {
  name:        '内存状态',
  description: '查看NAS内存使用情况',
  icon:        '🧠',

  async execute(params) {
    const r = spawnSync('free', ['-h'], { encoding: 'utf8' });
    if (r.error) return { type: 'error', data: r.error.message };

    const lines = r.stdout.trim().split('\n');
    const cols  = lines[1].split(/\s+/);

    return {
      type: 'card',
      data: {
        total:   cols[1],
        used:    cols[2],
        free:    cols[3],
        shared:  cols[4],
        cache:   cols[5],
        available: cols[6],
      }
    };
  }
};
