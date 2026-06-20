# -*- coding: utf-8 -*-
import io
FN = "sync_by_exif.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()
old = "batch_insert = []\nbatch_update = []\nBATCH_SIZE = 200"
new = "batch_insert = []\nbatch_update = []\nbatch_md5update = []  # path已存在，补md5\npath_map = {}\nBATCH_SIZE = 200"
if old not in c:
    print("NOT FOUND 3a")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK 3a")
