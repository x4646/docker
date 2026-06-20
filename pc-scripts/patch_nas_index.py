# -*- coding: utf-8 -*-
import io
FN = "sync_by_exif.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''json={"sql": "SELECT id,path,md5 FROM photos WHERE path LIKE 'D:%' OR path LIKE 'E:%' OR path LIKE 'F:%'"},'''
new = '''json={"sql": "SELECT id,path,md5 FROM photos WHERE path LIKE 'D:%' OR path LIKE 'E:%' OR path LIKE 'F:%' OR path LIKE '/share/%'"},'''

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
