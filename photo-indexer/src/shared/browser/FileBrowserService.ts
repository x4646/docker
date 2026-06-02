import fs from 'fs';
import path from 'path';
import { Database } from '../db/Database';

export interface BrowserRoot {
  id:      number;
  name:    string;
  path:    string;
  source:  'nas' | 'pc';
  enabled: boolean;
}

export interface BrowserItem {
  name:  string;
  path:  string;
  type:  'dir' | 'file';
  size:  number;
  mtime: number;
  ext?:  string;
}

export interface BrowserResult {
  path:    string;
  parent:  string | null;
  items:   BrowserItem[];
  roots:   BrowserRoot[];
}

/**
 * 文件浏览器服务
 * 统一NAS目录浏览，带根目录约束
 */
export class FileBrowserService {

  private readonly db = Database.getInstance();

  // ── 根目录管理 ────────────────────────────────────────
  getRoots(source: 'nas' | 'pc' = 'nas'): BrowserRoot[] {
    return this.db.prepare(
      `SELECT * FROM browser_roots WHERE source = ? AND enabled = 1 ORDER BY name`
    ).all(source) as BrowserRoot[];
  }

  addRoot(name: string, path: string, source: 'nas' | 'pc'): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO browser_roots (name, path, source) VALUES (?, ?, ?)`
    ).run(name, path, source);
  }

  deleteRoot(id: number): void {
    this.db.prepare(`DELETE FROM browser_roots WHERE id = ?`).run(id);
  }

  // ── 目录浏览 ──────────────────────────────────────────
  async listDir(
    dirPath:  string,
    source:   'nas' | 'pc' = 'nas',
    filter?:  string[],  // 文件扩展名过滤
  ): Promise<BrowserResult> {

    // 安全校验：路径必须在允许的根目录下
    const roots = this.getRoots(source);
    const allowed = roots.some(r => dirPath.startsWith(r.path));
    if (!allowed && !roots.some(r => r.path.startsWith(dirPath))) {
      // 允许访问根目录列表
      return {
        path:   '/',
        parent: null,
        items:  roots.map(r => ({
          name:  r.name,
          path:  r.path,
          type:  'dir',
          size:  0,
          mtime: 0,
        })),
        roots,
      };
    }

    // 读取目录（异步非阻塞）
    const items = await this.readDirAsync(dirPath, filter);

    // 计算父目录
    const parentPath = path.dirname(dirPath);
    const isRoot     = roots.some(r => r.path === dirPath);
    const parent     = isRoot ? null : parentPath;

    return { path: dirPath, parent, items, roots };
  }

  private readDirAsync(dirPath: string, filter?: string[]): Promise<BrowserItem[]> {
    return new Promise((resolve) => {
      // 使用setImmediate避免阻塞事件循环
      setImmediate(() => {
        try {
          const names = fs.readdirSync(dirPath);
          const items: BrowserItem[] = [];

          for (const name of names) {
            // 跳过隐藏文件
            if (name.startsWith('.') || name.startsWith('@')) continue;

            const full = path.join(dirPath, name);
            try {
              const stat = fs.statSync(full);
              const ext  = path.extname(name).toLowerCase();

              if (stat.isDirectory()) {
                items.push({ name, path: full, type: 'dir', size: 0, mtime: Math.floor(stat.mtimeMs / 1000) });
              } else {
                // 文件类型过滤
                if (filter && filter.length && !filter.includes(ext)) continue;
                items.push({ name, path: full, type: 'file', size: stat.size, mtime: Math.floor(stat.mtimeMs / 1000), ext });
              }
            } catch(e) {}
          }

          // 目录在前，文件在后，按名称排序
          items.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name, 'ja');
          });

          resolve(items);
        } catch(e) {
          resolve([]);
        }
      });
    });
  }
}
