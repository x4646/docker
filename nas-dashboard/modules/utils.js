const https = require('https');
const fs    = require('fs');

const API_KEY = '95f6885e043c782e21cb7fa152fad7d6';
const CONFIG  = '/data/weather/weather-config.json';

function getCities() {
  try {
    if (fs.existsSync(CONFIG)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
      return cfg.cities || (cfg.city ? [cfg.city] : ['Sumida']);
    }
  } catch(e) {}
  return ['Sumida'];
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

function weatherEmoji(code) {
  if (code >= 200 && code < 300) return '⛈';
  if (code >= 500 && code < 600) return '🌧';
  if (code >= 600 && code < 700) return '❄️';
  if (code === 800) return '☀️';
  if (code > 800) return '⛅';
  return '🌤';
}

function fetchWeather(city) {
  return fetchJson(`https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${API_KEY}&units=metric&lang=zh_cn`);
}

function fetchForecast(city) {
  return fetchJson(`https://api.openweathermap.org/data/2.5/forecast?q=${city}&appid=${API_KEY}&units=metric&lang=zh_cn`);
}

module.exports = { getCities, fetchJson, fetchWeather, fetchForecast, weatherEmoji };
