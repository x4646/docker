import { BaseHandler, ButtonDef, HandlerResponse } from './BaseHandler';
import { MessageContext } from '../middleware/IMiddleware';
import { IAIStrategy } from '../../../infrastructure/ai/IAIStrategy';
import { TelegramClient } from '../../../infrastructure/telegram/TelegramClient';
import { KeyboardBuilder } from '../../../infrastructure/telegram/KeyboardBuilder';
import { ILogger } from '../../../domain/shared/ILogger';

export class AskHandler extends BaseHandler {

  private aiMode: boolean = false;

  constructor(
    telegram:               TelegramClient,
    keyboard:               KeyboardBuilder,
    logger:                 ILogger,
    private readonly ai:    IAIStrategy,
  ) {
    super(telegram, keyboard, logger);
  }

  canHandle(command: string): boolean {
    return command === '问' || command === 'ai';
  }

  /** 按钮由Dashboard统一管理 */
  getButtons(): ButtonDef[] { return []; }

  async handle(ctx: MessageContext): Promise<HandlerResponse> {
    const { command, args, chatId } = ctx;

    if (command === 'ai') {
      if (args === '开启') {
        this.aiMode = true;
        return { text: '🤖 AI对话模式已开启\n直接发消息就能问AI\n发「ai 关闭」退出' };
      }
      if (args === '关闭') {
        this.aiMode = false;
        return { text: '🔕 AI对话模式已关闭' };
      }
      return { text: '用法：ai 开启 / ai 关闭' };
    }

    if (command === '问') {
      if (!args) return { text: '用法：问 你的问题\n例：问 日元为什么贬值' };
      return this.askAI(chatId, args);
    }

    return { text: '' };
  }

  isAiMode(): boolean { return this.aiMode; }

  async handleFreeChat(ctx: MessageContext): Promise<HandlerResponse> {
    return this.askAI(ctx.chatId, ctx.text);
  }

  private async askAI(chatId: string, question: string): Promise<HandlerResponse> {
    await this.send(chatId, '🤖 思考中，请稍等...');
    const answer = await this.ai.ask(question);
    return { text: `🤖 ${answer}` };
  }
}
