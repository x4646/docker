import { ILogger } from '../../domain/shared/ILogger';

export class ConsoleLogger implements ILogger {

  private fmt(level: string, message: string, meta?: Record<string, unknown>): string {
    const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const m    = meta ? ' ' + JSON.stringify(meta) : '';
    return `${time} [nas-sync] ${level}: ${message}${m}`;
  }

  info(message: string, meta?: Record<string, unknown>): void {
    console.log(this.fmt('info', message, meta));
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(this.fmt('warn', message, meta));
  }
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(this.fmt('error', message, meta));
  }
  debug(message: string, meta?: Record<string, unknown>): void {
    console.debug(this.fmt('debug', message, meta));
  }
}
