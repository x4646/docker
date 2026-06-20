# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

old = '''    print(f"扫描完成: {actual} 张，{len(dir_stats)} 个目录")

    # 写pc_dir_stats到NAS'''

new = '''    # 汇总：把子目录数量冒泡到所有父目录
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
                break

    print(f"扫描完成: {actual} 张，{len(dir_stats)} 个目录")

    # 写pc_dir_stats到NAS'''

if old not in content:
    print("NOT FOUND")
else:
    content = content.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK")
