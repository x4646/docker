# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"

with io.open(FN, "r", encoding="utf-8-sig") as f:
    lines = f.read().split("\n")

def has(s):
    return any(s in l for l in lines)

changed = []

# 1) import time
if not any(l.strip() == "import time" for l in lines):
    for i, l in enumerate(lines):
        if l.strip() == "import os":
            lines.insert(i + 1, "import time")
            changed.append("import time")
            break

# 2) file_key 统一 mtime
for i, l in enumerate(lines):
    if "file_key_raw" in l and "st_ctime" in l:
        lines[i] = l.replace("st_ctime", "st_mtime")
        changed.append("file_key->mtime")

# 3) 插入 process_worker（在“消息路由”之前）
if not has("def process_worker"):
    worker = [
        "def process_worker():",
        '    print("图片处理worker启动,轮询NAS队列...")',
        "    while True:",
        "        try:",
        '            r = requests.post(f"{PHOTO_URL}/api/photos/claim", json={"n": 1}, timeout=10)',
        '            tasks = r.json().get("tasks", [])',
        "        except Exception:",
        "            time.sleep(15); continue",
        "        if not tasks:",
        "            time.sleep(15); continue",
        "        for t in tasks:",
        "            res = handle_photo_process({",
        '                "path":      t["path"],',
        '                "data_path": "/data/photos",',
        '                "task_id":   t.get("id"),',
        "            })",
        '            if not res or res.get("status") != "done":',
        '                try: requests.post(f"{PHOTO_URL}/api/photos/fail", json={"path": t["path"]}, timeout=10)',
        "                except Exception: pass",
        "",
    ]
    for i, l in enumerate(lines):
        if "# ── 消息路由" in l:
            lines[i:i] = worker
            changed.append("process_worker")
            break

# 4) 启动 worker 线程
if not has("target=process_worker"):
    for i, l in enumerate(lines):
        if "target=start_http_server" in l:
            lines.insert(i + 1, "    threading.Thread(target=process_worker,    daemon=True).start()")
            changed.append("worker thread")
            break

with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(lines))

print("已应用:", ", ".join(changed) if changed else "无（已是最新）")
