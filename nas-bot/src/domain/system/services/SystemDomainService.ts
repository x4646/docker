import { execSync } from 'child_process';

export interface SystemStatus {
  memory: string;
  disk:   string;
}

export interface ContainerInfo {
  name:   string;
  status: string;
}

export class SystemDomainService {

  private exec(cmd: string): { ok: boolean; out: string } {
    try {
      return { ok: true, out: execSync(cmd, { timeout: 10000 }).toString().trim() };
    } catch(e: any) {
      return { ok: false, out: e.message };
    }
  }

  getStatus(): SystemStatus {
    const memory = this.exec("free -h | grep Mem | awk '{print $3\"/\"$2}'").out;
    const disk   = this.exec("df -h / | tail -1 | awk '{print $3\"/\"$2\" 已用\"$5}'").out;
    return { memory, disk };
  }

  getContainers(): ContainerInfo[] {
    const r = this.exec("docker ps --format '{{.Names}}||{{.Status}}'");
    if (!r.ok) return [];
    return r.out.split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, status] = line.split('||');
        return { name, status };
      });
  }

  containerAction(action: string, name: string): boolean {
    return this.exec(`docker ${action} ${name}`).ok;
  }

  containerStatus(name: string): string {
    const r = this.exec(`docker inspect -f '{{.State.Running}}' ${name}`);
    if (!r.ok) return '未找到';
    return r.out === 'true' ? '运行中' : '已停止';
  }
}
