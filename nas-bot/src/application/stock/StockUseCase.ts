import { IStockRepository } from '../../domain/stock/repositories/IStockRepository';
import { StockDomainService } from '../../domain/stock/services/StockDomainService';
import { ILogger } from '../../domain/shared/ILogger';
import { StockSummaryDTO, StockAlertDTO } from './dto/StockSummaryDTO';

/**
 * 股票用例层
 * 负责编排领域服务，不包含业务逻辑
 * 只依赖接口，不依赖具体实现（依赖倒置）
 */
export class StockUseCase {

  constructor(
    private readonly repository:     IStockRepository,    // 仓储接口（依赖注入）
    private readonly domainService:  StockDomainService,  // 领域服务
    private readonly logger:         ILogger,             // 日志接口
  ) {}

  /**
   * 获取收盘简报
   * 返回DTO，不包含任何格式化逻辑
   */
  async getSummary(): Promise<StockSummaryDTO | null> {
    try {
      const stocks = await this.repository.findAll();
      if (!stocks.length) return null;

      const stats = this.domainService.summary(stocks);
      const best  = this.domainService.findBest(stocks);
      const worst = this.domainService.findWorst(stocks);
      const avg   = this.domainService.avgChangePct(stocks);

      const lines = stocks.map(s =>
        `${s.isUp() ? '▲' : '▼'} ${s.symbol}  ${s.formatChange()}  ${s.formatPrice()}`
      );

      this.logger.info('收盘简报生成成功', { count: stocks.length });

      return {
        lines,
        up:    stats.up,
        down:  stats.down,
        best:  best  ? `${best.symbol} ${best.formatChange()}`   : '—',
        worst: worst ? `${worst.symbol} ${worst.formatChange()}` : '—',
        avgPct: parseFloat(avg.toFixed(2)),
      };

    } catch(e: any) {
      this.logger.error('获取收盘简报失败', { error: e.message });
      return null;
    }
  }

  /**
   * 获取异常股票列表
   * @param threshold 涨跌幅阈值（%）
   */
  async getAbnormal(threshold: number): Promise<StockAlertDTO[]> {
    try {
      const stocks   = await this.repository.findAll();
      const abnormal = this.domainService.filterAbnormal(stocks, threshold);

      return abnormal.map(s => ({
        symbol:    s.symbol,
        changePct: s.changePct,
        price:     s.formatPrice(),
        isUp:      s.isUp(),
      }));

    } catch(e: any) {
      this.logger.error('获取异常股票失败', { error: e.message });
      return [];
    }
  }
}
