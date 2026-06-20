# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = "        if path == '/scan':\n            result = handle_scan_and_process(body)\n            self._json(result)"

new = """        if path == '/scan':
            result = handle_scan_and_process(body)
            self._json(result)
        elif path == '/write-md5':
            import threading
            threading.Thread(target=handle_write_md5, args=(body,), daemon=True).start()
            self._json({'ok': True})"""

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
