import winston from 'winston';
import { ILogger } from '../../domain/shared/ILogger';

/**
 * Winston日志实现
 * 实现ILogger接口
 * 特性：
 * - 按日期滚动日志文件
 * - 控制台彩色输出
 * - 结构化JSON格式存储
 * - 区分开发/生产环境
 */
export class WinstonLogger implements ILogger {

  private readonly logger: winston.Logger;

  constructor(
    private readonly service: string,  // 服务名称（用于日志标识）
    private readonly logDir:  string,  // 日志目录
  ) {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',

      // 日志格式：时间戳 + 服务名 + 结构化数据
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json(),
      ),

      defaultMeta: { service: this.service },

      transports: [
        // 控制台输出（开发环境友好）
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
              const metaStr = Object.keys(meta).length
                ? ' ' + JSON.stringify(meta)
                : '';
              return `${timestamp} [${service}] ${level}: ${message}${metaStr}`;
            }),
          ),
        }),

        // 普通日志文件（每天滚动）
        new winston.transports.File({
          filename: `${logDir}/app-%DATE%.log`,
          maxsize:  10 * 1024 * 1024, // 10MB
          maxFiles: 7,                 // 保留7天
        }),

        // 错误日志单独存储
        new winston.transports.File({
          filename: `${logDir}/error.log`,
          level:    'error',
          maxsize:  10 * 1024 * 1024,
          maxFiles: 30,
        }),
      ],
    });
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.logger.info(message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.logger.warn(message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.logger.error(message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.logger.debug(message, meta);
  }
}
