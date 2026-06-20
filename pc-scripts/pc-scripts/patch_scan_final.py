# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

start = content.find('def handle_scan_and_process(msg):')
end   = content.find('\ndef ', start + 10)
if start == -1 or end == -1:
    print(f"NOT FOUND start={start} end={end}")
else:
    new = '''def handle_scan_and_process(msg):
    """扫描PC目录：按文件夹单位上报进度+写路径到DB"""
    import hashlib, os

    pc_path  = msg.get("pcPath", "")
    task_id  = msg.get("task_id", "")
    if not pc_path or not os.path.exists(pc_path):
        print(f"目录不存在: {pc_path}")
        return {"status": "failed", "error": "目录不存在"}

    IMG_EXTS = {".jpg",".jpeg",".png",".gif",".bmp",".tiff",".webp",".heic",".raw"}

    # 从NAS DB拿已done的file_key集合
    done_keys = set()
    try:
        r = requests.get(f"{PHOTO_URL}/api/photos/done-keys", timeout=30)
        done_keys = set(r.json().get("keys", []))
    except Exception as e:
        print(f"获取done-keys失败: {e}")

    total_actual = 0
    dir_stats    = {}

    # 按文件夹遍历，每扫完一个文件夹上报一次
    for dirpath, dirnames, filenames in os.walk(pc_path):
        dirnames[:] = sorted([d for d in dirnames if not d.startswith(".") and not d.startswith("@")])
        files = []
        for filename in filenames:
            if os.path.splitext(filename)[1].lower() not in IMG_EXTS:
                continue
            filepath = os.path.join(dirpath, filename)
            try:
                stat = os.stat(filepath)
                key  = hashlib.md5(f"{filename}_{stat.st_size}_{int(stat.st_mtime)}".encode()).hexdigest()
                files.append({
                    "path":  filepath.replace(chr(92), "/"),
                    "name":  filename,
                    "size":  stat.st_size,
                    "mtime": int(stat.st_mtime),
                    "key":   key,
                })
            except Exception:
                pass

        if not files:
            continue

        total_actual += len(files)
        done_cnt = sum(1 for f in files if f["key"] in done_keys)
        dir_stats[dirpath] = {"total": len(files), "done": done_cnt}

        # 上报进度到NAS
        if task_id:
            try:
                requests.post(f"{PHOTO_URL}/api/pc/scan-progress", json={
                    "taskId":  task_id,
                    "dirPath": dirpath,
                    "files":   files,
                    "stats":   {dirpath: {"total": len(files), "done": done_cnt}},
                }, timeout=30)
            except Exception as e:
                print(f"上报失败: {dirpath} - {e}")

    # 冒泡汇总父目录
    all_needed = set(dir_stats.keys())
    for d in list(dir_stats.keys()):
        parent = os.path.dirname(d)
        while parent and len(parent) >= len(pc_path) and parent not in all_needed:
            all_needed.add(parent)
            parent = os.path.dirname(parent)
    for d in all_needed:
        if d not in dir_stats:
            dir_stats[d] = {"total": 0, "done": 0}
    for d in sorted(all_needed, key=lambda x: x.count(chr(92)), reverse=True):
        parent = os.path.dirname(d)
        if parent and parent != d and len(parent) >= len(pc_path):
            dir_stats[parent]["total"] += dir_stats[d]["total"]
            dir_stats[parent]["done"]  += dir_stats[d]["done"]
    dir_stats[pc_path] = {"total": total_actual, "done": dir_stats.get(pc_path, {}).get("done", 0)}

    # 发完成信号+汇总stats
    if task_id:
        try:
            requests.post(f"{PHOTO_URL}/api/pc/scan-progress", json={
                "taskId": task_id,
                "stats":  dir_stats,
                "done":   True,
            }, timeout=30)
        except Exception as e:
            print(f"发完成信号失败: {e}")

    print(f"扫描完成: {total_actual} 张，{len(dir_stats)} 个目录")
    return {"status": "done", "actual": total_actual, "dirStats": dir_stats}

'''
    content = content[:start] + new + content[end+1:]
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK")
