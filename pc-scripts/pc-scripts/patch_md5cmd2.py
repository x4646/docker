# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()
old = '''            subprocess.Popen(
                f'start cmd /k python "{script}" "{pc_path}"',
                shell=True
            )'''
new = '''            subprocess.Popen(
                ['cmd', '/k', 'python', script, pc_path],
                creationflags=subprocess.CREATE_NEW_CONSOLE
            )'''
if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
