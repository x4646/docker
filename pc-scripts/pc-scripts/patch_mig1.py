# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = """        elif path == '/process-dir':
            st = add_process_dir(body.get('pcPath',''))
            self._json({'ok': True, 'status': st})"""

new = """        elif path == '/process-dir':
            st = add_process_dir(body.get('pcPath',''))
            self._json({'ok': True, 'status': st})
        elif path == '/migrate':
            r = start_migrate(body.get('srcPath',''), body.get('dstRoot',''))
            self._json(r)
        elif path == '/migrate-status':
            self._json(get_migrate_status())"""

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
