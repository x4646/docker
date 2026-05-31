const utils = require('./utils');

module.exports = {
  name:        '今日天气',
  description: '查看今日天气（多城市）',
  icon:        '🌤',

  async execute(params) {
    const cities = utils.getCities();
    const rows   = [];

    for (const city of cities) {
      try {
        const data = await utils.fetchWeather(city);
        rows.push({
          '地区': utils.getCityName(city),
          '天気': `${utils.weatherEmoji(data.weather[0].id)} ${data.weather[0].description}`,
          '気温': `${Math.round(data.main.temp)}°C`,
          '体感': `${Math.round(data.main.feels_like)}°C`,
          '湿度': `${data.main.humidity}%`,
          '風速': `${data.wind.speed} m/s`,
        });
      } catch(e) {
        rows.push({ '地区': utils.getCityName(city), '天気': '❌ 取得失敗', '気温': '-', '体感': '-', '湿度': '-', '風速': '-' });
      }
    }
    return { type: 'table', data: rows };
  }
};
