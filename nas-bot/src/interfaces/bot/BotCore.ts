import { TelegramClient } from '../../infrastructure/telegram/TelegramClient';
import { MessageRouter } from './MessageRouter';
import { ILogger } from '../../domain/shared/ILogger';

/**
 * Bot核心
 * 职责：
 * 1. 管理Bot生命周期（启动/停止）
 * 2. 长轮询获取消息
 * 3. 转发给MessageRouter处理
 * 4. 错误统一捕获
 *
 * 不包含任何业务逻辑，只做消息的收发调度
 */
export class BotCore {

  private running:  boolean          = false;
  private offset:   number           = 0;
  private timer:    NodeJS.Timeout | null = null;

  constructor(
    private readonly telegram: TelegramClient,
    private readonly router:   MessageRouter,
    private readonly logger:   ILogger,
    private readonly pollTimeout: number = 30, // 长轮询超时秒数
  ) {}

  /**
   * 启动Bot
   */
  start(): void {
    if (this.running) {
      this.logger.warn('Bot已在运行中');
      return;
    }
    this.running = true;
    this.logger.info('Bot启动');
    this.poll();
  }

  /**
   * 停止Bot
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.info('Bot已停止');
  }

  /**
   * 长轮询
   * 获取消息后立即处理，处理完再次轮询
   */
  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const updates = await this.telegram.getUpdates(
        this.offset,
        this.pollTimeout
      );

      for (const update of updates) {
        // 更新offset，防止重复处理
        this.offset = update.update_id + 1;

        if (update.message) {
          // 异步处理，不阻塞轮询
          this.handleMessage(update.message);
        }
      }

    } catch(e: any) {
      this.logger.error('轮询出错', { error: e.message });
    }

    // 继续轮询
    if (this.running) {
      this.timer = setTimeout(() => this.poll(), 1000);
    }
  }

  /**
   * 处理单条消息
   * 统一错误捕获
   */
  private async handleMessage(msg: any): Promise<void> {
    try {
      await this.router.dispatch(msg);
    } catch(e: any) {
      this.logger.error('消息处理失败', {
        error:  e.message,
        chatId: msg.chat?.id,
        text:   msg.text,
      });

      // 发送错误提示给用户
      try {
        await this.telegram.sendMessage(
          String(msg.chat.id),
          '❌ 处理出错，请稍后重试'
        );
      } catch {}
    }
  }
}
