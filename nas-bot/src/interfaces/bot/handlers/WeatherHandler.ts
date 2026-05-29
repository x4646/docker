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

  private lastSnapshot: WeatherSnapshot | null = null;
  private readonly configPath = '/data/weather-config.json';

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
      this.logger.warn('天气配置读取失败，使用默认配置');
    }
    return this.defaultConfig;
  }

  canHandle(command: string): boolean {
    return command === '天气';
  }

  /** 按钮由Dashboard统一管理 */
  getButtons(): ButtonDef[] { return []; }

  async handle(ctx: MessageContext): Promise<HandlerResponse> {
    const cfg   = this.getConfig();
    const parts = ctx.args.split(' ');
    const type  = parts[0] || '今日';
    const city  = parts[1] || (cfg.cities && cfg.cities[0]) || 'Sumida';

    switch(type) {
      case '今日':   return this.handleToday(city);
      case '明日':   return this.handleTomorrow(city);
      case '一週間': return this.handleWeek(city);
      default:
        return { text: '用法：\n天气 今日\n天气 明日\n天气 一週間' };
    }
  }

  async checkWeatherAlert(): Promise<void> {
    const cfg  = this.getConfig();
    const city = (cfg.cities && cfg.cities[0]) || 'Sumida';
    const data = await this.fetchWeather(city);
    if (!data) return;

    const current: WeatherSnapshot = {
      temp:      Math.round(data.main.temp),
      weatherId: data.weather[0].id,
      wind:      data.wind.speed,
      desc:      data.weather[0].description,
    };

    if (!this.lastSnapshot) {
      this.lastSnapshot = current;
      this.logger.info('天气基准快照已记录', { temp: current.temp, desc: current.desc });
      return;
    }

    const alerts: string[] = [];

    if (cfg.alertRain) {
      const wasRain = this.lastSnapshot.weatherId >= 500 && this.lastSnapshot.weatherId < 600;
      const isRain  = current.weatherId >= 500 && current.weatherId < 600;
      if (!wasRain && isRain)  alerts.push(`🌧 开始下雨：${current.desc}`);
      if (wasRain  && !isRain) alerts.push(`☀️ 雨已停止：${current.desc}`);

      const wasThunder = this.lastSnapshot.weatherId >= 200 && this.lastSnapshot.weatherId < 300;
      const isThunder  = current.weatherId >= 200 && current.weatherId < 300;
      if (!wasThunder && isThunder) alerts.push(`⛈ 雷雨警告：${current.desc}`);
    }

    if (cfg.alertSnow) {
      const wasSnow = this.lastSnapshot.weatherId >= 600 && this.lastSnapshot.weatherId < 700;
      const isSnow  = current.weatherId >= 600 && current.weatherId < 700;
      if (!wasSnow && isSnow) alerts.push(`❄️ 开始降雪：${current.desc}`);
    }

    if (cfg.alertFog) {
      const wasFog = this.lastSnapshot.weatherId >= 700 && this.lastSnapshot.weatherId < 800;
      const isFog  = current.weatherId >= 700 && current.weatherId < 800;
      if (!wasFog && isFog) alerts.push(`🌫 雾霾警告：${current.desc}`);
    }

    if (cfg.alertCloud) {
      const wasClear = this.lastSnapshot.weatherId === 800;
      const isCloud  = current.weatherId > 800;
      if (wasClear && isCloud) alerts.push(`☁️ 天气转阴：${current.desc}`);
    }

    if (cfg.alertSun) {
      const isSunny  = current.weatherId === 800 && current.temp >= 30;
      const wasSunny = this.lastSnapshot.weatherId === 800 && this.lastSnapshot.temp >= 30;
      if (!wasSunny && isSunny) alerts.push(`☀️ 高温暴晒：${current.temp}°C 注意防晒`);
    }

    const tempChange = current.temp - this.lastSnapshot.temp;
    if (Math.abs(tempChange) >= cfg.tempDiff) {
      alerts.push(`${tempChange > 0 ? '📈' : '📉'} 气温变化 ${this.lastSnapshot.temp}°C → ${current.temp}°C`);
    }

    if (cfg.alertWind) {
      const wasWind = this.lastSnapshot.wind >= cfg.windLimit;
      const isWind  = current.wind >= cfg.windLimit;
      if (!wasWind && isWind)  alerts.push(`💨 大风警告：${current.wind.toFixed(1)} m/s`);
      if (wasWind  && !isWind) alerts.push(`💨 风速已恢复：${current.wind.toFixed(1)} m/s`);
    }

    if (alerts.length > 0) {
      await this.send(this.adminId,
        `⚠️ ${city} 天气变化\n━━━━━━━━━━━━\n${alerts.join('\n')}\n━━━━━━━━━━━━\n现在：${current.temp}°C ${current.desc}`
      );
    }

    this.lastSnapshot = current;
  }

  private async handleToday(city: string): Promise<HandlerResponse> {
    const data = await this.fetchWeather(city);
    if (!data) return { text: '❌ 获取天气失败' };
    const emoji = this.getEmoji(data.weather[0].id);
    return {
      text:
        `${emoji} ${data.name} 今日天气\n━━━━━━━━━━━━\n` +
        `天气：${data.weather[0].description}\n` +
        `气温：${Math.round(data.main.temp)}°C（体感 ${Math.round(data.main.feels_like)}°C）\n` +
        `湿度：${data.main.humidity}%\n風速：${data.wind.speed} m/s`,
    };
  }

  private async handleTomorrow(city: string): Promise<HandlerResponse> {
    const data = await this.fetchForecast(city);
    if (!data) return { text: '❌ 获取天气失败' };
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
    if (!data) return { text: '❌ 获取天气失败' };
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
