import { BaseHandler, ButtonDef, HandlerResponse } from './BaseHandler';
import { MessageContext } from '../middleware/IMiddleware';
import { StockUseCase } from '../../../application/stock/StockUseCase';
import { IAIStrategy } from '../../../infrastructure/ai/IAIStrategy';
import { TelegramClient } from '../../../infrastructure/telegram/TelegramClient';
import { KeyboardBuilder } from '../../../infrastructure/telegram/KeyboardBuilder';
import { ILogger } from '../../../domain/shared/ILogger';
import { DockerClient } from '../../../infrastructure/docker/DockerClient';

export class StockHandler extends BaseHandler {

  private readonly alertedToday = new Set<string>();

  constructor(
    telegram:                       TelegramClient,
    keyboard:                       KeyboardBuilder,
    logger:                         ILogger,
    private readonly stockUseCase:  StockUseCase,
    private readonly ai:            IAIStrategy,
    private readonly docker:        DockerClient,
    private readonly containerName: string,
    private readonly servicePort:   number,
    private readonly nasIp:         string,
    private readonly adminId:       string,
  ) {
    super(telegram, keyboard, logger);
  }

  canHandle(command: string): boolean {
    return command === '股票';
  }

  /** 按钮由Dashboard统一管理，不在这里硬编码 */
  getButtons(): ButtonDef[] { return []; }

  async handle(ctx: MessageContext): Promise<HandlerResponse> {
    const { args, chatId } = ctx;
    switch(args) {
      case '开启': case '启动': return this.handleStart(chatId);
      case '关闭': case '停止': return this.handleStop(chatId);
      case '状态':              return this.handleStatus();
      case '链接': case '地址': return this.handleLink();
      case '简报':              return this.handleSummary(chatId);
      case '检测':              return this.handleCheck(chatId);
      default:
        return { text: '可用指令：\n股票 开启/关闭/状态/链接/简报/检测' };
    }
  }

  private async handleStart(chatId: string): Promise<HandlerResponse> {
    await this.send(chatId, '▶️ 正在启动...');
    const ok = this.docker.start(this.containerName);
    return { text: ok ? `✅ 股票监控已启动\nhttp://${this.nasIp}:${this.servicePort}` : '❌ 启动失败' };
  }

  private async handleStop(chatId: string): Promise<HandlerResponse> {
    await this.send(chatId, '⏹️ 正在停止...');
    const ok = this.docker.stop(this.containerName);
    return { text: ok ? '✅ 股票监控已停止' : '❌ 停止失败' };
  }

  private async handleStatus(): Promise<HandlerResponse> {
    const running = this.docker.isRunning(this.containerName);
    const status  = running === null ? '未找到' : running ? '✅ 运行中' : '⛔ 已停止';
    return { text: `股票监控\n状态：${status}` };
  }

  private async handleLink(): Promise<HandlerResponse> {
    const running = this.docker.isRunning(this.containerName);
    const status  = running === null ? '未找到' : running ? '✅ 运行中' : '⛔ 已停止';
    return { text: `股票监控\n状态：${status}\nhttp://${this.nasIp}:${this.servicePort}` };
  }

  private async handleSummary(chatId: string): Promise<HandlerResponse> {
    const dto = await this.stockUseCase.getSummary();
    if (!dto) return { text: '❌ 获取价格数据失败' };

    await this.send(chatId,
      `📊 收盘简报\n━━━━━━━━━━━━\n` +
      dto.lines.join('\n') + '\n━━━━━━━━━━━━\n' +
      `上涨 ${dto.up} | 下跌 ${dto.down}\n最强：${dto.best}\n最弱：${dto.worst}\n\n🤖 AI简评生成中...`
    );

    const comment = await this.ai.ask(
      `用中文50字以内简评今日股市：${dto.lines.join('，')}，上涨${dto.up}支下跌${dto.down}支。简洁专业。`
    );
    await this.send(chatId, `🤖 AI简评：\n${comment}`);
    return { text: '' };
  }

  private async handleCheck(chatId: string): Promise<HandlerResponse> {
    const alerts = await this.stockUseCase.getAbnormal(0);
    if (!alerts.length) return { text: '✅ 当前无异常波动' };
    const lines = alerts.map(a =>
      `${a.isUp ? '🚀' : '📉'} ${a.symbol} ${a.changePct >= 0 ? '+' : ''}${a.changePct}% ${a.price}`
    ).join('\n');
    return { text: `🔔 当前异常股票\n\n${lines}` };
  }

  async handleSummaryEvent(chatId: string): Promise<void> {
    await this.handleSummary(chatId);
  }

  async checkAlerts(threshold: number): Promise<void> {
    const alerts = await this.stockUseCase.getAbnormal(threshold);
    for (const alert of alerts) {
      const key = `${alert.symbol}_${new Date().toDateString()}`;
      if (this.alertedToday.has(key)) continue;
      this.alertedToday.add(key);
      await this.send(this.adminId,
        `${alert.isUp ? '🚀' : '📉'} ${alert.symbol} 大幅变动\n变动：${alert.changePct >= 0 ? '+' : ''}${alert.changePct}%\n现价：${alert.price}\n\n🤖 AI分析中...`
      );
      const comment = await this.ai.ask(
        `${alert.symbol}今日${alert.isUp ? '上涨' : '下跌'}${Math.abs(alert.changePct)}%，30字以内简短提示：`
      );
      await this.send(this.adminId, `🤖 ${alert.symbol}：\n${comment}`);
    }
  }
}
