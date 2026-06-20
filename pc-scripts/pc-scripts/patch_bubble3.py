# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

old = '''    # 汇总：把子目录数量冒泡到所有父目录（只冒泡一层，避免重复累加）
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

new = '''    # 从叶到根逐级汇总（先清空中间节点再累加，避免重复）
    # 收集所有需要的中间目录
    all_needed = set(dir_stats.keys())
    for d in list(dir_stats.keys()):
        parent = os.path.dirname(d)
        while parent and parent.startswith(pc_path) and parent not in all_needed:
            all_needed.add(parent)
            parent = os.path.dirname(parent)
    # 初始化中间目录
    for d in all_needed:
        if d not in dir_stats:
            dir_stats[d] = {"total": 0, "done": 0}
    # 从深到浅累加（每个目录只累加直接子目录）
    sorted_dirs = sorted(all_needed, key=lambda x: x.count(os.sep), reverse=True)
    for d in sorted_dirs:
        parent = os.path.dirname(d)
        if parent and parent != d and parent.startswith(pc_path):
            dir_stats[parent]["total"] += dir_stats[d]["total"]
            dir_stats[parent]["done"]  += dir_stats[d]["done"]
    # 根目录用actual覆盖（避免累加误差）
    dir_stats[pc_path] = {"total": actual, "done": dir_stats.get(pc_path, {}).get("done", 0)}'''

if old not in content:
    print("NOT FOUND")
else:
    content = content.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK")
