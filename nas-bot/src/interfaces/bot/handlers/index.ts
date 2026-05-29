import { MessageRouter } from '../MessageRouter';
import { StockHandler } from './StockHandler';
import { SystemHandler } from './SystemHandler';
import { ExecHandler } from './ExecHandler';
import { AskHandler } from './AskHandler';
import { WeatherHandler } from './WeatherHandler';
import { DashboardHandler } from './DashboardHandler';
import { TelegramClient } from '../../../infrastructure/telegram/TelegramClient';
import { KeyboardBuilder } from '../../../infrastructure/telegram/KeyboardBuilder';
import { ILogger } from '../../../domain/shared/ILogger';
import { IAIStrategy } from '../../../infrastructure/ai/IAIStrategy';
import { DockerClient } from '../../../infrastructure/docker/DockerClient';
import { StockUseCase } from '../../../application/stock/StockUseCase';
import { SystemUseCase } from '../../../application/system/SystemUseCase';
import { WeatherHandler as WeatherHandlerType } from './WeatherHandler';

export interface HandlerDeps {
  telegram:       TelegramClient;
  keyboard:       KeyboardBuilder;
  logger:         ILogger;
  ai:             IAIStrategy;
  docker:         DockerClient;
  stockUseCase:   StockUseCase;
  systemUseCase:  SystemUseCase;
  weatherHandler: WeatherHandlerType;
  config:         any;
}

/**
 * 注册所有Handler
 * ★ 以后加新功能只改这个文件 ★
 */
export function registerAll(
  router: MessageRouter,
  deps:   HandlerDeps,
): { stockHandler: StockHandler } {

  const stockHandler = new StockHandler(
    deps.telegram, deps.keyboard, deps.logger,
    deps.stockUseCase, deps.ai, deps.docker,
    deps.config.STOCK_CONTAINER,
    deps.config.STOCK_PORT,
    deps.config.NAS_IP,
    deps.config.ADMIN,
  );

  router
    .register(stockHandler)
    .register(new SystemHandler(
      deps.telegram, deps.keyboard, deps.logger, deps.systemUseCase,
    ))
    .register(new ExecHandler(
      deps.telegram, deps.keyboard, deps.logger,
      deps.docker, deps.config.DANGEROUS_CMDS,
    ))
    .register(new AskHandler(
      deps.telegram, deps.keyboard, deps.logger, deps.ai,
    ))
    .register(deps.weatherHandler)
    .register(new DashboardHandler(
      deps.telegram, deps.keyboard, deps.logger,
      deps.config.DASHBOARD_URL,
      5, // Dashboard按钮从第5行开始
    ));
    // ← 以后加新Handler在这里加一行

  return { stockHandler };
}
