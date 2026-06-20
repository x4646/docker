# -*- coding: utf-8 -*-
import io
FN = "sync_by_exif.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''    root = sys.argv[1]
    print(f"扫描目录: {root}")
    global path_map
    md5_index, path_map = load_md5_index()

    all_files = []
    for dirpath, dirnames, filenames in os.walk(root):'''

new = '''    root = sys.argv[1]
    print(f"扫描目录: {root}")
    global path_map, NAS_MODE, NAS_SMB_ROOT, NAS_SHARE_ROOT
    md5_index, path_map = load_md5_index()

    # NAS路径(/share/开头)：转SMB walk，文件路径转回/share存DB
    walk_root = root
    if root.replace("\\\\","/").startswith("/share/"):
        from nas_client import nas_to_smb
        NAS_MODE = True
        NAS_SHARE_ROOT = root.replace("\\\\","/").rstrip("/")
        NAS_SMB_ROOT = nas_to_smb(NAS_SHARE_ROOT)
        walk_root = NAS_SMB_ROOT
        print(f"NAS模式: SMB={walk_root}")

    all_files = []
    for dirpath, dirnames, filenames in os.walk(walk_root):'''

if old not in c:
    print("NOT FOUND main")
else:
    c = c.replace(old, new, 1)
    print("OK main")
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
