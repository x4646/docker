import { WinstonLogger } from '../infrastructure/logger/WinstonLogger';
import { TelegramClient } from '../infrastructure/telegram/TelegramClient';
import { KeyboardBuilder } from '../infrastructure/telegram/KeyboardBuilder';
import { OllamaStrategy } from '../infrastructure/ai/OllamaStrategy';
import { DockerClient } from '../infrastructure/docker/DockerClient';
import { HttpStockRepository } from '../infrastructure/stock/HttpStockRepository';
import { StockDomainService } from '../domain/stock/services/StockDomainService';
import { SystemDomainService } from '../domain/system/services/SystemDomainService';
import { StockUseCase } from '../application/stock/StockUseCase';
import { SystemUseCase } from '../application/system/SystemUseCase';
import { StockHandler } from '../interfaces/bot/handlers/StockHandler';
import { WeatherHandler } from '../interfaces/bot/handlers/WeatherHandler';
import { MessageRouter } from '../interfaces/bot/MessageRouter';
import { BotCore } from '../interfaces/bot/BotCore';
import { EventBus } from '../core/EventBus';
import { Scheduler } from '../interfaces/scheduler/Scheduler';
import { IAIStrategy } from '../infrastructure/ai/IAIStrategy';
import { registerAll } from '../interfaces/bot/handlers/index';
import { AuthMiddleware } from '../interfaces/bot/middleware/AuthMiddleware';
import { LogMiddleware } from '../interfaces/bot/middleware/LogMiddleware';
import { RateLimitMiddleware } from '../interfaces/bot/middleware/RateLimitMiddleware';

export class Container {

  private logger!:         WinstonLogger;
  private telegram!:       TelegramClient;
  private keyboard!:       KeyboardBuilder;
  private ai!:             IAIStrategy;
  private docker!:         DockerClient;
  private eventBus!:       EventBus;
  private router!:         MessageRouter;
  private bot!:            BotCore;
  private scheduler!:      Scheduler;
  private stockHandler!:   StockHandler;
  private weatherHandler!: WeatherHandler;

  constructor(private readonly config: any) {}

  build(): this {

    // ── 基础设施 ──────────────────────────────────────
    this.logger   = new WinstonLogger('nas-bot', this.config.LOG_DIR || '/data/logs');
    this.telegram = new TelegramClient(this.config.TOKEN, this.logger);
    this.keyboard = new KeyboardBuilder().resize().persistent();
    this.ai       = new OllamaStrategy(
      this.config.OLLAMA,
      this.config.AI_MODEL,
      this.config.AI_TIMEOUT,
      this.logger,
    );
    this.docker   = new DockerClient(this.logger);
    this.eventBus = new EventBus(this.logger);

    // ── 领域层 ────────────────────────────────────────
    const stockDomainService  = new StockDomainService();
    const systemDomainService = new SystemDomainService();

    // ── 仓储层 ────────────────────────────────────────
    const stockRepo = new HttpStockRepository(this.config.STOCK, this.logger);

    // ── 应用层 ────────────────────────────────────────
    const stockUseCase  = new StockUseCase(stockRepo, stockDomainService, this.logger);
    const systemUseCase = new SystemUseCase(systemDomainService, this.logger);

    // ── WeatherHandler（从配置文件动态读取设置）──────
    this.weatherHandler = new WeatherHandler(
      this.telegram,
      this.keyboard,
      this.logger,
      this.config.WEATHER_API_KEY,
      this.config.ADMIN,
    );

    // ── 路由 ──────────────────────────────────────────
    this.router = new MessageRouter(this.telegram, this.keyboard, this.logger)
      .use(new LogMiddleware(this.logger))
      .use(new AuthMiddleware(this.config.ADMIN, this.telegram, this.logger))
      .use(new RateLimitMiddleware(
        this.config.RATE_LIMIT_MAX,
        this.config.RATE_LIMIT_WINDOW,
        this.telegram,
        this.logger,
      ));

    // ── 注册所有Handler ───────────────────────────────
    const { stockHandler } = registerAll(this.router, {
      telegram:       this.telegram,
      keyboard:       this.keyboard,
      logger:         this.logger,
      ai:             this.ai,
      docker:         this.docker,
      stockUseCase,
      systemUseCase,
      config:         this.config,
      weatherHandler: this.weatherHandler,
    });
    this.stockHandler = stockHandler;

    // ── Bot核心 ───────────────────────────────────────
    this.bot = new BotCore(this.telegram, this.router, this.logger);

    // ── 定时调度器 ────────────────────────────────────
    this.scheduler = new Scheduler(this.eventBus, this.logger, {
      summaryHour:      this.config.SUMMARY_HOUR,
      summaryMin:       this.config.SUMMARY_MIN,
      alertInterval:    this.config.ALERT_INTERVAL,
      weatherStartHour: this.config.WEATHER_START_HOUR,
      weatherEndHour:   this.config.WEATHER_END_HOUR,
      marketHours:      this.config.MARKET_HOURS,
    });

    // ── 事件订阅 ──────────────────────────────────────
    this.eventBus.subscribe('market_close', () => {
      this.stockHandler.handleSummaryEvent(this.config.ADMIN);
    });
    this.eventBus.subscribe('check_alerts', () => {
      this.stockHandler.checkAlerts(this.config.ALERT_PCT);
    });
    this.eventBus.subscribe('weather_check', () => {
      this.weatherHandler.checkWeatherAlert();
    });

    this.logger.info('IOC容器构建完成');
    return this;
  }

  getBot():       BotCore       { return this.bot; }
  getScheduler(): Scheduler     { return this.scheduler; }
  getLogger():    WinstonLogger  { return this.logger; }
}
