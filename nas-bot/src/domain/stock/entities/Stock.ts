export interface StockData {
  symbol:     string;
  name:       string;
  price:      number;
  change:     number;
  changePct:  number;
  prevClose:  number;
  currency:   string;
  high:       number | null;
  low:        number | null;
  volume:     number | null;
  marketState: string;
  timestamp:  number;
}

export class Stock {
  private readonly data: StockData;

  constructor(data: StockData) {
    this.data = data;
  }

  get symbol():     string        { return this.data.symbol; }
  get name():       string        { return this.data.name; }
  get price():      number        { return this.data.price; }
  get change():     number        { return this.data.change; }
  get changePct():  number        { return this.data.changePct; }
  get prevClose():  number        { return this.data.prevClose; }
  get currency():   string        { return this.data.currency; }
  get high():       number | null { return this.data.high; }
  get low():        number | null { return this.data.low; }
  get volume():     number | null { return this.data.volume; }
  get marketState():string        { return this.data.marketState; }
  get timestamp():  number        { return this.data.timestamp; }

  isUp():     boolean { return this.data.change > 0; }
  isDown():   boolean { return this.data.change < 0; }
  isNeutral():boolean { return this.data.change === 0; }

  isAbnormal(threshold: number): boolean {
    return Math.abs(this.data.changePct) >= threshold;
  }

  formatChange(): string {
    return (this.data.changePct >= 0 ? '+' : '') + this.data.changePct.toFixed(2) + '%';
  }

  formatPrice(): string {
    const cs = { JPY:'¥', USD:'$', HKD:'HK$', EUR:'€', GBP:'£' };
    const symbol = cs[this.data.currency as keyof typeof cs] || this.data.currency;
    return symbol + (this.data.price > 999
      ? this.data.price.toLocaleString('ja-JP')
      : this.data.price.toFixed(2));
  }

  toDTO(): StockData {
    return { ...this.data };
  }
}
