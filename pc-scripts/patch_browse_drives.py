# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''            if not dirPath:
                # 返回根目录列表
                result = [{'name': k, 'path': v, 'type': 'dir'} for k, v in PC_ROOTS.items()]
                self._json(result)
                return'''

new = '''            if not dirPath:
                # 返回所有盘符
                import string
                drives = []
                for letter in string.ascii_uppercase:
                    d = f"{letter}:\\\\"
                    if os.path.exists(d):
                        drives.append({'name': f"{letter}:", 'path': d, 'type': 'dir'})
                self._json(drives)
                return'''

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
