const { spawnSync } = require('child_process');

module.exports = {
  name:        '系统状态',
  description: '查看NAS内存和磁盘状态',
  icon:        '💾',

  async execute(params) {
    const mem  = spawnSync('free',  ['-h'], { encoding:'utf8' });
    const disk = spawnSync('df',    ['-h', '/'], { encoding:'utf8' });

    const memLine  = mem.stdout.split('\n')[1].split(/\s+/);
    const diskLine = disk.stdout.split('\n')[1].split(/\s+/);

    return {
      type: 'card',
      data: {
        '内存总量': memLine[1],
        '内存已用': memLine[2],
        '内存空闲': memLine[3],
        '磁盘总量': diskLine[1],
        '磁盘已用': diskLine[2],
        '磁盘剩余': diskLine[3],
        '磁盘使用率': diskLine[4],
      }
    };
  }
};
