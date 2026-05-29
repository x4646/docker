import { Stock } from '../entities/Stock';

export class StockDomainService {

  // 找出最强涨幅
  findBest(stocks: Stock[]): Stock | null {
    if (!stocks.length) return null;
    return stocks.reduce((a, b) => a.changePct > b.changePct ? a : b);
  }

  // 找出最弱跌幅
  findWorst(stocks: Stock[]): Stock | null {
    if (!stocks.length) return null;
    return stocks.reduce((a, b) => a.changePct < b.changePct ? a : b);
  }

  // 过滤异常股票
  filterAbnormal(stocks: Stock[], threshold: number): Stock[] {
    return stocks.filter(s => s.isAbnormal(threshold));
  }

  // 统计涨跌
  summary(stocks: Stock[]): { up: number; down: number; neutral: number } {
    return {
      up:      stocks.filter(s => s.isUp()).length,
      down:    stocks.filter(s => s.isDown()).length,
      neutral: stocks.filter(s => s.isNeutral()).length,
    };
  }

  // 平均涨跌幅
  avgChangePct(stocks: Stock[]): number {
    if (!stocks.length) return 0;
    return stocks.reduce((s, p) => s + p.changePct, 0) / stocks.length;
  }
}
