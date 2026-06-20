# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

target = "def get_migrate_status():"

func = '''def migrate_check(src_path, dst_root):
    """校验：检查目标位置有没有同名文件冲突。返回冲突列表，不迁移。"""
    if not src_path or not dst_root:
        return {"ok": False, "error": "缺少源或目标"}
    src = src_path.replace("/", "\\\\").rstrip("\\\\")
    src_fwd = src_path.replace("\\\\", "/").rstrip("/")
    if not os.path.exists(src):
        return {"ok": False, "error": "源目录不存在"}
    dst_root_fwd = dst_root.replace("\\\\", "/").rstrip("/")
    folder_name = src_fwd.split("/")[-1]
    dst_nas_root = dst_root_fwd + ("/" + folder_name if folder_name else "")
    dst_smb_root = nas_to_smb(dst_nas_root)

    total = 0
    conflicts = []
    for dirpath, dirnames, filenames in os.walk(src):
        for name in filenames:
            total += 1
            fp = os.path.join(dirpath, name)
            rel = os.path.relpath(fp, src)
            dst_smb = os.path.join(dst_smb_root, rel)
            try:
                if os.path.exists(dst_smb):
                    conflicts.append(rel.replace("\\\\", "/"))
                    if len(conflicts) > 200:  # 太多就截断
                        break
            except: pass
        if len(conflicts) > 200:
            break
    return {
        "ok": True,
        "total": total,
        "conflictCount": len(conflicts),
        "conflicts": conflicts[:200],
        "dstRoot": dst_nas_root,
        "hasConflict": len(conflicts) > 0
    }

def get_migrate_status():'''

if target not in c:
    print("NOT FOUND")
else:
    c = c.replace(target, func, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
