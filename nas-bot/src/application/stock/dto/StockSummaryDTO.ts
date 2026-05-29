/**
 * 收盘简报数据传输对象
 */
export interface StockSummaryDTO {
  lines:   string[];
  up:      number;
  down:    number;
  best:    string;
  worst:   string;
  avgPct:  number;
}

/**
 * 异常报警数据传输对象
 */
export interface StockAlertDTO {
  symbol:    string;
  changePct: number;
  price:     string;
  isUp:      boolean;
}
