import fs from 'fs';
import path from 'path';
import { ISyncDirRepository } from '../../domain/repositories/ISyncDirRepository';
import { SyncDir } from '../../domain/entities/SyncDir';

/**
 * JSON文件实现的同步目录仓储
 * 以后换SQLite只需新建SqliteSyncDirRepository实现同一接口
 */
export class JsonSyncDirRepository implements ISyncDirRepository {

  constructor(private readonly filePath: string) {
    // 确保目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private read(): SyncDir[] {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return (data.dirs || []).map(SyncDir.fromJSON);
    } catch(e) { return []; }
  }

  private write(dirs: SyncDir[]): void {
    const existing = this.readRaw();
    existing.dirs  = dirs.map(d => d.toJSON());
    fs.writeFileSync(this.filePath, JSON.stringify(existing, null, 2));
  }

  private readRaw(): any {
    try {
      if (fs.existsSync(this.filePath)) return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch(e) {}
    return { dirs: [], filters: {} };
  }

  async findAll(): Promise<SyncDir[]> {
    return this.read();
  }

  async findById(id: string): Promise<SyncDir | null> {
    return this.read().find(d => d.id === id) || null;
  }

  async save(dir: SyncDir): Promise<void> {
    const dirs = this.read();
    const idx  = dirs.findIndex(d => d.id === dir.id);
    if (idx >= 0) dirs[idx] = dir;
    else dirs.push(dir);
    this.write(dirs);
  }

  async delete(id: string): Promise<void> {
    const dirs = this.read().filter(d => d.id !== id);
    this.write(dirs);
  }
}
