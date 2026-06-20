# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''                files.append({
                    "path":  filepath.replace(chr(92), "/"),
                    "name":  filename,
                    "size":  stat.st_size,
                    "mtime": int(stat.st_mtime),
                    "key":   key,
                })'''

new = '''                fwd = filepath.replace(chr(92), "/")
                files.append({
                    "path":  fwd,
                    "name":  filename,
                    "size":  stat.st_size,
                    "mtime": int(stat.st_mtime),
                    "key":   key,
                })
                all_file_paths.add(fwd)'''

if old not in c:
    print("NOT FOUND")
else:
    # 同时删掉重复的all_file_paths定义
    c = c.replace("    all_file_paths = set()\n    all_file_paths = set()", "    all_file_paths = set()", 1)
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
