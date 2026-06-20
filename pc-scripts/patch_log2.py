# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

old = '        for t in tasks:\n            res = handle_photo_process({\n                "path":      t["path"],\n                "data_path": "/data/photos",\n                "task_id":   t.get("id"),\n            })\n            if not res or res.get("status") != "done":\n                err_msg = res.get("error", "unknown") if res else "handle返回None"\n                print(f"[FAIL] {t[\'path\']} - {err_msg}")\n                try:\n                    requests.post(f"{PHOTO_URL}/api/photos/fail", json={"path": t["path"], "error": err_msg}, timeout=10)\n                except Exception: pass\n                # 写本地日志\n                try:\n                    with open("process_errors.log", "a", encoding="utf-8") as lf:\n                        import datetime\n                        lf.write(f"{datetime.datetime.now()} | {t[\'path\']} | {err_msg}\\n")\n                except Exception: pass'

new = '''        for t in tasks:
            res = handle_photo_process({
                "path":      t["path"],
                "data_path": "/data/photos",
                "task_id":   t.get("id"),
            })
            if res and res.get("status") == "done":
                try: requests.post(f"{PHOTO_URL}/api/process-logs/add", json={"path": t["path"], "status": "done"}, timeout=10)
                except Exception: pass
            else:
                err_msg = res.get("error", "unknown") if res else "handle返回None"
                print(f"[FAIL] {t['path']} - {err_msg}")
                try: requests.post(f"{PHOTO_URL}/api/photos/fail", json={"path": t["path"]}, timeout=10)
                except Exception: pass
                try: requests.post(f"{PHOTO_URL}/api/process-logs/add", json={"path": t["path"], "status": "error", "error": err_msg}, timeout=10)
                except Exception: pass'''

if old not in content:
    print("NOT FOUND")
else:
    content = content.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK")
