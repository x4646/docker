import { SyncDir } from '../entities/SyncDir';

/**
 * 同步目录仓储接口
 * 依赖倒置：应用层依赖此接口，不依赖具体实现
 */
export interface ISyncDirRepository {
  findAll(): Promise<SyncDir[]>;
  findById(id: string): Promise<SyncDir | null>;
  save(dir: SyncDir): Promise<void>;
  delete(id: string): Promise<void>;
}
