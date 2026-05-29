import { BaseHandler, ButtonDef, HandlerResponse } from './BaseHandler';
import { MessageContext } from '../middleware/IMiddleware';
import { DockerClient } from '../../../infrastructure/docker/DockerClient';
import { TelegramClient } from '../../../infrastructure/telegram/TelegramClient';
import { KeyboardBuilder } from '../../../infrastructure/telegram/KeyboardBuilder';
import { ILogger } from '../../../domain/shared/ILogger';

export class ExecHandler extends BaseHandler {

  constructor(
    telegram:                   TelegramClient,
    keyboard:                   KeyboardBuilder,
    logger:                     ILogger,
    private readonly docker:    DockerClient,
    private readonly dangerous: string[],
  ) {
    super(telegram, keyboard, logger);
  }

  canHandle(command: string): boolean {
    return command === 'exec';
  }

  /** exec不需要按钮，返回空数组 */
  getButtons(): ButtonDef[] {
    return [];
  }

  async handle(ctx: MessageContext): Promise<HandlerResponse> {
    const cmd = ctx.args.trim();
    if (!cmd) return { text: '用法：exec 命令\n例：exec df -h' };

    if (this.dangerous.some(d => cmd.includes(d))) {
      this.logger.warn('危险命令被拦截', { userId: ctx.userId, cmd });
      return { text: '⛔ 危险命令已拦截' };
    }

    const result = this.docker.execCommand(cmd);
    return {
      text: result.ok
        ? (result.out || '执行完成（无输出）')
        : `❌ 错误：${result.out}`,
    };
  }
}
