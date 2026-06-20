# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

# 找到函数开头到结尾整个替换
OLD_START = 'def handle_scan_and_process(msg):\n    """扫描PC目录，写pending到NAS DB，由worker处理"""\n    import hashlib'
OLD_END = '    return {"status": "done", "actual": len(all_files), "dirStats": dir_stats}'

start = content.find(OLD_START)
end   = content.find(OLD_END)
if start == -1 or end == -1:
    print("NOT FOUND start=%d end=%d" % (start, end))
else:
    old = content[start:end+len(OLD_END)]
    new = '''def handle_scan_and_process(msg):
    """扫描PC目录：统计done/total，写pc_dir_stats，不写pending"""
    import hashlib

    pc_path = msg.get("pcPath", "")
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

    # 遍历目录，按子目录统计total/done
    dir_stats = {}
    actual = 0
    for dirpath, dirnames, filenames in os.walk(pc_path):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and not d.startswith("@")]
        for filename in filenames:
            if os.path.splitext(filename)[1].lower() not in IMG_EXTS:
                continue
            filepath = os.path.join(dirpath, filename)
            try:
                stat = os.stat(filepath)
                key  = hashlib.md5(f"{filename}_{stat.st_size}_{int(stat.st_mtime)}".encode()).hexdigest()
                d    = dirpath
                if d not in dir_stats:
                    dir_stats[d] = {"total": 0, "done": 0}
                dir_stats[d]["total"] += 1
                actual += 1
                if key in done_keys:
                    dir_stats[d]["done"] += 1
            except Exception:
                pass

    print(f"扫描完成: {actual} 张，{len(dir_stats)} 个目录")

    # 写pc_dir_stats到NAS
    try:
        requests.post(f"{PHOTO_URL}/api/pc/update-dir-stats",
            json={"dirStats": dir_stats}, timeout=30)
    except Exception as e:
        print(f"写dir_stats失败: {e}")

    return {"status": "done", "actual": actual, "dirStats": dir_stats}'''
    content = content.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK")
