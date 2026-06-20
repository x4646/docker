# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()
old = "        elif path == '/write-md5':\n            import subprocess\n            pc_path = body.get('pcPath', '').replace('/', '\\\\')"
new = "        elif path == '/write-md5':\n            import subprocess\n            pc_path = body.get('pcPath', '').replace('/', '\\\\')\n            print(f'[write-md5] pcPath={repr(pc_path)}')"
if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
