# -*- coding: utf-8 -*-
import io
FN = "find_no_md5.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()
c = c.replace("BROKEN_DIR = r\"F:\\损坏文件\"", "BROKEN_DIR = r\"D:\\损坏文件\"")
c = c.replace("shutil.move", "shutil.copy2")
with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
    f.write(c)
print("OK")
