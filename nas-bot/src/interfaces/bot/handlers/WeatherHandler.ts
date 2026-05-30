import https from 'https';
import fs from 'fs';
import { BaseHandler, ButtonDef, HandlerResponse } from './BaseHandler';
import { MessageContext } from '../middleware/IMiddleware';
import { TelegramClient } from '../../../infrastructure/telegram/TelegramClient';
import { KeyboardBuilder } from '../../../infrastructure/telegram/KeyboardBuilder';
import { ILogger } from '../../../domain/shared/ILogger';

interface WeatherConfig {
  cities:     string[];
  startHour:  number;
  endHour:    number;
  tempDiff:   number;
  windLimit:  number;
  alertRain:  boolean;
  alertCloud: boolean;
  alertSun:   boolean;
  alertWind:  boolean;
  alertFog:   boolean;
  alertSnow:  boolean;
}

interface WeatherSnapshot {
  temp:      number;
  weatherId: number;
  wind:      number;
  desc:      string;
}

export class WeatherHandler extends BaseHandler {

  private lastSnapshots = new Map<string, WeatherSnapshot>();
  private readonly configPath = '/data/weather/weather-config.json';

  private readonly defaultConfig: WeatherConfig = {
    cities:     ['Sumida'],
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

  constructor(
    telegram:                    TelegramClient,
    keyboard:                    KeyboardBuilder,
    logger:                      ILogger,
    private readonly apiKey:     string,
    private readonly adminId:    string,
  ) {
    super(telegram, keyboard, logger);
  }

  private getConfig(): WeatherConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        return { ...this.defaultConfig, ...JSON.parse(fs.readFileSync(this.configPath, 'utf8')) };
      }
    } catch(e) {
      this.logger.warn('天気配置読取失敗、デフォルト使用');
    }
    return this.defaultConfig;
  }

  canHandle(command: string): boolean {
    return command === '天气';
  }

  getButtons(): ButtonDef[] { return []; }

  async handle(ctx: MessageContext): Promise<HandlerResponse> {
    const cfg    = this.getConfig();
    const parts  = ctx.args.split(' ');
    const type   = parts[0] || '今日';
    const cities = parts[1]
      ? [parts[1]]
      : (cfg.cities && cfg.cities.length ? cfg.cities : ['Sumida']);

    const results: string[] = [];
    for (const city of cities) {
      let res: HandlerResponse;
      switch(type) {
        case '今日':   res = await this.handleToday(city);    break;
        case '明日':   res = await this.handleTomorrow(city); break;
        case '一週間': res = await this.handleWeek(city);     break;
        default: return { text: '用法：\n天気 今日\n天気 明日\n天気 一週間' };
      }
      if (res.text) results.push(res.text);
    }
    return { text: results.join('\n\n━━━━━━━━━━━━\n\n') };
  }

  async checkWeatherAlert(): Promise<void> {
    const cfg    = this.getConfig();
    const cities = (cfg.cities && cfg.cities.length) ? cfg.cities : ['Sumida'];

    for (const city of cities) {
      const data = await this.fetchWeather(city);
      if (!data) continue;

      const current: WeatherSnapshot = {
        temp:      Math.round(data.main.temp),
        weatherId: data.weather[0].id,
        wind:      data.wind.speed,
        desc:      data.weather[0].description,
      };

      const snapshot = this.lastSnapshots.get(city);

      if (!snapshot) {
        this.lastSnapshots.set(city, current);
        this.logger.info('天気基準記録', { city, temp: current.temp, desc: current.desc });
        continue;
      }

      const alerts: string[] = [];

      if (cfg.alertRain) {
        const wasRain    = snapshot.weatherId >= 500 && snapshot.weatherId < 600;
        const isRain     = current.weatherId  >= 500 && current.weatherId  < 600;
        const wasThunder = snapshot.weatherId >= 200 && snapshot.weatherId < 300;
        const isThunder  = current.weatherId  >= 200 && current.weatherId  < 300;
        if (!wasRain && isRain)       alerts.push(`🌧 開始降雨：${current.desc}`);
        if (wasRain  && !isRain)      alerts.push(`☀️ 雨已停止：${current.desc}`);
        if (!wasThunder && isThunder) alerts.push(`⛈ 雷雨警告：${current.desc}`);
      }

      if (cfg.alertSnow) {
        const wasSnow = snapshot.weatherId >= 600 && snapshot.weatherId < 700;
        const isSnow  = current.weatherId  >= 600 && current.weatherId  < 700;
        if (!wasSnow && isSnow) alerts.push(`❄️ 開始降雪：${current.desc}`);
      }

      if (cfg.alertFog) {
        const wasFog = snapshot.weatherId >= 700 && snapshot.weatherId < 800;
        const isFog  = current.weatherId  >= 700 && current.weatherId  < 800;
        if (!wasFog && isFog) alerts.push(`🌫 霧霾警告：${current.desc}`);
      }

      if (cfg.alertCloud) {
        const wasClear = snapshot.weatherId === 800;
        const isCloud  = current.weatherId  >  800;
        if (wasClear && isCloud) alerts.push(`☁️ 天気転陰：${current.desc}`);
      }

      if (cfg.alertSun) {
        const isSunny  = current.weatherId  === 800 && current.temp  >= 30;
        const wasSunny = snapshot.weatherId === 800 && snapshot.temp >= 30;
        if (!wasSunny && isSunny) alerts.push(`☀️ 高温暴晒：${current.temp}°C 注意防晒`);
      }

      const tempChange = current.temp - snapshot.temp;
      if (Math.abs(tempChange) >= cfg.tempDiff) {
        alerts.push(`${tempChange > 0 ? '📈' : '📉'} 気温変化 ${snapshot.temp}°C → ${current.temp}°C`);
      }

      if (cfg.alertWind) {
        const wasWind = snapshot.wind >= cfg.windLimit;
        const isWind  = current.wind  >= cfg.windLimit;
        if (!wasWind && isWind)  alerts.push(`💨 大風警告：${current.wind.toFixed(1)} m/s`);
        if (wasWind  && !isWind) alerts.push(`💨 風速恢復：${current.wind.toFixed(1)} m/s`);
      }

      if (alerts.length > 0) {
        await this.send(this.adminId,
          `⚠️ ${city} 天気変化\n━━━━━━━━━━━━\n${alerts.join('\n')}\n━━━━━━━━━━━━\n現在：${current.temp}°C ${current.desc}`
        );
      }

      this.lastSnapshots.set(city, current);
    }
  }

  private async handleToday(city: string): Promise<HandlerResponse> {
    const data = await this.fetchWeather(city);
    if (!data) return { text: `❌ ${city} 天気取得失敗` };
    const emoji = this.getEmoji(data.weather[0].id);
    return {
      text:
        `${emoji} ${data.name} 今日天気\n━━━━━━━━━━━━\n` +
        `天気：${data.weather[0].description}\n` +
        `気温：${Math.round(data.main.temp)}°C（体感 ${Math.round(data.main.feels_like)}°C）\n` +
        `湿度：${data.main.humidity}%\n風速：${data.wind.speed} m/s`,
    };
  }

  private async handleTomorrow(city: string): Promise<HandlerResponse> {
    const data = await this.fetchForecast(city);
    if (!data) return { text: `❌ ${city} 天気取得失敗` };
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tDate    = tomorrow.toISOString().split('T')[0];
    const forecast = data.list.find((i: any) =>
      i.dt_txt.startsWith(tDate) && i.dt_txt.includes('12:00')
    ) || data.list[8];
    const emoji = this.getEmoji(forecast.weather[0].id);
    return {
      text:
        `${emoji} ${data.city.name} 明日天気\n━━━━━━━━━━━━\n` +
        `天気：${forecast.weather[0].description}\n` +
        `気温：${Math.round(forecast.main.temp)}°C\n湿度：${forecast.main.humidity}%`,
    };
  }

  private async handleWeek(city: string): Promise<HandlerResponse> {
    const data = await this.fetchForecast(city);
    if (!data) return { text: `❌ ${city} 天気取得失敗` };
    const dailyMap = new Map<string, any>();
    data.list.forEach((item: any) => {
      const date = item.dt_txt.split(' ')[0];
      if (!dailyMap.has(date) || item.dt_txt.includes('12:00')) dailyMap.set(date, item);
    });
    const days     = Array.from(dailyMap.entries()).slice(0, 7);
    const weekDays = ['日','月','火','水','木','金','土'];
    const lines    = days.map(([date, item]) => {
      const d  = new Date(date);
      const wd = weekDays[d.getDay()];
      return `${d.getMonth()+1}/${d.getDate()}(${wd}) ${this.getEmoji(item.weather[0].id)} ${Math.round(item.main.temp)}°C ${item.weather[0].description}`;
    });
    return { text: `📆 ${data.city.name} 一週間天気\n━━━━━━━━━━━━\n${lines.join('\n')}` };
  }

  private fetchWeather(city: string): Promise<any> {
    return this.fetchJson(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${this.apiKey}&units=metric&lang=zh_cn`);
  }

  private fetchForecast(city: string): Promise<any> {
    return this.fetchJson(`https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${this.apiKey}&units=metric&lang=zh_cn`);
  }

  private fetchJson(url: string): Promise<any> {
    return new Promise((resolve) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.cod && json.cod !== 200 && json.cod !== '200') resolve(null);
            else resolve(json);
          } catch(e) { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });
  }

  private getEmoji(code: number): string {
    if (code >= 200 && code < 300) return '⛈';
    if (code >= 300 && code < 400) return '🌦';
    if (code >= 500 && code < 600) return '🌧';
    if (code >= 600 && code < 700) return '❄️';
    if (code >= 700 && code < 800) return '🌫';
    if (code === 800) return '☀️';
    if (code > 800) return '⛅';
    return '🌤';
  }
}
