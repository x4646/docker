# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

old = '    return {"status": "done", "actual": len(all_files), "dirStats": {pc_path: {"total": len(all_files), "done": 0}}}'

new = '''    # 按子目录分组统计
    dir_stats = {}
    for f in all_files:
        d = os.path.dirname(f)
        if d not in dir_stats:
            dir_stats[d] = {"total": 0, "done": 0}
        dir_stats[d]["total"] += 1
    return {"status": "done", "actual": len(all_files), "dirStats": dir_stats}'''

if old not in content:
    print("NOT FOUND")
else:
    content = content.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK")
