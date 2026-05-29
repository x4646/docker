import { IEventBus, DomainEvent } from '../../domain/shared/events/DomainEvent';
import { ILogger } from '../../domain/shared/ILogger';

export class MarketCloseEvent  extends DomainEvent { constructor() { super('market_close'); } }
export class CheckAlertsEvent  extends DomainEvent { constructor() { super('check_alerts'); } }
export class WeatherCheckEvent extends DomainEvent { constructor() { super('weather_check'); } }

/**
 * 定时调度器
 * 每分钟tick一次，按时间发布对应事件
 */
export class Scheduler {

  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger:   ILogger,
    private readonly config: {
      summaryHour:       number;
      summaryMin:        number;
      alertInterval:     number;
      weatherStartHour:  number;  // 天气判断开始（15）
      weatherEndHour:    number;  // 天气判断结束（21）
      marketHours: Array<{ start: number; end: number }>;
    }
  ) {}

  start(): void {
    this.logger.info('定时调度器启动', {
      summaryTime:  `${this.config.summaryHour}:${String(this.config.summaryMin).padStart(2,'0')}`,
      weatherCheck: `${this.config.weatherStartHour}:00 ~ ${this.config.weatherEndHour}:00 毎時`,
    });
    this.timer = setInterval(() => this.tick(), 60000);
    this.tick();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.logger.info('定时调度器已停止');
  }

  private tick(): void {
    const now = new Date();
    const h   = now.getHours();
    const m   = now.getMinutes();
    const hm  = h * 60 + m;

    // 收盘简报
    if (h === this.config.summaryHour && m === this.config.summaryMin) {
      this.logger.info('触发收盘简报');
      this.eventBus.publish(new MarketCloseEvent());
    }

    // 股票异常检测（交易时间内每5分钟）
    const inMarket = this.config.marketHours.some(
      p => hm >= p.start && hm <= p.end
    );
    if (inMarket && m % this.config.alertInterval === 0) {
      this.eventBus.publish(new CheckAlertsEvent());
    }

    // 天气检测（15:00~21:00 毎時00分）
    if (h >= this.config.weatherStartHour &&
        h <  this.config.weatherEndHour &&
        m === 0) {
      this.logger.info('触发天气检测', { hour: h });
      this.eventBus.publish(new WeatherCheckEvent());
    }
  }
}
