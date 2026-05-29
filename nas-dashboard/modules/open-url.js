module.exports = {
  name:        '打开网址',
  description: '在新窗口打开指定URL',
  icon:        '🌐',

  async execute(params) {
    const url = params.url || 'https://www.google.com';
    return {
      type: 'url',
      data: url
    };
  }
};
