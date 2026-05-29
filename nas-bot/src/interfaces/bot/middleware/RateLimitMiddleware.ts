import { IMiddleware, MessageContext } from './IMiddleware';
import { TelegramClient } from '../../../infrastructure/telegram/TelegramClient';
import { ILogger } from '../../../domain/shared/ILogger';

/**
 * 限流中间件
 * 防止同一用户短时间内频繁发送指令
 * 使用滑动窗口算法
 */
export class RateLimitMiddleware implements IMiddleware {

  /** 记录每个用户的请求时间戳 */
  private readonly userRequests = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,  // 时间窗口内最大请求数
    private readonly windowMs:    number,  // 时间窗口（ms）
    private readonly telegram:    TelegramClient,
    private readonly logger:      ILogger,
  ) {}

  async handle(ctx: MessageContext, next: () => Promise<void>): Promise<void> {
    const now       = Date.now();
    const userId    = ctx.userId;
    const requests  = this.userRequests.get(userId) || [];

    // 清理过期的请求记录（滑动窗口）
    const valid = requests.filter(t => now - t < this.windowMs);

    if (valid.length >= this.maxRequests) {
      this.logger.warn('触发限流', { userId, count: valid.length });
      await this.telegram.sendMessage(
        ctx.chatId,
        `⚠️ 请求太频繁，请${Math.ceil(this.windowMs / 1000)}秒后再试`
      );
      return; // 阻断责任链
    }

    // 记录本次请求
    valid.push(now);
    this.userRequests.set(userId, valid);

    await next();
  }
}
