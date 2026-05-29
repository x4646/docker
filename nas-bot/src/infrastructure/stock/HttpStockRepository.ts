import http from 'http';
import { IStockRepository } from '../../domain/stock/repositories/IStockRepository';
import { Stock, StockData } from '../../domain/stock/entities/Stock';
import { ILogger } from '../../domain/shared/ILogger';

/**
 * 股票仓储HTTP实现
 * 从股票监控服务获取数据
 */
export class HttpStockRepository implements IStockRepository {

  constructor(
    private readonly baseUrl: string,
    private readonly logger:  ILogger,
  ) {}

  async findAll(): Promise<Stock[]> {
    return new Promise((resolve) => {
      http.get(`${this.baseUrl}/api/prices`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const items: StockData[] = JSON.parse(data);
            const stocks = items
              .filter(item => !('error' in item))
              .map(item => new Stock(item));
            this.logger.debug('获取股票数据成功', { count: stocks.length });
            resolve(stocks);
          } catch(e: any) {
            this.logger.error('解析股票数据失败', { error: e.message });
            resolve([]);
          }
        });
      }).on('error', (e) => {
        this.logger.error('获取股票数据失败', { error: e.message });
        resolve([]);
      });
    });
  }

  async findBySymbol(symbol: string): Promise<Stock | null> {
    const all = await this.findAll();
    return all.find(s => s.symbol === symbol) || null;
  }
}
