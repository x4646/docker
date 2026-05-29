import { Stock } from '../entities/Stock';

export interface IStockRepository {
  findAll(): Promise<Stock[]>;
  findBySymbol(symbol: string): Promise<Stock | null>;
}
