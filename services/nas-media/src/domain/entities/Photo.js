// 2026-09-20: 从Photo.ts原样转换, 只去掉类型标注和构造函数参数属性简写
// (TS的`public readonly id: ...`会自动挂到this上, JS没有这个语法糖, 手动展开赋值)。
class Photo {
  constructor(
    id, path, thumbPath, previewPath, size, mtime, md5, width, height,
    exifTime, exifCamera, exifGps, ctime, phash, aiDesc, aiTags, userTags,
    favorite, status,
  ) {
    this.id          = id;
    this.path        = path;
    this.thumbPath   = thumbPath;
    this.previewPath = previewPath;
    this.size        = size;
    this.mtime       = mtime;
    this.md5         = md5;
    this.width       = width;
    this.height      = height;
    this.exifTime    = exifTime;
    this.exifCamera  = exifCamera;
    this.exifGps     = exifGps;
    this.ctime       = ctime;
    this.phash       = phash;
    this.aiDesc      = aiDesc;
    this.aiTags      = aiTags;
    this.userTags    = userTags;
    this.favorite    = favorite;
    this.status      = status;
  }

  toJSON() {
    return {
      id:           this.id,
      path:         this.path,
      thumb_path:   this.thumbPath,
      preview_path: this.previewPath,
      size:         this.size,
      mtime:        this.mtime,
      md5:          this.md5,
      width:        this.width,
      height:       this.height,
      exif_time:    this.exifTime,
      exif_camera:  this.exifCamera,
      exif_gps:     this.exifGps,
      ctime:        this.ctime,
      phash:        this.phash,
      ai_desc:      this.aiDesc,
      ai_tags:      this.aiTags,
      user_tags:    this.userTags,
      favorite:     this.favorite,
      status:       this.status,
    };
  }

  static fromRow(row) {
    return new Photo(
      row.id,
      row.path,
      row.thumb_path   || null,
      row.preview_path || null,
      row.size         || 0,
      row.mtime        || 0,
      row.md5          || null,
      row.width        || null,
      row.height       || null,
      row.exif_time    || null,
      row.exif_camera  || null,
      row.exif_gps     || null,
      row.ctime        || null,
      row.phash        || null,
      row.ai_desc      || null,
      JSON.parse(row.ai_tags   || '[]'),
      JSON.parse(row.user_tags || '[]'),
      row.favorite === 1,
      row.status   || 'pending',
    );
  }
}

module.exports = { Photo };
