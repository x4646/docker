export type SyncMode = 'mirror' | 'bidirectional' | 'addonly';

/**
 * 同步目录实体
 */
export class SyncDir {
  constructor(
    public readonly id:      string,
    public readonly nas:     string,
    public readonly pc:      string,
    public enabled:          boolean,
    public mode:             SyncMode = 'mirror',
  ) {}

  enable():  void { this.enabled = true; }
  disable(): void { this.enabled = false; }

  toJSON() {
    return {
      id:      this.id,
      nas:     this.nas,
      pc:      this.pc,
      enabled: this.enabled,
      mode:    this.mode,
    };
  }

  static fromJSON(data: any): SyncDir {
    return new SyncDir(
      data.id,
      data.nas,
      data.pc,
      data.enabled ?? true,
      data.mode    || 'mirror',
    );
  }
}
