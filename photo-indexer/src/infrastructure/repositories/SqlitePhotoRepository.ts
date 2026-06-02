import Database from 'better-sqlite3';
import { PhotoDb } from '../db/Database';
import { Photo, PhotoStatus } from '../../domain/entities/Photo';
import { IPhotoRepository, PhotoQuery } from '../../domain/repositories/IPhotoRepository';

export class SqlitePhotoRepository implements IPhotoRepository {

  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = PhotoDb.getInstance(dbPath);
  }

  upsert(data: Partial<Photo> & { path: string }): void {
    this.db.prepare(`
      INSERT INTO photos (path, thumb_path, preview_path, size, mtime, md5,
        width, height, exif_time, exif_camera, exif_gps, phash,
        ai_desc, ai_tags, user_tags, favorite, status, updated_at)
      VALUES (@path, @thumb_path, @preview_path, @size, @mtime, @md5,
        @width, @height, @exif_time, @exif_camera, @exif_gps, @phash,
        @ai_desc, @ai_tags, @user_tags, @favorite, @status, strftime('%s','now'))
      ON CONFLICT(path) DO UPDATE SET
        thumb_path   = COALESCE(excluded.thumb_path,   thumb_path),
        preview_path = COALESCE(excluded.preview_path, preview_path),
        size         = excluded.size,
        mtime        = excluded.mtime,
        md5          = COALESCE(excluded.md5,          md5),
        width        = COALESCE(excluded.width,        width),
        height       = COALESCE(excluded.height,       height),
        exif_time    = COALESCE(excluded.exif_time,    exif_time),
        exif_camera  = COALESCE(excluded.exif_camera,  exif_camera),
        exif_gps     = COALESCE(excluded.exif_gps,     exif_gps),
        phash        = COALESCE(excluded.phash,        phash),
        ai_desc      = COALESCE(excluded.ai_desc,      ai_desc),
        ai_tags      = COALESCE(excluded.ai_tags,      ai_tags),
        status       = excluded.status,
        updated_at   = strftime('%s','now')
    `).run({
      path:         data.path,
      thumb_path:   data.thumbPath   || null,
      preview_path: data.previewPath || null,
      size:         data.size        || 0,
      mtime:        data.mtime       || 0,
      md5:          data.md5         || null,
      width:        data.width       || null,
      height:       data.height      || null,
      exif_time:    data.exifTime    || null,
      exif_camera:  data.exifCamera  || null,
      exif_gps:     data.exifGps     || null,
      phash:        data.phash       || null,
      ai_desc:      data.aiDesc      || null,
      ai_tags:      JSON.stringify(data.aiTags   || []),
      user_tags:    JSON.stringify(data.userTags || []),
      favorite:     data.favorite ? 1 : 0,
      status:       data.status  || 'pending',
    });
  }

  findById(id: number): Photo | null {
    const row = this.db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
    return row ? Photo.fromRow(row) : null;
  }

  findByPath(path: string): Photo | null {
    const row = this.db.prepare('SELECT * FROM photos WHERE path = ?').get(path);
    return row ? Photo.fromRow(row) : null;
  }

  findAll(query: PhotoQuery = {}): { photos: Photo[]; total: number } {
    const { page = 1, limit = 50, status, favorite, tags, q, dateFrom, dateTo } = query;
    const conditions: string[] = [];
    const params:     any[]    = [];

    if (status)   { conditions.push('status = ?');   params.push(status); }
    if (favorite) { conditions.push('favorite = 1'); }
    if (q)        { conditions.push('(path LIKE ? OR ai_desc LIKE ? OR ai_tags LIKE ? OR user_tags LIKE ?)');
                    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    if (dateFrom) { conditions.push('exif_time >= ?'); params.push(dateFrom); }
    if (dateTo)   { conditions.push('exif_time <= ?'); params.push(dateTo); }
    if (tags && tags.length) {
      tags.forEach(t => { conditions.push('user_tags LIKE ? OR ai_tags LIKE ?');
                          params.push(`%${t}%`, `%${t}%`); });
    }

    const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (page - 1) * limit;

    const total  = (this.db.prepare(`SELECT COUNT(*) as cnt FROM photos ${where}`).get(...params) as any).cnt;
    const rows   = this.db.prepare(`SELECT * FROM photos ${where} ORDER BY exif_time DESC, mtime DESC LIMIT ? OFFSET ?`)
                     .all(...params, limit, offset);

    return { photos: rows.map(Photo.fromRow), total };
  }

  updateResult(path: string, data: Partial<Photo>): void {
    this.db.prepare(`
      UPDATE photos SET
        thumb_path   = COALESCE(@thumb_path,   thumb_path),
        preview_path = COALESCE(@preview_path, preview_path),
        md5          = COALESCE(@md5,          md5),
        width        = COALESCE(@width,        width),
        height       = COALESCE(@height,       height),
        exif_time    = COALESCE(@exif_time,    exif_time),
        exif_camera  = COALESCE(@exif_camera,  exif_camera),
        exif_gps     = COALESCE(@exif_gps,     exif_gps),
        phash        = COALESCE(@phash,        phash),
        ai_desc      = COALESCE(@ai_desc,      ai_desc),
        ai_tags      = COALESCE(@ai_tags,      ai_tags),
        status       = @status,
        updated_at   = strftime('%s','now')
      WHERE path = @path
    `).run({
      path,
      thumb_path:   data.thumbPath   || null,
      preview_path: data.previewPath || null,
      md5:          data.md5         || null,
      width:        data.width       || null,
      height:       data.height      || null,
      exif_time:    data.exifTime    || null,
      exif_camera:  data.exifCamera  || null,
      exif_gps:     data.exifGps     || null,
      phash:        data.phash       || null,
      ai_desc:      data.aiDesc      || null,
      ai_tags:      data.aiTags ? JSON.stringify(data.aiTags) : null,
      status:       data.status || 'done',
    });
  }

  markStatus(path: string, status: PhotoStatus): void {
    this.db.prepare(`UPDATE photos SET status = ?, updated_at = strftime('%s','now') WHERE path = ?`)
      .run(status, path);
  }

  countByStatus(): Record<string, number> {
    const rows = this.db.prepare(`SELECT status, COUNT(*) as cnt FROM photos GROUP BY status`).all() as any[];
    const result: Record<string, number> = { pending: 0, processing: 0, done: 0, error: 0 };
    rows.forEach(r => { result[r.status] = r.cnt; });
    return result;
  }

  findPending(limit = 10): Photo[] {
    return (this.db.prepare(`SELECT * FROM photos WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`)
      .all(limit) as any[]).map(Photo.fromRow);
  }

  delete(path: string): void {
    this.db.prepare('DELETE FROM photos WHERE path = ?').run(path);
  }

  // 标签相关
  updateUserTags(id: number, tags: string[]): void {
    this.db.prepare(`UPDATE photos SET user_tags = ?, updated_at = strftime('%s','now') WHERE id = ?`)
      .run(JSON.stringify(tags), id);
    this.rebuildTagIndex();
  }

  toggleFavorite(id: number): boolean {
    const photo = this.findById(id);
    if (!photo) return false;
    const newVal = photo.favorite ? 0 : 1;
    this.db.prepare(`UPDATE photos SET favorite = ?, updated_at = strftime('%s','now') WHERE id = ?`)
      .run(newVal, id);
    return newVal === 1;
  }

  getAllTags(): { name: string; count: number }[] {
    return this.db.prepare('SELECT name, count FROM tags ORDER BY count DESC').all() as any[];
  }

  private rebuildTagIndex(): void {
    this.db.prepare('DELETE FROM tags').run();
    const rows = this.db.prepare(`SELECT user_tags, ai_tags FROM photos`).all() as any[];
    const tagCount = new Map<string, number>();
    rows.forEach(r => {
      const tags = [...JSON.parse(r.user_tags || '[]'), ...JSON.parse(r.ai_tags || '[]')];
      tags.forEach((t: string) => tagCount.set(t, (tagCount.get(t) || 0) + 1));
    });
    const insert = this.db.prepare('INSERT OR REPLACE INTO tags (name, count) VALUES (?, ?)');
    tagCount.forEach((count, name) => insert.run(name, count));
  }
}
