# -*- coding: utf-8 -*-
import io
FN = "sync_by_exif.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''def process(filepath, md5_index):
    global batch_insert, batch_update
    counters["total"] += 1
    nas_path = filepath.replace("\\\\", "/")

    exif_md5 = read_exif_md5(filepath)'''

new = '''def process(filepath, md5_index):
    global batch_insert, batch_update
    counters["total"] += 1
    nas_path = filepath.replace("\\\\", "/")

    ext = os.path.splitext(filepath)[1].lower()
    # 不能写md5的格式(webp/gif/heic等)：走纯file_key分支
    if ext not in MD5_EXTS:
        existing = path_map.get(nas_path)
        if existing:
            counters["skip"] += 1
            return
        try:
            stat = os.stat(filepath)
            key = hashlib.md5(f"{os.path.basename(filepath)}_{stat.st_size}_{int(stat.st_mtime)}".encode()).hexdigest()
            dir_path = nas_path.rsplit("/", 1)[0]
            # md5列留NULL，靠file_key去重
            batch_insert.append((nas_path, dir_path, stat.st_size, int(stat.st_mtime), key, ""))
            counters["new"] += 1
            if len(batch_insert) >= BATCH_SIZE:
                flush_batch()
        except:
            counters["fail"] += 1
        return

    exif_md5 = read_exif_md5(filepath)'''

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK 2")
