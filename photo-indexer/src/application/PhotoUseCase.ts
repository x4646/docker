import { IPhotoRepository, PhotoQuery } from '../domain/repositories/IPhotoRepository';
import { Photo } from '../domain/entities/Photo';
import { ILogger } from '../domain/shared/ILogger';
import http from 'http';

export class PhotoUseCase {

  constructor(
    private readonly photoRepo: IPhotoRepository,
    private readonly logger:    ILogger,
    private readonly pipeUrl:   string,
    private readonly dataPath:  string,
  ) {}

  // ── 图片查询 ──────────────────────────────────────────
  getPhotos(query: PhotoQuery) {
    return this.photoRepo.findAll(query);
  }

  getPhoto(id: number) {
    return this.photoRepo.findById(id);
  }

  getStats() {
    return this.photoRepo.countByStatus();
  }

  getTags() {
    return (this.photoRepo as any).getAllTags();
  }

  // ── 图片处理 ──────────────────────────────────────────
  addPhoto(path: string, size: number, mtime: number): void {
    this.photoRepo.upsert({ path, size, mtime, status: 'pending' });
    this.logger.info('新图片入队', { path });
  }

  deletePhoto(path: string): void {
    this.photoRepo.delete(path);
  }

  async scanDir(dirPath: string): Promise<number> {
    const fs   = require("fs");
    const path = require("path");
    const EXTS = new Set([".jpg",".jpeg",".png",".heic",".webp",".gif",".bmp",".tiff",".raw"]);
    let count  = 0;

    const walk = (dir: string) => {
      try {
        fs.readdirSync(dir).forEach((name: string) => {
          const full = path.join(dir, name);
          try {
            const stat = fs.statSync(full);
            if (stat.isDirectory() && !name.startsWith("@") && !name.startsWith(".")) walk(full);
            else if (EXTS.has(path.extname(name).toLowerCase())) {
              const newMtime  = Math.floor(stat.mtimeMs / 1000);
              const newCtime  = Math.floor(stat.ctimeMs / 1000);
              const byPath    = (this.photoRepo as any).findByPath(full);
              if (byPath) {
                // 路径匹配：mtime没变跳过，mtime变了重新处理
                if (byPath.status === "done" && byPath.mtime !== newMtime) {
                  this.photoRepo.upsert({ path: full, size: stat.size, mtime: newMtime, status: "pending" });
                  count++;
                }
              } else {
                // 路径没找到：用size+ctime查找，可能是文件移动了
                const bySizeCtime = (this.photoRepo as any).findBySizeCtime(stat.size, newCtime);
                const matched     = bySizeCtime.find((r: any) => r.status === "done");
                if (matched) {
                  // 文件移动了，更新路径，复用缩略图
                  (this.photoRepo as any).updatePath(matched.path, full);
                } else {
                  // 全新文件
                  this.photoRepo.upsert({ path: full, size: stat.size, mtime: newMtime, status: "pending" });
                  count++;
                }
              }
            }
          } catch(e) {}
        });
      } catch(e) {}
    };
    walk(dirPath);
    // 清理孤立记录：数据库有但文件不存在的
    const existing = (this.photoRepo as any).db.prepare("SELECT path FROM photos WHERE path LIKE ?").all(dirPath + "/%");
    let deleted = 0;
    for (const photo of existing) {
      if (!fs.existsSync(photo.path)) {
        (this.photoRepo as any).db.prepare("DELETE FROM photos WHERE path = ?").run(photo.path);
        deleted++;
      }
    }
    if (deleted > 0) this.logger.info("清理孤立记录", { dir: dirPath, deleted });
    this.logger.info("目录扫描完成", { dir: dirPath, count });
    return count;
  }
  // ── 接收电脑处理结果 ──────────────────────────────────
  receiveResult(path: string, data: any): void {
    // 用file_key查找已有记录，避免重复处理
    if (data.file_key) {
      const existing = (this.photoRepo as any).findByFileKey(data.file_key);
      if (existing && existing.path !== path) {
        // 路径变了但file_key相同，更新路径即可，复用缩略图
        (this.photoRepo as any).updatePath(existing.path, path, data.file_key);
        this.logger.info("路径更新（复用缩略图）", { old: existing.path, new: path });
        return;
      }
    }
    this.photoRepo.updateResult(path, {
      thumbPath:   data.thumb_path   || null,
      previewPath: data.preview_path || null,
      md5:         data.md5          || null,
      width:       data.width        || null,
      height:      data.height       || null,
      exifTime:    data.exif_time    || null,
      exifCamera:  data.exif_camera  || null,
      exifGps:     data.exif_gps     || null,
      phash:       data.phash        || null,
      aiDesc:      data.ai_desc      || null,
      aiTags:      data.ai_tags      || [],
      ctime:       data.ctime        || null,
      status:      'done',
    });
    this.logger.info('图片处理完成', { path });
  }

  // ── 推送待处理图片给电脑 ──────────────────────────────
  async dispatchPending(): Promise<number> {
    const pending = this.photoRepo.findPending(20);
    let sent = 0;
    for (const photo of pending) {
      try {
        await this.sendTask({
          type:    'photo_process',
          task_id: String(photo.id),
          path:    photo.path,
          data_path: this.dataPath,
        });
        this.photoRepo.markStatus(photo.path, 'processing');
        sent++;
      } catch(e: any) {
        this.logger.warn('推送失败', { path: photo.path, error: e.message });
      }
    }
    return sent;
  }


  async dispatchPendingByDir(dirPath: string): Promise<number> {
    const db      = (this.photoRepo as any).db;
    const pending = db.prepare(
      "SELECT * FROM photos WHERE path LIKE ? AND status = 'pending' ORDER BY created_at ASC LIMIT 50"
    ).all(dirPath + "/%");
    let sent = 0;
    for (const photo of pending) {
      try {
        await this.sendTask({
          type:      'photo_process',
          task_id:   String(photo.id),
          path:      photo.path,
          data_path: this.dataPath,
        });
        db.prepare("UPDATE photos SET status='processing' WHERE path=?").run(photo.path);
        sent++;
      } catch(e: any) {
        this.logger.warn('推送失败', { path: photo.path });
      }
    }
    return sent;
  }
  // ── 标签和收藏 ────────────────────────────────────────
  updateTags(id: number, tags: string[]): void {
    (this.photoRepo as any).updateUserTags(id, tags);
  }

  toggleFavorite(id: number): boolean {
    return (this.photoRepo as any).toggleFavorite(id);
  }

  private sendTask(task: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const body = Buffer.from(JSON.stringify(task));
      const u    = new URL(this.pipeUrl + '/api/task');
      const req  = http.request({
        hostname: u.hostname,
        port:     parseInt(u.port),
        path:     u.pathname,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': body.length },
      }, (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => resolve());
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
