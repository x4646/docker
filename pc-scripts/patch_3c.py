# -*- coding: utf-8 -*-
import io
FN = "sync_by_exif.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''        else:
            try:
                stat = os.stat(filepath)
                key = hashlib.md5(f"{os.path.basename(filepath)}_{stat.st_size}_{int(stat.st_mtime)}".encode()).hexdigest()
                dir_path = nas_path.rsplit("/", 1)[0]
                batch_insert.append((nas_path, dir_path, stat.st_size, int(stat.st_mtime), key, exif_md5))
                counters["new"] += 1
                if len(batch_insert) >= BATCH_SIZE:
                    flush_batch()
            except:
                counters["fail"] += 1'''

new = '''        else:
            # md5不在库。先看path是否已存在(md5=NULL的情况)
            existing = path_map.get(nas_path)
            if existing:
                # path已存在但md5为空，补md5
                batch_md5update.append((existing["id"], exif_md5))
                counters["update_path"] += 1
                if len(batch_md5update) >= BATCH_SIZE:
                    flush_batch()
            else:
                try:
                    stat = os.stat(filepath)
                    key = hashlib.md5(f"{os.path.basename(filepath)}_{stat.st_size}_{int(stat.st_mtime)}".encode()).hexdigest()
                    dir_path = nas_path.rsplit("/", 1)[0]
                    batch_insert.append((nas_path, dir_path, stat.st_size, int(stat.st_mtime), key, exif_md5))
                    counters["new"] += 1
                    if len(batch_insert) >= BATCH_SIZE:
                        flush_batch()
                except:
                    counters["fail"] += 1'''

if old not in c:
    print("NOT FOUND 3c")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK 3c")
