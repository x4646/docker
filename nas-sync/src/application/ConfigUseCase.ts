import { ISyncDirRepository } from '../domain/repositories/ISyncDirRepository';
import { SyncDir, SyncMode } from '../domain/entities/SyncDir';
import { FilterRule, FilterConfig } from '../domain/valueObjects/FilterRule';
import fs from 'fs';

export class ConfigUseCase {

  constructor(
    private readonly dirRepo:    ISyncDirRepository,
    private readonly configPath: string,
  ) {}

  async getDirs(): Promise<SyncDir[]> {
    return this.dirRepo.findAll();
  }

  async addDir(nas: string, pc: string, mode: SyncMode = 'mirror'): Promise<SyncDir> {
    const dir = new SyncDir(String(Date.now()), nas, pc, true, mode);
    await this.dirRepo.save(dir);
    return dir;
  }

  async updateDir(id: string, nas: string, pc: string, enabled: boolean, mode: SyncMode = 'mirror'): Promise<SyncDir | null> {
    const dir = await this.dirRepo.findById(id);
    if (!dir) return null;
    const updated = new SyncDir(id, nas, pc, enabled, mode);
    await this.dirRepo.save(updated);
    return updated;
  }

  async deleteDir(id: string): Promise<void> {
    await this.dirRepo.delete(id);
  }

  async toggleDir(id: string): Promise<SyncDir | null> {
    const dir = await this.dirRepo.findById(id);
    if (!dir) return null;
    const updated = new SyncDir(id, dir.nas, dir.pc, !dir.enabled, dir.mode);
    await this.dirRepo.save(updated);
    return updated;
  }

  getFilter(): FilterRule {
    try {
      const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return FilterRule.fromJSON(data.filters || {});
    } catch(e) {
      return FilterRule.fromJSON({});
    }
  }

  saveFilter(config: FilterConfig): void {
    let data: any = {};
    try {
      data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch(e) {}
    data.filters = config;
    fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2));
  }
}
