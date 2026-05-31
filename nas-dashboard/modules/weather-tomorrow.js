const utils = require('./utils');

module.exports = {
  name:        '明日天気',
  description: '查看明日天气预报（多城市）',
  icon:        '📅',

  async execute(params) {
    const cities   = utils.getCities();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tDate = tomorrow.toISOString().split('T')[0];
    const rows  = [];

    for (const city of cities) {
      try {
        const data     = await utils.fetchForecast(city);
        const forecast = data.list.find(i => i.dt_txt.startsWith(tDate) && i.dt_txt.includes('12:00')) || data.list[8];
        rows.push({
          '地区': utils.getCityName(city),
          '天気': `${utils.weatherEmoji(forecast.weather[0].id)} ${forecast.weather[0].description}`,
          '気温': `${Math.round(forecast.main.temp)}°C`,
          '湿度': `${forecast.main.humidity}%`,
        });
      } catch(e) {
        rows.push({ '地区': utils.getCityName(city), '天気': '❌ 取得失敗', '気温': '-', '湿度': '-' });
      }
    }
    return { type: 'table', data: rows };
  }
};
