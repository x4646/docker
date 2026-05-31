const utils    = require('./utils');
const weekDays = ['日','月','火','水','木','金','土'];

module.exports = {
  name:        '一週間天気',
  description: '查看未来7天天气预报（多城市）',
  icon:        '📆',

  async execute(params) {
    const cities = utils.getCities();
    const rows   = [];

    for (const city of cities) {
      try {
        const data     = await utils.fetchForecast(city);
        const dailyMap = new Map();
        data.list.forEach(item => {
          const date = item.dt_txt.split(' ')[0];
          if (!dailyMap.has(date) || item.dt_txt.includes('12:00')) dailyMap.set(date, item);
        });

        Array.from(dailyMap.entries()).slice(0, 7).forEach(([date, item]) => {
          const d = new Date(date);
          rows.push({
            '地区': utils.getCityName(city),
            '日期': `${d.getMonth()+1}/${d.getDate()}(${weekDays[d.getDay()]})`,
            '天気': `${utils.weatherEmoji(item.weather[0].id)} ${item.weather[0].description}`,
            '気温': `${Math.round(item.main.temp)}°C`,
            '湿度': `${item.main.humidity}%`,
          });
        });
      } catch(e) {
        rows.push({ '地区': utils.getCityName(city), '日期': '-', '天気': '❌ 取得失敗', '気温': '-', '湿度': '-' });
      }
    }
    return { type: 'table', data: rows };
  }
};
