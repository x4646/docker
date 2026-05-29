import https from 'https';
import { IAIStrategy } from './IAIStrategy';
import { ILogger } from '../../domain/shared/ILogger';

/**
 * Claude API实现
 * 预留接口，需要时替换OllamaStrategy即可
 * 调用方（Handler）完全不需要改动（策略模式的价值）
 */
export class ClaudeStrategy implements IAIStrategy {

  constructor(
    private readonly apiKey:  string, // Claude API Key
    private readonly model:   string, // 模型名称
    private readonly timeout: number,
    private readonly logger:  ILogger,
  ) {}

  async ask(prompt: string): Promise<string> {
    const start = Date.now();
    this.logger.debug('调用Claude API', { model: this.model });

    return new Promise((resolve) => {
      const body = Buffer.from(JSON.stringify({
        model:      this.model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }));

      const req = https.request({
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers: {
          'Content-Type':      'application/json',
          'Content-Length':    body.length,
          'x-api-key':         this.apiKey,
          'anthropic-version': '2023-06-01',
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json    = JSON.parse(data);
            const text    = json.content?.[0]?.text || '无回复';
            const elapsed = Date.now() - start;
            this.logger.info('Claude响应完成', { elapsed });
            resolve(text);
          } catch(e) {
            this.logger.error('Claude响应解析失败', { error: String(e) });
            resolve('解析失败');
          }
        });
      });

      req.on('error', (e) => {
        this.logger.error('Claude连接失败', { error: e.message });
        resolve('AI连接失败');
      });

      req.setTimeout(this.timeout, () => {
        req.destroy();
        this.logger.warn('Claude超时');
        resolve('AI响应超时');
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * 检查Claude API是否可用
   */
  async isAvailable(): Promise<boolean> {
    // Claude API无需健康检查端点，直接返回true
    // 实际可用性在ask()中会体现
    return !!this.apiKey;
  }
}
