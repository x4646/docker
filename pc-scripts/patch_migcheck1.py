# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = """        elif path == '/migrate':
            r = start_migrate(body.get('srcPath',''), body.get('dstRoot',''))
            self._json(r)"""

new = """        elif path == '/migrate-check':
            r = migrate_check(body.get('srcPath',''), body.get('dstRoot',''))
            self._json(r)
        elif path == '/migrate':
            r = start_migrate(body.get('srcPath',''), body.get('dstRoot',''))
            self._json(r)"""

if old not in c:
    print("NOT FOUND route")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK route")
