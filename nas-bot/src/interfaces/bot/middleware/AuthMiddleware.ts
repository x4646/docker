import { IMiddleware, MessageContext } from './IMiddleware';
import { TelegramClient } from '../../../infrastructure/telegram/TelegramClient';
import { ILogger } from '../../../domain/shared/ILogger';

/**
 * 权限验证中间件
 * 只允许管理员ID通过
 * 非管理员直接拒绝，不传递给下一个中间件
 */
export class AuthMiddleware implements IMiddleware {

  constructor(
    private readonly adminId:  string,
    private readonly telegram: TelegramClient,
    private readonly logger:   ILogger,
  ) {}

  async handle(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
    if (ctx.userId !== this.adminId) {
      this.logger.warn('未授权访问', { userId: ctx.userId, username: ctx.username });
      await this.telegram.sendMessage(ctx.chatId, '⛔ 无权限');
      return; // 不调用next，阻断责任链
    }
    await next(); // 通过验证，继续传递
  }
}
