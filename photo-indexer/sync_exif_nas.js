const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('/app/node_modules/better-sqlite3');

const DB_PATH = '/data/nas.db';
const IMG_EXTS = new Set(['.jpg', '.jpeg']);
const root = process.argv[2] || '/share/photo';

const db = new Database(DB_PATH);
db.pragma('journal_mode=WAL');
db.pragma('busy_timeout=5000');

// 加载md5索引
console.log('加载DB md5索引...');
const rows = db.prepare('SELECT id,path,md5 FROM photos WHERE md5 IS NOT NULL AND status='done'').all();
const md5Index = new Map();
rows.forEach(r => md5Index.set(r.md5, { id: r.id, path: r.path }));
console.log(`已加载${md5Index.size}条md5记录`);

// 遍历文件
function walk(dir, files = []) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch(e) { return files; }
  for (const name of entries) {
    if (name.startsWith('.') || name.startsWith('@')) continue;
    const full = path.join(dir, name);
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full, files);
      else if (IMG_EXTS.has(path.extname(name).toLowerCase())) files.push(full);
    } catch(e) {}
  }
  return files;
}

console.log(`扫描目录: ${root}`);
const files = walk(root);
console.log(`找到${files.length}张JPEG`);

const updPath = db.prepare('UPDATE photos SET path=?,dir=?,exif_written=1 WHERE id=?');
const ins = db.prepare('INSERT OR IGNORE INTO photos (path,dir,size,mtime,file_key,md5,status,exif_written) VALUES (?,?,?,?,?,?,\'pending\',1)');

let skip=0, updatePath=0, newFile=0, fail=0, total=0;

for (const filepath of files) {
  total++;
  const nasPath = filepath.replace(/\\/g, '/');

  // 读EXIF md5（简单查找NAS_MD5=字符串）
  let exifMd5 = null;
  try {
    const buf = fs.readFileSync(filepath);
    const str = buf.toString('latin1');
    const idx = str.indexOf('NAS_MD5=');
    if (idx >= 0) exifMd5 = str.slice(idx + 8, idx + 40);
  } catch(e) {}

  if (!exifMd5) {
    // 没有EXIF md5，算md5
    try {
      const data = fs.readFileSync(filepath);
      exifMd5 = crypto.createHash('md5').update(data).digest('hex');
      // 写进EXIF（追加到文件末尾的注释段，简单方式）
      // 这里暂时只更新DB，不写EXIF（需要piexif）
    } catch(e) { fail++; continue; }
  }

  const rec = md5Index.get(exifMd5);
  if (rec) {
    if (rec.path === nasPath) {
      skip++;
    } else {
      const dir = nasPath.split('/').slice(0,-1).join('/');
      updPath.run(nasPath, dir, rec.id);
      updatePath++;
    }
  } else {
    try {
      const stat = fs.statSync(filepath);
      const key = crypto.createHash('md5').update(`${path.basename(filepath)}_${stat.size}_${Math.floor(stat.mtimeMs/1000)}`).digest('hex');
      const dir = nasPath.split('/').slice(0,-1).join('/');
      ins.run(nasPath, dir, stat.size, Math.floor(stat.mtimeMs/1000), key, exifMd5);
      newFile++;
    } catch(e) { fail++; }
  }

  if (total % 500 === 0) {
    console.log(`进度: 跳过${skip} 更新路径${updatePath} 新增${newFile} 失败${fail} 共${total}`);
  }
}

db.close();
console.log(`\n完成！`);
console.log(`  跳过(已同步): ${skip}`);
console.log(`  更新路径:     ${updatePath}`);
console.log(`  新增pending:  ${newFile}`);
console.log(`  失败:         ${fail}`);
console.log(`  总计:         ${total}`);
