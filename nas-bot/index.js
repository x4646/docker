const bot       = require('./bot');
const scheduler = require('./scheduler');

console.log('NAS Bot 启动...');
scheduler.start();
bot.start();
