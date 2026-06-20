# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''    print(f"[migrate] 完成: 复制{migrate_state[\\'copied\\']} 跳过{migrate_state[\\'skipped\\']} 失败{migrate_state[\\'failed\\']}")'''
new = '''    print("[migrate] 完成: 复制%d 跳过%d 失败%d" % (migrate_state["copied"], migrate_state["skipped"], migrate_state["failed"]))'''

if old not in c:
    print("NOT FOUND, 尝试用行替换")
    # 兜底：按行号附近找
    lines = c.split("\n")
    for i, ln in enumerate(lines):
        if "[migrate] 完成" in ln and "copied" in ln:
            lines[i] = '    print("[migrate] 完成: 复制%d 跳过%d 失败%d" % (migrate_state["copied"], migrate_state["skipped"], migrate_state["failed"]))'
            print(f"已替换第{i+1}行")
            break
    c = "\n".join(lines)
else:
    c = c.replace(old, new, 1)
    print("OK")

with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
    f.write(c)
