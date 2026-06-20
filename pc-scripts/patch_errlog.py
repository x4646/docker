# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

old = '            if not res or res.get("status") != "done":\n                try: requests.post(f"{PHOTO_URL}/api/photos/fail", json={"path": t["path"]}, timeout=10)\n                except Exception: pass'

new = '''            if not res or res.get("status") != "done":
                err_msg = res.get("error", "unknown") if res else "handle返回None"
                print(f"[FAIL] {t['path']} - {err_msg}")
                try:
                    requests.post(f"{PHOTO_URL}/api/photos/fail", json={"path": t["path"], "error": err_msg}, timeout=10)
                except Exception: pass
                # 写本地日志
                try:
                    with open("process_errors.log", "a", encoding="utf-8") as lf:
                        import datetime
                        lf.write(f"{datetime.datetime.now()} | {t['path']} | {err_msg}\\n")
                except Exception: pass'''

if old not in content:
    print("NOT FOUND")
else:
    content = content.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK")
