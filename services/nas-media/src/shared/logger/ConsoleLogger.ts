import { ILogger } from '../types/ILogger';

export class ConsoleLogger implements ILogger {
  constructor(private readonly name: string) {}

  private fmt(level: string, msg: string, meta?: Record<string, unknown>): string {
    const t = new Date().toISOString().replace('T',' ').substring(0,19);
    const m = meta ? ' ' + JSON.stringify(meta) : '';
    return `${t} [${this.name}] ${level}: ${msg}${m}`;
  }

  info(msg: string, meta?: Record<string, unknown>)  { console.log(this.fmt('info',  msg, meta)); }
  warn(msg: string, meta?: Record<string, unknown>)  { console.warn(this.fmt('warn', msg, meta)); }
  error(msg: string, meta?: Record<string, unknown>) { console.error(this.fmt('error',msg, meta)); }
  debug(msg: string, meta?: Record<string, unknown>) { console.debug(this.fmt('debug',msg, meta)); }
}
