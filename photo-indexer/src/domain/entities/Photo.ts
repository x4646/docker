export type PhotoStatus = 'pending' | 'processing' | 'done' | 'error';

export class Photo {
  constructor(
    public readonly id:          number | null,
    public readonly path:        string,
    public thumbPath:            string | null,
    public previewPath:          string | null,
    public readonly size:        number,
    public readonly mtime:       number,
    public md5:                  string | null,
    public width:                number | null,
    public height:               number | null,
    public exifTime:             number | null,
    public exifCamera:           string | null,
    public exifGps:              string | null,
    public phash:                string | null,
    public aiDesc:               string | null,
    public aiTags:               string[],
    public userTags:             string[],
    public favorite:             boolean,
    public status:               PhotoStatus,
  ) {}

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
      phash:        this.phash,
      ai_desc:      this.aiDesc,
      ai_tags:      this.aiTags,
      user_tags:    this.userTags,
      favorite:     this.favorite,
      status:       this.status,
    };
  }

  static fromRow(row: any): Photo {
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
      row.phash        || null,
      row.ai_desc      || null,
      JSON.parse(row.ai_tags   || '[]'),
      JSON.parse(row.user_tags || '[]'),
      row.favorite === 1,
      row.status   || 'pending',
    );
  }
}
