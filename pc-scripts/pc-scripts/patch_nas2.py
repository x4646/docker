# -*- coding: utf-8 -*-
import io
FN = "sync_by_exif.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

# 1. 加全局变量（在 path_map = {} 附近）
old1 = "path_map = {}"
new1 = """path_map = {}
NAS_MODE = False
NAS_SMB_ROOT = ""
NAS_SHARE_ROOT = \"\""""
if old1 in c and "NAS_MODE = False" not in c:
    c = c.replace(old1, new1, 1)
    print("OK globals")
else:
    print("globals SKIP (已存在或未找到)")

# 2. 改第88行：NAS模式下SMB路径转回/share
old2 = '''    counters["total"] += 1
    nas_path = filepath.replace("\\\\", "/")'''
new2 = '''    counters["total"] += 1
    if NAS_MODE:
        # SMB路径转回 /share 存DB
        smb_fwd = filepath.replace("\\\\", "/")
        smb_root_fwd = NAS_SMB_ROOT.replace("\\\\", "/")
        rel = smb_fwd[len(smb_root_fwd):].lstrip("/")
        nas_path = NAS_SHARE_ROOT + "/" + rel
    else:
        nas_path = filepath.replace("\\\\", "/")'''
if old2 in c:
    c = c.replace(old2, new2, 1)
    print("OK process")
else:
    print("NOT FOUND process")

with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
    f.write(c)
