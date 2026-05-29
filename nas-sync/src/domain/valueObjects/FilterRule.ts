/**
 * 过滤规则值对象
 * 决定哪些文件应该被排除在同步之外
 */
export interface FilterConfig {
  excludeExt:  string[];  // 排除扩展名 ['.tmp', '.log']
  excludeDir:  string[];  // 排除目录名 ['node_modules', '.git']
  excludeGlob: string[];  // 通配符规则 ['~$*', '*.bak']
  minSize:     number;    // 最小文件大小（字节）
  maxSize:     number;    // 最大文件大小（字节）
}

export class FilterRule {

  constructor(private readonly config: FilterConfig) {}

  /**
   * 判断文件是否应该被排除
   */
  shouldExclude(filePath: string, size: number = 0): boolean {
    const name = filePath.split('/').pop() || '';
    const ext  = name.includes('.') ? '.' + name.split('.').pop() : '';

    // 检查扩展名
    if (this.config.excludeExt.includes(ext.toLowerCase())) return true;

    // 检查目录名
    const parts = filePath.split('/');
    if (parts.some(p => this.config.excludeDir.includes(p))) return true;

    // 检查通配符
    if (this.config.excludeGlob.some(g => this.matchGlob(name, g))) return true;

    // 检查文件大小
    if (size > 0 && size < this.config.minSize) return true;
    if (size > 0 && this.config.maxSize > 0 && size > this.config.maxSize) return true;

    return false;
  }

  /**
   * 简单通配符匹配
   * 支持 * 和 ? 
   */
  private matchGlob(name: string, pattern: string): boolean {
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`, 'i').test(name);
  }

  toJSON(): FilterConfig {
    return { ...this.config };
  }

  static fromJSON(data: any): FilterRule {
    return new FilterRule({
      excludeExt:  data.excludeExt  || [],
      excludeDir:  data.excludeDir  || [],
      excludeGlob: data.excludeGlob || [],
      minSize:     data.minSize     || 0,
      maxSize:     data.maxSize     || 0,
    });
  }
}
