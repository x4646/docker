# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()
old = '''if __name__ == "__main__":
    threading.Thread(target=start_http_server, daemon=True).start()
    print("NAS Client 启动")'''
new = '''if __name__ == "__main__":
    threading.Thread(target=start_http_server, daemon=True).start()
    threading.Thread(target=_worker_pool_monitor, daemon=True).start()
    print("NAS Client 启动")'''
if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
