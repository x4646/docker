# -*- coding: utf-8 -*-
import io
FN = "worker.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''def run():
    log(f"启动 filter={DIR_FILTER}")
    while True:
        try:
            body = {"n": 1}
            if DIR_FILTER:
                body["dirFilter"] = DIR_FILTER
            r = requests.post(f"{PHOTO_URL}/api/photos/claim", json=body, timeout=10)
            tasks = r.json().get("tasks", [])
        except Exception as e:
            log(f"claim失败: {e}")
            time.sleep(15)
            continue
        if not tasks:
            time.sleep(5)
            continue'''

new = '''def run():
    log(f"启动 filter={DIR_FILTER}")
    empty_count = 0
    while True:
        try:
            body = {"n": 1}
            if DIR_FILTER:
                body["dirFilter"] = DIR_FILTER
            r = requests.post(f"{PHOTO_URL}/api/photos/claim", json=body, timeout=10)
            tasks = r.json().get("tasks", [])
        except Exception as e:
            log(f"claim失败: {e}")
            time.sleep(15)
            continue
        if not tasks:
            empty_count += 1
            if empty_count >= 3:
                log("无更多任务，退出")
                break
            time.sleep(3)
            continue
        empty_count = 0'''

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
