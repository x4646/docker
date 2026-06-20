# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()
old = "    threading.Thread(target=start_http_server, daemon=True).start()\n    threading.Thread(target=process_worker,    daemon=True).start()"
new = "    threading.Thread(target=start_http_server, daemon=True).start()"
if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
