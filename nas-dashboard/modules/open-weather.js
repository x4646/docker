module.exports = {
  name:        '打开天气设置',
  description: '天气设置访问地址',
  icon:        '🌤',

  async execute(params) {
    return {
      type: 'text',
      data: 'http://192.168.0.3:3010'
    };
  }
};
