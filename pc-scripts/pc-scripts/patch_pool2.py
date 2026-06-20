# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = """        elif path == '/clean-orphan':
            result = handle_clean_orphan(body.get('pcPath',''))
            self._json(result)"""

new = """        elif path == '/clean-orphan':
            result = handle_clean_orphan(body.get('pcPath',''))
            self._json(result)
        elif path == '/process-dir':
            st = add_process_dir(body.get('pcPath',''))
            self._json({'ok': True, 'status': st})
        elif path == '/worker-status':
            self._json(get_worker_status())"""

if old not in c:
    print("NOT FOUND route")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK route")
