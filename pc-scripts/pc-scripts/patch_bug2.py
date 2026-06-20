# -*- coding: utf-8 -*-
import io
FN = "sync_by_exif.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''    root = sys.argv[1]
    print(f"扫描目录: {root}")
    md5_index = load_md5_index()'''

new = '''    root = sys.argv[1]
    print(f"扫描目录: {root}")
    global path_map
    md5_index, path_map = load_md5_index()'''

if old not in c:
    print("NOT FOUND main")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK 2")
