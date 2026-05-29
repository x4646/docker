import 'reflect-metadata';
import { Container } from './container/Container';
import config from '../config/default';

/**
 * 应用入口
 * 只做三件事：
 * 1. 构建IOC容器
 * 2. 启动Bot
 * 3. 启动调度器
 *
 * 所有细节都在Container里
 */
async function main(): Promise<void> {
  const container = new Container(config).build();

  const bot       = container.getBot();
  const scheduler = container.getScheduler();
  const logger    = container.getLogger();

  // 优雅退出处理
  const shutdown = (signal: string) => {
    logger.info(`收到信号 ${signal}，正在关闭...`);
    bot.stop();
    scheduler.stop();
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 未捕获异常处理
  process.on('uncaughtException', (e) => {
    logger.error('未捕获异常', { error: e.message, stack: e.stack });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('未处理的Promise拒绝', { reason: String(reason) });
  });

  // 启动
  scheduler.start();
  bot.start();

  logger.info('NAS Bot 已启动 🚀');
}

main().catch(console.error);
