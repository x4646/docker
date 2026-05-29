import { IMiddleware, MessageContext } from './IMiddleware';
import { ILogger } from '../../../domain/shared/ILogger';

/**
 * 日志中间件
 * 记录所有指令的执行时间和结果
 * 不影响主流程，只做记录
 */
export class LogMiddleware implements IMiddleware {

  constructor(private readonly logger: ILogger) {}

  async handle(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
    const start = Date.now();
    this.logger.info('收到指令', {
      userId:  ctx.userId,
      command: ctx.command,
      args:    ctx.args,
    });

    await next();

    const elapsed = Date.now() - start;
    this.logger.info('指令处理完成', { command: ctx.command, elapsed });
  }
}
