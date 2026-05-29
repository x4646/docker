import { TelegramClient } from '../../../infrastructure/telegram/TelegramClient';
import { KeyboardBuilder } from '../../../infrastructure/telegram/KeyboardBuilder';
import { ILogger } from '../../../domain/shared/ILogger';
import { MessageContext } from '../middleware/IMiddleware';

/**
 * 按钮声明
 */
export interface ButtonDef {
  label:  string;  // 按钮显示文字
  action: string;  // 映射到的指令
  row:    number;  // 所在行（从0开始）
}

/**
 * Handler响应
 */
export interface HandlerResponse {
  text:   string;
  async?: boolean;
  task?:  () => Promise<void>;
}

/**
 * BaseHandler基类
 * 子类只需实现：
 * - canHandle()  判断是否处理
 * - handle()     处理逻辑
 * - getButtons() 声明自己的按钮（可选）
 */
export abstract class BaseHandler {

  constructor(
    protected readonly telegram: TelegramClient,
    protected readonly keyboard: KeyboardBuilder,
    protected readonly logger:   ILogger,
  ) {}

  /** 判断是否能处理该指令 */
  abstract canHandle(command: string): boolean;

  /** 处理指令 */
  abstract handle(ctx: MessageContext): Promise<HandlerResponse>;

  /**
   * 声明自己的按钮
   * 不需要按钮的Handler不用重写此方法
   */
  getButtons(): ButtonDef[] {
    return [];
  }

  /** 发送消息（带键盘） */
  protected async send(chatId: string, text: string): Promise<void> {
    await this.telegram.sendMessage(chatId, text, {
      reply_markup: this.keyboard.build(),
    });
  }

  /** 先发即时回复，再异步执行耗时任务 */
  protected async sendThenAsync(
    chatId:   string,
    quickMsg: string,
    task:     () => Promise<void>,
  ): Promise<void> {
    await this.send(chatId, quickMsg);
    task().catch(e => this.logger.error('异步任务失败', { error: e.message }));
  }
}
