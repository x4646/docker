# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

old = "    dir_stats = {}\n    actual = 0"
new = "    dir_stats = {}\n    all_files = []\n    actual = 0"

if old not in content:
    print("NOT FOUND")
else:
    content = content.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK step1")

# 在actual += 1后面加 all_files.append(filepath)
old2 = "                actual += 1\n                if key in done_keys:"
new2 = "                actual += 1\n                all_files.append(filepath)\n                if key in done_keys:"

if old2 not in content:
    print("NOT FOUND step2")
else:
    content = content.replace(old2, new2, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK step2")
