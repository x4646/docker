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
              this.photoRepo.upsert({ path: full, size: stat.size, mtime: Math.floor(stat.mtimeMs/1000), status: "pending" });
              count++;
            }
          } catch(e) {}
        });
      } catch(e) {}
    };

    walk(dirPath);
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
