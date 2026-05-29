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
  name:        '明日天气',
  description: '查看明日天气预报',
  icon:        '📅',

  async execute(params) {
    const city = getCity();
    try {
      const data = await fetchJson(
        `https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${API_KEY}&units=metric&lang=zh_cn`
      );
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tDate    = tomorrow.toISOString().split('T')[0];
      const forecast = data.list.find(i => i.dt_txt.startsWith(tDate) && i.dt_txt.includes('12:00')) || data.list[8];
      const emoji    = EMOJI(forecast.weather[0].id);
      return {
        type: 'card',
        data: {
          '地区': data.city.name,
          '天气': `${emoji} ${forecast.weather[0].description}`,
          '气温': `${Math.round(forecast.main.temp)}°C`,
          '湿度': `${forecast.main.humidity}%`,
        }
      };
    } catch(e) {
      return { type: 'error', data: '获取天气失败' };
    }
  }
};
