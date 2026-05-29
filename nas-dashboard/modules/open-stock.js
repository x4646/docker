module.exports = {
  name:        '打开股票监控',
  description: '股票监控访问地址',
  icon:        '📈',

  async execute(params) {
    return {
      type: 'text',
      data: 'http://192.168.0.3:3000'
    };
  }
};
