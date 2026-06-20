# -*- coding: utf-8 -*-
import sys, time, requests
from nas_client import PHOTO_URL, handle_photo_process

WORKER_ID  = sys.argv[1] if len(sys.argv) > 1 else "1"
DIR_FILTER = sys.argv[2].replace("\\", "/") if len(sys.argv) > 2 else None

def log(msg):
    print(f"[W{WORKER_ID}] {msg}", flush=True)

def run():
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
        empty_count = 0
        for t in tasks:
            log(f"处理: {t['path']}")
            res = handle_photo_process({
                "path":      t["path"],
                "data_path": "/data/photos",
                "task_id":   t.get("id"),
            })
            if res and res.get("status") == "done":
                try:
                    requests.post(f"{PHOTO_URL}/api/process-logs/add",
                        json={"path": t["path"], "status": "done"}, timeout=10)
                except: pass
            else:
                err = res.get("error", "unknown") if res else "返回None"
                log(f"失败: {t['path']} - {err}")
                try:
                    requests.post(f"{PHOTO_URL}/api/photos/fail",
                        json={"path": t["path"]}, timeout=10)
                    requests.post(f"{PHOTO_URL}/api/process-logs/add",
                        json={"path": t["path"], "status": "error", "error": err}, timeout=10)
                except: pass

if __name__ == "__main__":
    run()
