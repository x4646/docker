import { spawnSync } from 'child_process';
import { ILogger } from '../../domain/shared/ILogger';

export interface DockerResult {
  ok:  boolean;
  out: string;
}

/**
 * Docker客户端
 * 使用spawnSync直接调用命令，不走shell
 * 避免PATH问题导致的ETIMEDOUT
 */
export class DockerClient {

  constructor(
    private readonly logger:  ILogger,
    private readonly timeout: number = 30000,
  ) {}

  /**
   * 执行命令（不走shell，直接调用）
   */
  private exec(bin: string, args: string[], timeout?: number): DockerResult {
    try {
      const result = spawnSync(bin, args, {
        timeout:  timeout || this.timeout,
        encoding: 'utf8',
      });

      if (result.error) {
        this.logger.error('命令执行失败', { bin, args, error: result.error.message });
        return { ok: false, out: result.error.message };
      }

      if (result.status !== 0) {
        const err = (result.stderr || '').trim();
        return { ok: false, out: err || `退出码 ${result.status}` };
      }

      return { ok: true, out: (result.stdout || '').trim() };
    } catch(e: any) {
      this.logger.error('命令异常', { bin, error: e.message });
      return { ok: false, out: e.message };
    }
  }

  /**
   * 执行任意shell命令（用于exec指令）
   * 解析命令字符串为bin+args
   */
  execCommand(cmd: string): DockerResult {
    this.logger.info('执行命令', { cmd });
    const parts = cmd.split(' ').filter(Boolean);
    const bin   = parts[0];
    const args  = parts.slice(1);
    return this.exec(bin, args);
  }

  start(name: string): boolean {
    this.logger.info('启动容器', { name });
    return this.exec('docker', ['start', name]).ok;
  }

  stop(name: string): boolean {
    this.logger.info('停止容器', { name });
    return this.exec('docker', ['stop', name]).ok;
  }

  restart(name: string): boolean {
    this.logger.info('重启容器', { name });
    return this.exec('docker', ['restart', name]).ok;
  }

  isRunning(name: string): boolean | null {
    const r = this.exec('docker', ['inspect', '-f', '{{.State.Running}}', name], 5000);
    if (!r.ok) return null;
    return r.out === 'true';
  }

  listRunning(): Array<{ name: string; status: string }> {
    const r = this.exec('docker', ['ps', '--format', '{{.Names}}||{{.Status}}'], 5000);
    if (!r.ok) return [];
    return r.out.split('\n').filter(Boolean).map(line => {
      const [name, status] = line.split('||');
      return { name, status };
    });
  }
}
