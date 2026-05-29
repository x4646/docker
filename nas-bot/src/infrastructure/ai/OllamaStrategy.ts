import http from 'http';
import { IAIStrategy } from './IAIStrategy';
import { ILogger } from '../../domain/shared/ILogger';

/**
 * Ollama本地AI实现
 * 实现IAIStrategy接口
 * 调用本地Ollama服务进行推理
 */
export class OllamaStrategy implements IAIStrategy {

  constructor(
    private readonly baseUrl: string, // Ollama服务地址
    private readonly model:   string, // 模型名称
    private readonly timeout: number, // 超时时间(ms)
    private readonly logger:  ILogger,
  ) {}

  /**
   * 发送提示词给Ollama，获取回复
   */
  async ask(prompt: string): Promise<string> {
    const start = Date.now();
    this.logger.debug('调用Ollama', { model: this.model, promptLength: prompt.length });

    return new Promise((resolve) => {
      const body = Buffer.from(JSON.stringify({
        model:  this.model,
        prompt,
        stream: false,
      }));

      const url = new URL(this.baseUrl + '/api/generate');
      const req = http.request({
        hostname: url.hostname,
        port:     parseInt(url.port) || 80,
        path:     url.pathname,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': body.length,
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json     = JSON.parse(data);
            const response = json.response || '无回复';
            const elapsed  = Date.now() - start;
            this.logger.info('Ollama响应完成', { elapsed, model: this.model });
            resolve(response);
          } catch(e) {
            this.logger.error('Ollama响应解析失败', { error: String(e) });
            resolve('解析失败');
          }
        });
      });

      req.on('error', (e) => {
        this.logger.error('Ollama连接失败', { error: e.message });
        resolve('AI连接失败');
      });

      req.setTimeout(this.timeout, () => {
        req.destroy();
        this.logger.warn('Ollama超时', { timeout: this.timeout });
        resolve('AI响应超时');
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * 检查Ollama是否可用
   */
  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const url = new URL(this.baseUrl);
      const req = http.request({
        hostname: url.hostname,
        port:     parseInt(url.port) || 80,
        path:     '/api/tags',
        method:   'GET',
      }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(3000, () => { req.destroy(); resolve(false); });
      req.end();
    });
  }
}
