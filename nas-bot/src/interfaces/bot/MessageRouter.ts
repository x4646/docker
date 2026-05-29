import { BaseHandler } from './handlers/BaseHandler';
import { DashboardHandler } from './handlers/DashboardHandler';
import { AskHandler } from './handlers/AskHandler';
import { IMiddleware, MessageContext } from './middleware/IMiddleware';
import { TelegramClient } from '../../infrastructure/telegram/TelegramClient';
import { KeyboardBuilder } from '../../infrastructure/telegram/KeyboardBuilder';
import { ILogger } from '../../domain/shared/ILogger';

export class MessageRouter {

  private readonly handlers:    BaseHandler[]  = [];
  private readonly middlewares: IMiddleware[]  = [];
  private btnMap = new Map<string, string>();
  private askHandler: AskHandler | null = null;

  constructor(
    private readonly telegram: TelegramClient,
    private readonly keyboard: KeyboardBuilder,
    private readonly logger:   ILogger,
  ) {}

  register(handler: BaseHandler): this {
    this.handlers.push(handler);

    if (handler instanceof AskHandler) {
      this.askHandler = handler;
    }

    // DashboardHandler异步加载按钮后重建键盘
    if (handler instanceof DashboardHandler) {
      handler.setOnButtonsLoaded(() => {
        this.logger.info('Dashboard按钮加载完成，重建键盘');
        handler.getButtons().forEach(btn => {
          this.btnMap.set(btn.label, btn.action);
        });
        this.rebuildKeyboard();
      });
    }

    handler.getButtons().forEach(btn => {
      this.btnMap.set(btn.label, btn.action);
    });

    this.rebuildKeyboard();

    this.logger.debug('Handler已注册', {
      handler: handler.constructor.name,
      buttons: handler.getButtons().length,
    });
    return this;
  }

  private rebuildKeyboard(): void {
    const rowMap = new Map<number, string[]>();

    this.handlers.forEach(handler => {
      handler.getButtons().forEach(btn => {
        const row = rowMap.get(btn.row) || [];
        if (!row.includes(btn.label)) row.push(btn.label);
        rowMap.set(btn.row, row);
      });
    });

    (this.keyboard as any).rows = [];

    Array.from(rowMap.keys())
      .sort((a, b) => a - b)
      .forEach(rowNum => {
        this.keyboard.row(rowMap.get(rowNum)!);
      });

    this.keyboard.row(['❓ 帮助']);
    this.btnMap.set('❓ 帮助', '帮助');
  }

  use(middleware: IMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  async dispatch(msg: any): Promise<void> {
    const raw  = (msg.text || '').trim();
    const text = this.btnMap.get(raw) || raw;

    const parts   = text.split(' ');
    const command = parts[0] || '';
    const args    = parts.slice(1).join(' ');

    const ctx: MessageContext = {
      chatId:   String(msg.chat.id),
      text,
      command,
      args,
      userId:   String(msg.from?.id || ''),
      username: msg.from?.username,
      meta:     {},
    };

    await this.runMiddlewares(ctx, 0, async () => {
      await this.runHandler(ctx);
    });
  }

  private async runMiddlewares(
    ctx:   MessageContext,
    index: number,
    final: () => Promise<void>,
  ): Promise<void> {
    if (index >= this.middlewares.length) {
      await final();
      return;
    }
    await this.middlewares[index].handle(ctx, () =>
      this.runMiddlewares(ctx, index + 1, final)
    );
  }

  private async runHandler(ctx: MessageContext): Promise<void> {
    if (ctx.command === '/start' || ctx.command === '帮助') {
      await this.telegram.sendMessage(ctx.chatId,
        'NAS控制中心\n\n点下方按钮快速操作\n或输入 exec 命令 执行Shell',
        { reply_markup: this.keyboard.build() }
      );
      return;
    }

    const handler = this.handlers.find(h => h.canHandle(ctx.command));

    if (handler) {
      const response = await handler.handle(ctx);
      if (response.text) {
        await this.telegram.sendMessage(ctx.chatId, response.text, {
          reply_markup: this.keyboard.build(),
        });
      }
      return;
    }

    if (this.askHandler?.isAiMode()) {
      const response = await this.askHandler.handleFreeChat(ctx);
      if (response.text) {
        await this.telegram.sendMessage(ctx.chatId, response.text, {
          reply_markup: this.keyboard.build(),
        });
      }
      return;
    }

    await this.telegram.sendMessage(
      ctx.chatId,
      '❓ 没听懂，发「帮助」查看指令\n或发「问 你的问题」问AI',
      { reply_markup: this.keyboard.build() }
    );
  }
}
