# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

old = '''    # 汇总：把子目录数量冒泡到所有父目录
    all_dirs = sorted(dir_stats.keys(), key=lambda x: x.count(os.sep), reverse=True)
    for d in all_dirs:
        parent = os.path.dirname(d)
        while parent and parent != d:
            if parent not in dir_stats:
                dir_stats[parent] = {"total": 0, "done": 0}
            dir_stats[parent]["total"] += dir_stats[d]["total"]
            dir_stats[parent]["done"]  += dir_stats[d]["done"]
            d      = parent
            parent = os.path.dirname(d)
            # 只冒泡到pc_path为止
            if not d.startswith(pc_path):
                break'''

new = '''    # 汇总：把子目录数量冒泡到所有父目录（只冒泡一层，避免重复累加）
    leaf_dirs = sorted(dir_stats.keys(), key=lambda x: x.count(os.sep), reverse=True)
    for d in leaf_dirs:
        parent = os.path.dirname(d)
        if parent and parent != d and parent.startswith(pc_path) and parent != pc_path.rstrip(os.sep):
            if parent not in dir_stats:
                dir_stats[parent] = {"total": 0, "done": 0}
            dir_stats[parent]["total"] += dir_stats[d]["total"]
            dir_stats[parent]["done"]  += dir_stats[d]["done"]
    # 根目录单独汇总
    dir_stats[pc_path] = {"total": actual, "done": sum(
        v["done"] for k, v in dir_stats.items() if os.path.dirname(k) == pc_path
    )}'''

if old not in content:
    print("NOT FOUND")
else:
    content = content.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK")
