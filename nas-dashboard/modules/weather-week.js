const https = require('https');
const fs    = require('fs');

const API_KEY = '95f6885e043c782e21cb7fa152fad7d6';
const CONFIG  = '/data/weather-config.json';

function getCity() {
  try {
    if (fs.existsSync(CONFIG)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
      return (cfg.cities && cfg.cities[0]) || cfg.city || 'Sumida';
    }
  } catch(e) {}
  return 'Sumida';
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

const EMOJI = (code) => {
  if (code >= 200 && code < 300) return '⛈';
  if (code >= 500 && code < 600) return '🌧';
  if (code >= 600 && code < 700) return '❄️';
  if (code === 800) return '☀️';
  if (code > 800) return '⛅';
  return '🌤';
};

module.exports = {
  name:        '一週間天気',
  description: '查看未来7天天气预报',
  icon:        '📆',

  async execute(params) {
    const city = getCity();
    try {
      const data = await fetchJson(
        `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${API_KEY}&units=metric&lang=zh_cn`
      );

      const dailyMap = new Map();
      data.list.forEach(item => {
        const date = item.dt_txt.split(' ')[0];
        if (!dailyMap.has(date) || item.dt_txt.includes('12:00')) {
          dailyMap.set(date, item);
        }
      });

      const weekDays = ['日','月','火','水','木','金','土'];
      const rows = Array.from(dailyMap.entries()).slice(0, 7).map(([date, item]) => {
        const d  = new Date(date);
        const wd = weekDays[d.getDay()];
        return {
          日期:   `${d.getMonth()+1}/${d.getDate()}(${wd})`,
          天気:   `${EMOJI(item.weather[0].id)} ${item.weather[0].description}`,
          気温:   `${Math.round(item.main.temp)}°C`,
          湿度:   `${item.main.humidity}%`,
          風速:   `${item.wind.speed}m/s`,
        };
      });

      return { type: 'table', title: `${data.city.name} 一週間天気`, data: rows };
    } catch(e) {
      return { type: 'error', data: '获取天气失败' };
    }
  }
};
