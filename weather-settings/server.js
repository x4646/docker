const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app    = express();
const PORT   = 3010;
const CONFIG = '/data/weather/weather-config.json';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DEFAULT = {
  cities:     ['Sumida'],  // 改成数组
  startHour:  15,
  endHour:    21,
  tempDiff:   5,
  windLimit:  10,
  alertRain:  true,
  alertCloud: false,
  alertSun:   false,
  alertWind:  true,
  alertFog:   false,
  alertSnow:  true,
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
      // 兼容旧版单城市格式
      if (cfg.city && !cfg.cities) {
        cfg.cities = [cfg.city];
        delete cfg.city;
      }
      return cfg;
    }
  } catch(e) {}
  return DEFAULT;
}

function saveConfig(cfg) {
  const dir = path.dirname(CONFIG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
}

app.get('/api/config',       (req, res) => res.json(loadConfig()));
app.post('/api/config',      (req, res) => { saveConfig(req.body); res.json({ ok: true }); });
app.get('/api/config/reset', (req, res) => { saveConfig(DEFAULT); res.json(DEFAULT); });

app.listen(PORT, '0.0.0.0', () => console.log(`Weather Settings running on port ${PORT}`));
