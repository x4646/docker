import { SystemDomainService, SystemStatus, ContainerInfo } from '../../domain/system/services/SystemDomainService';
import { ILogger } from '../../domain/shared/ILogger';

/**
 * 系统用例层
 * 编排系统相关操作
 */
export class SystemUseCase {

  constructor(
    private readonly systemService: SystemDomainService, // 系统领域服务
    private readonly logger:        ILogger,             // 日志
  ) {}

  /**
   * 获取NAS系统状态
   */
  async getStatus(): Promise<SystemStatus> {
    this.logger.info('获取系统状态');
    return this.systemService.getStatus();
  }

  /**
   * 获取运行中的容器列表
   */
  async getContainers(): Promise<ContainerInfo[]> {
    this.logger.info('获取容器列表');
    return this.systemService.getContainers();
  }

  /**
   * 启动容器
   * @param name 容器名称
   */
  async startContainer(name: string): Promise<boolean> {
    this.logger.info('启动容器', { name });
    const ok = this.systemService.containerAction('start', name);
    if (!ok) this.logger.warn('容器启动失败', { name });
    return ok;
  }

  /**
   * 停止容器
   * @param name 容器名称
   */
  async stopContainer(name: string): Promise<boolean> {
    this.logger.info('停止容器', { name });
    const ok = this.systemService.containerAction('stop', name);
    if (!ok) this.logger.warn('容器停止失败', { name });
    return ok;
  }

  /**
   * 获取容器状态
   * @param name 容器名称
   */
  async getContainerStatus(name: string): Promise<string> {
    return this.systemService.containerStatus(name);
  }
}
