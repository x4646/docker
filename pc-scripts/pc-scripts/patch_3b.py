# -*- coding: utf-8 -*-
import io
FN = "sync_by_exif.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''def flush_batch():
    global batch_insert, batch_update
    if batch_insert:'''
new = '''def flush_batch():
    global batch_insert, batch_update, batch_md5update
    if batch_md5update:
        for pid, md5 in batch_md5update:
            try:
                requests.post(f"{PHOTO_URL}/api/db/query",
                    json={"sql": f"UPDATE photos SET md5='{md5}',exif_written=1 WHERE id={pid}"},
                    timeout=10)
            except: pass
        batch_md5update = []
    if batch_insert:'''

if old not in c:
    print("NOT FOUND 3b")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK 3b")
