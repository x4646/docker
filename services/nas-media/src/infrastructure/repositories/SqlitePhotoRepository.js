const { PhotoDb } = require('../db/Database');
const { Photo } = require('../../domain/entities/Photo');

class SqlitePhotoRepository {
  constructor(dbPath) {
    this.db = PhotoDb.getInstance(dbPath);
  }

  // 便宜的"版本号": 用MAX(id)当变化信号, 表里一有新照片入库这个值就会变。
  // 只要没变, 目录列表结果就可以直接回放缓存, 不用重新跑那条几百毫秒的 path LIKE 扫描。
  getVersion() {
    // 2026-09-30: 版本号 = MAX(id) + 本连接写入次数 + 其它连接的写入计数(data_version)。
    // 只看 MAX(id) 时, 照片处理完成(status/thumb_path变了)、改名(path变了)这类更新不改 MAX(id),
    // 列表缓存会一直回放旧数据(实测: 库里已 done 有缩略图, 接口还返回 pending/无缩略图)。任何写入都让缓存失效。
    const mx = this.db.prepare('SELECT MAX(id) v FROM photos').get().v || 0;
    const tc = this.db.prepare('SELECT total_changes() c').get().c;
    let dv = 0; try { dv = this.db.pragma('data_version', { simple: true }); } catch (e) {}
    return mx + ':' + tc + ':' + dv;
  }

  upsert(data) {
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

  findById(id) {
    const row = this.db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
    return row ? Photo.fromRow(row) : null;
  }

  findByPath(p) {
    const row = this.db.prepare('SELECT * FROM photos WHERE path = ?').get(p);
    return row ? Photo.fromRow(row) : null;
  }

  findAll(query = {}) {
    const { page = 1, limit = 50, status, favorite, tags, q, dateFrom, dateTo } = query;
    const conditions = [];
    const params = [];

    // 标记过待删的一律排除, 跟photo-tags.js的/api/photo-tags/photos保持一致行为
    conditions.push('(pending_delete IS NULL OR pending_delete = 0)');
    if (status)   { conditions.push('status = ?');   params.push(status); }
    if (favorite) { conditions.push('favorite = 1'); }
    if (query.mediaType) { conditions.push('media_type = ?'); params.push(query.mediaType); }
    if (q)        { conditions.push('(path LIKE ? OR ai_desc LIKE ? OR ai_tags LIKE ? OR user_tags LIKE ?)');
                    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    if (dateFrom) { conditions.push('exif_time >= ?'); params.push(dateFrom); }
    if (dateTo)   { conditions.push('exif_time <= ?'); params.push(dateTo); }
    // 2026-08-23修复: 原来是 dirPath+'%'(不带斜杠), 会把 /share/BAK 和 /share/BAKUP 这种
    // 同前缀但不相关的兄弟目录一起误匹配进来; 加上'/'限定必须是这个目录的下一级才算命中。
    // 2026-09-30: 目录筛选改成路径范围 + 强制走 idx_photos_path(优化器原来选了 media_type 索引扫全部23万行, 实测 COUNT 从~180ms降到2~10ms)。
    // 范围写法区分大小写, 所以范围查不到时自动退回原来的 LIKE(不区分大小写)再查一次。
    let useDirIdx = false;
    if (query.dirPath) {
      if (query._noRange) { conditions.push('path LIKE ?'); params.push(query.dirPath + '/%'); }
      else { conditions.push('path >= ? AND path < ?'); params.push(query.dirPath + '/', query.dirPath + '0'); useDirIdx = true; }
    }
    const _from = useDirIdx ? 'photos INDEXED BY idx_photos_path' : 'photos';
    if (query.year) {
      const from = new Date(query.year, 0, 1).getTime() / 1000;
      const to   = new Date(query.year + 1, 0, 1).getTime() / 1000;
      conditions.push('exif_time >= ? AND exif_time < ?'); params.push(from, to);
    }
    if (query.month && query.year) {
      const from = new Date(query.year, query.month - 1, 1).getTime() / 1000;
      const to   = new Date(query.year, query.month, 1).getTime() / 1000;
      conditions.push('exif_time >= ? AND exif_time < ?'); params.push(from, to);
    }
    if (tags && tags.length) {
      tags.forEach(t => { conditions.push('user_tags LIKE ? OR ai_tags LIKE ?');
                          params.push(`%${t}%`, `%${t}%`); });
    }

    const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const offset = (page - 1) * limit;

    // 2026-09-30: 总数缓存5分钟(启动时由 routes.js 预热默认视图)(同一筛选条件翻页时不再每页重数23万行, 实测COUNT要250~400ms)
    const _ck = where + '|' + JSON.stringify(params);
    const _now = Date.now();
    this._cntCache = this._cntCache || new Map();
    let _hit = this._cntCache.get(_ck);
    if (!_hit || _now - _hit.t > 300000) {
      _hit = { t: _now, v: this.db.prepare(`SELECT COUNT(*) as cnt FROM ${_from} ${where}`).get(...params).cnt };
      if (this._cntCache.size > 200) this._cntCache.clear();
      this._cntCache.set(_ck, _hit);
    }
    const total = _hit.v;
    if (total === 0 && useDirIdx) return this.findAll(Object.assign({}, query, { _noRange: true }));
    const rows  = this.db.prepare(`SELECT * FROM ${_from} ${where} ORDER BY exif_time DESC, mtime DESC LIMIT ? OFFSET ?`)
                    .all(...params, limit, offset);

    return { photos: rows.map(Photo.fromRow), total };
  }

  updateResult(p, data) {
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
      path: p,
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

  markStatus(p, status) {
    this.db.prepare(`UPDATE photos SET status = ?, updated_at = strftime('%s','now') WHERE path = ?`)
      .run(status, p);
  }

  countByStatus() {
    const rows = this.db.prepare(`SELECT status, COUNT(*) as cnt FROM photos GROUP BY status`).all();
    const result = { pending: 0, processing: 0, done: 0, error: 0 };
    rows.forEach(r => { result[r.status] = r.cnt; });
    return result;
  }

  findPending(limit = 10) {
    return this.db.prepare(`SELECT * FROM photos WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`)
      .all(limit).map(Photo.fromRow);
  }

  delete(p) {
    this.db.prepare('DELETE FROM photos WHERE path = ?').run(p);
  }

  // 标签相关
  updateUserTags(id, tags) {
    this.db.prepare(`UPDATE photos SET user_tags = ?, updated_at = strftime('%s','now') WHERE id = ?`)
      .run(JSON.stringify(tags), id);
    this.rebuildTagIndex();
  }

  toggleFavorite(id) {
    const photo = this.findById(id);
    if (!photo) return false;
    const newVal = photo.favorite ? 0 : 1;
    this.db.prepare(`UPDATE photos SET favorite = ?, updated_at = strftime('%s','now') WHERE id = ?`)
      .run(newVal, id);
    return newVal === 1;
  }

  getAllTags() {
    return this.db.prepare('SELECT name, count FROM tags ORDER BY count DESC').all();
  }

  rebuildTagIndex() {
    this.db.prepare('DELETE FROM tags').run();
    const rows = this.db.prepare(`SELECT user_tags, ai_tags FROM photos`).all();
    const tagCount = new Map();
    rows.forEach(r => {
      const tags = [...JSON.parse(r.user_tags || '[]'), ...JSON.parse(r.ai_tags || '[]')];
      tags.forEach(t => tagCount.set(t, (tagCount.get(t) || 0) + 1));
    });
    const insert = this.db.prepare('INSERT OR REPLACE INTO tags (name, count) VALUES (?, ?)');
    tagCount.forEach((count, name) => insert.run(name, count));
  }

  findByMd5(md5) {
    const row = this.db.prepare('SELECT * FROM photos WHERE md5 = ? LIMIT 1').get(md5);
    return row ? Photo.fromRow(row) : null;
  }

  findBySizeCtime(size, ctime) {
    const rows = this.db.prepare('SELECT * FROM photos WHERE size = ? AND ctime = ?').all(size, ctime);
    return rows.map(Photo.fromRow);
  }

  updatePath(oldPath, newPath) {
    this.db.prepare('UPDATE photos SET path = ?, updated_at = strftime(\'%s\',\'now\') WHERE path = ?')
      .run(newPath, oldPath);
  }

  findByFileKey(fileKey) {
    const row = this.db.prepare('SELECT * FROM photos WHERE file_key = ? LIMIT 1').get(fileKey);
    return row ? Photo.fromRow(row) : null;
  }
}

module.exports = { SqlitePhotoRepository };
