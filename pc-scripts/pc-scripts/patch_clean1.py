# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = """            self._json({'ok': True})
        elif path == '/delete-dir':"""

new = """            self._json({'ok': True})
        elif path == '/clean-orphan':
            import threading
            threading.Thread(target=handle_clean_orphan, args=(body.get('pcPath',''),), daemon=True).start()
            self._json({'ok': True})
        elif path == '/delete-dir':"""

if old not in c:
    print("NOT FOUND route")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK route")
