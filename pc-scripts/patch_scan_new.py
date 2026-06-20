# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

# 找到函数开头
OLD_START = 'def handle_scan_and_process(msg):\n    """扫描PC目录，写pending到NAS DB，由worker处理"""\n    import hashlib'
if OLD_START not in content:
    print("NOT FOUND")
else:
    # 找函数结束
    start = content.find(OLD_START)
    end   = content.find('\ndef ', start + 10)
    old   = content[start:end]
    new = '''def handle_scan_and_process(msg):
    """扫描PC目录：写路径到DB，统计dir_stats，清脏数据"""
    import hashlib, os

    pc_path = msg.get("pcPath", "")
    if not pc_path or not os.path.exists(pc_path):
        print(f"目录不存在: {pc_path}")
        return {"status": "failed", "error": "目录不存在"}

    IMG_EXTS = {".jpg",".jpeg",".png",".gif",".bmp",".tiff",".webp",".heic",".raw"}

    # 1. 遍历目录收集所有图片
    all_files = []
    for dirpath, dirnames, filenames in os.walk(pc_path):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and not d.startswith("@")]
        for filename in filenames:
            if os.path.splitext(filename)[1].lower() not in IMG_EXTS:
                continue
            filepath = os.path.join(dirpath, filename)
            try:
                stat = os.stat(filepath)
                all_files.append({
                    "path":  filepath.replace(chr(92), "/"),
                    "name":  filename,
                    "size":  stat.st_size,
                    "mtime": int(stat.st_mtime),
                })
            except Exception:
                pass

    actual = len(all_files)
    print(f"扫描完成: {actual} 张图片 in {pc_path}")

    # 2. 写路径到NAS DB（分批）
    try:
        batch_size = 500
        total_sent = 0
        for i in range(0, len(all_files), batch_size):
            batch = all_files[i:i+batch_size]
            r = requests.post(f"{PHOTO_URL}/api/pc/submit-scan",
                json={"pcPath": pc_path, "files": batch}, timeout=60)
            total_sent += r.json().get("sent", 0)
        print(f"写入DB: {total_sent} 条")
    except Exception as e:
        print(f"写DB失败: {e}")

    # 3. 从NAS DB查已done的key，统计dir_stats
    done_keys = set()
    try:
        r = requests.get(f"{PHOTO_URL}/api/photos/done-keys", timeout=30)
        done_keys = set(r.json().get("keys", []))
    except Exception as e:
        print(f"获取done-keys失败: {e}")

    dir_stats = {}
    for f in all_files:
        key  = hashlib.md5(f"{f['name']}_{f['size']}_{f['mtime']}".encode()).hexdigest()
        d    = os.path.dirname(f["path"].replace("/", chr(92)))
        if d not in dir_stats:
            dir_stats[d] = {"total": 0, "done": 0}
        dir_stats[d]["total"] += 1
        if key in done_keys:
            dir_stats[d]["done"] += 1

    # 4. 冒泡汇总父目录
    all_needed = set(dir_stats.keys())
    for d in list(dir_stats.keys()):
        parent = os.path.dirname(d)
        while parent and parent.startswith(pc_path.split(chr(92))[0]) and parent not in all_needed:
            all_needed.add(parent)
            parent = os.path.dirname(parent)
    for d in all_needed:
        if d not in dir_stats:
            dir_stats[d] = {"total": 0, "done": 0}
    sorted_dirs = sorted(all_needed, key=lambda x: x.count(chr(92)), reverse=True)
    for d in sorted_dirs:
        parent = os.path.dirname(d)
        if parent and parent != d and parent.startswith(pc_path.split(chr(92))[0]):
            dir_stats[parent]["total"] += dir_stats[d]["total"]
            dir_stats[parent]["done"]  += dir_stats[d]["done"]
    dir_stats[pc_path] = {"total": actual, "done": dir_stats.get(pc_path, {}).get("done", 0)}

    # 5. 写dir_stats到NAS
    try:
        requests.post(f"{PHOTO_URL}/api/pc/update-dir-stats",
            json={"dirStats": dir_stats}, timeout=30)
        print(f"更新dir_stats: {len(dir_stats)} 个目录")
    except Exception as e:
        print(f"写dir_stats失败: {e}")

    return {"status": "done", "actual": actual, "dirStats": dir_stats}

'''
    content = content[:start] + new + content[end+1:]
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK")
