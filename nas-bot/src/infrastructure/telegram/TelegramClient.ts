import https from 'https';
import { ILogger } from '../../domain/shared/ILogger';

export interface SendOptions {
  parse_mode?:   string;
  reply_markup?: Record<string, unknown>;
}

export class TelegramClient {

  constructor(
    private readonly token:   string,
    private readonly logger:  ILogger,
    private readonly timeout: number = 10000,
  ) {}

  private request(
    method:     string,
    params:     Record<string, unknown>,
    reqTimeout: number = this.timeout,
    retries:    number = 3,
  ): Promise<any> {
    return new Promise((resolve) => {
      const attempt = (remaining: number) => {
        const body = Buffer.from(JSON.stringify(params));

        const req = https.request({
          hostname: 'api.telegram.org',
          path:     `/bot${this.token}/${method}`,
          method:   'POST',
          headers: {
            'Content-Type':   'application/json',
            'Content-Length': body.length,
          },
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try   { resolve(JSON.parse(data)); }
            catch { resolve(null); }
          });
        });

        req.on('error', (e) => {
          if (remaining > 1) {
            this.logger.warn('Telegram请求失败，重试中', { method, remaining: remaining - 1 });
            setTimeout(() => attempt(remaining - 1), 1000);
          } else {
            this.logger.error('Telegram请求失败', { method, error: e.message });
            resolve(null);
          }
        });

        req.setTimeout(reqTimeout, () => {
          req.destroy();
          if (remaining > 1) {
            this.logger.warn('Telegram请求超时，重试中', { method, remaining: remaining - 1 });
            setTimeout(() => attempt(remaining - 1), 1000);
          } else {
            this.logger.warn('Telegram请求超时', { method });
            resolve(null);
          }
        });

        req.write(body);
        req.end();
      };

      attempt(retries);
    });
  }

  async sendMessage(
    chatId: string | number,
    text:   string,
    opts:   SendOptions = {},
  ): Promise<boolean> {
    const truncated = text.length > 4000
      ? text.substring(0, 4000) + '\n...(截断)'
      : text;

    const result = await this.request('sendMessage', {
      chat_id: chatId,
      text:    truncated,
      ...opts,
    }, this.timeout, 3);

    if (!result?.ok) {
      this.logger.warn('消息发送失败', { chatId, error: result?.description });
      return false;
    }
    return true;
  }

  async getUpdates(offset: number, timeout: number = 30): Promise<any[]> {
    const reqTimeout = (timeout + 5) * 1000;
    const result = await this.request('getUpdates', {
      offset,
      timeout,
      allowed_updates: ['message'],
    }, reqTimeout, 1); // 长轮询不重试

    return result?.ok ? result.result : [];
  }
}
