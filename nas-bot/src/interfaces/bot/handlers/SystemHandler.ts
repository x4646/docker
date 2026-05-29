import { BaseHandler, ButtonDef, HandlerResponse } from './BaseHandler';
import { MessageContext } from '../middleware/IMiddleware';
import { SystemUseCase } from '../../../application/system/SystemUseCase';
import { TelegramClient } from '../../../infrastructure/telegram/TelegramClient';
import { KeyboardBuilder } from '../../../infrastructure/telegram/KeyboardBuilder';
import { ILogger } from '../../../domain/shared/ILogger';

export class SystemHandler extends BaseHandler {

  constructor(
    telegram:                       TelegramClient,
    keyboard:                       KeyboardBuilder,
    logger:                         ILogger,
    private readonly systemUseCase: SystemUseCase,
  ) {
    super(telegram, keyboard, logger);
  }

  canHandle(command: string): boolean {
    return command === '系统';
  }

  /** 按钮由Dashboard统一管理 */
  getButtons(): ButtonDef[] { return []; }

  async handle(ctx: MessageContext): Promise<HandlerResponse> {
    switch(ctx.args) {
      case '状态': return this.handleStatus();
      case '容器': return this.handleContainers();
      default:
        return { text: '可用指令：\n系统 状态 / 系统 容器' };
    }
  }

  private async handleStatus(): Promise<HandlerResponse> {
    const status = await this.systemUseCase.getStatus();
    return { text: `💾 NAS状态\n内存：${status.memory}\n磁盘：${status.disk}` };
  }

  private async handleContainers(): Promise<HandlerResponse> {
    const containers = await this.systemUseCase.getContainers();
    if (!containers.length) return { text: '没有运行中的容器' };
    const lines = containers.map(c => `▪️ ${c.name}\n   ${c.status}`).join('\n');
    return { text: `🐳 运行中的容器\n\n${lines}` };
  }
}
