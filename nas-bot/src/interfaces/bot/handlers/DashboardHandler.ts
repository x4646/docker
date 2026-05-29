import http  from 'http';
import https from 'https';
import { BaseHandler, ButtonDef, HandlerResponse } from './BaseHandler';
import { MessageContext } from '../middleware/IMiddleware';
import { TelegramClient } from '../../../infrastructure/telegram/TelegramClient';
import { KeyboardBuilder } from '../../../infrastructure/telegram/KeyboardBuilder';
import { ILogger } from '../../../domain/shared/ILogger';

export class DashboardHandler extends BaseHandler {

  private dashButtons: Array<{
    id:    string;
    name:  string;
    icon:  string;
    row:   number;
    order: number;
  }> = [];

  /** 键盘重建回调（由MessageRouter注入）*/
  private onButtonsLoaded: (() => void) | null = null;

  constructor(
    telegram:                      TelegramClient,
    keyboard:                      KeyboardBuilder,
    logger:                        ILogger,
    private readonly dashboardUrl: string,
    private readonly startRow:     number = 5,
  ) {
    super(telegram, keyboard, logger);
    // 延迟2秒等Dashboard启动
    setTimeout(() => this.loadDashButtons(), 2000);
  }

  /**
   * 注册键盘重建回调
   * MessageRouter注册完Handler后调用此方法
   */
  setOnButtonsLoaded(cb: () => void): void {
    this.onButtonsLoaded = cb;
  }

  private async loadDashButtons(): Promise<void> {
    try {
      const data = await this.fetchJson(`${this.dashboardUrl}/api/bot/buttons`);
      if (!Array.isArray(data)) return;

      this.dashButtons = data.map((btn: any, idx: number) => ({
        id:    btn.id,
        name:  btn.name,
        icon:  btn.icon || '⚙️',
        order: btn.order ?? idx,
        row:   this.startRow + Math.floor(idx / 3),
      }));

      this.logger.info('Dashboard按钮已加载', { count: this.dashButtons.length });

      // 通知Router重建键盘
      if (this.onButtonsLoaded) this.onButtonsLoaded();

    } catch(e: any) {
      this.logger.warn('Dashboard按钮加载失败', { error: e.message });
    }
  }

  canHandle(command: string): boolean {
    return this.dashButtons.some(b => b.name === command);
  }

  getButtons(): ButtonDef[] {
    return this.dashButtons.map(btn => ({
      label:  `${btn.icon} ${btn.name}`,
      action: btn.name,
      row:    btn.row,
    }));
  }

  async handle(ctx: MessageContext): Promise<HandlerResponse> {
    const btn = this.dashButtons.find(b => b.name === ctx.command);
    if (!btn) return { text: '❌ 功能不存在' };

    await this.send(ctx.chatId, `⏳ ${btn.icon} ${btn.name} 执行中...`);

    try {
      const result = await this.postJson(
        `${this.dashboardUrl}/api/bot/execute/${btn.id}`, {}
      );
      return { text: result.text || '执行完成' };
    } catch(e: any) {
      return { text: `❌ 执行失败：${e.message}` };
    }
  }

  private fetchJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      mod.get(url, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(e); }
        });
      }).on('error', reject);
    });
  }

  private postJson(url: string, body: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const data = Buffer.from(JSON.stringify(body));
      const u    = new URL(url);
      const mod  = url.startsWith('https') ? https : http;
      const req  = mod.request({
        hostname: u.hostname,
        port:     parseInt(u.port) || (url.startsWith('https') ? 443 : 80),
        path:     u.pathname,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': data.length },
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d)); }
          catch(e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }
}
