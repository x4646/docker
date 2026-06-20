# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

# 去掉_do_migrate里的DB改写：db_updates收集和flush都删掉
old = '''    db_updates = []
    for fp in all_files:
        rel = os.path.relpath(fp, src)                  # 子路径
        dst_smb = os.path.join(dst_smb_root, rel)       # SMB目标
        src_nas = (src_fwd + "/" + rel.replace("\\\\","/"))   # 源NAS格式path(DB里的)
        dst_nas = (dst_nas_root + "/" + rel.replace("\\\\","/")) # 目标NAS格式path
        try:
            os.makedirs(os.path.dirname(dst_smb), exist_ok=True)
            if os.path.exists(dst_smb) and os.path.getsize(dst_smb) == os.path.getsize(fp):
                with migrate_lock: migrate_state["skipped"] += 1
            else:
                shutil.copy2(fp, dst_smb)
                with migrate_lock: migrate_state["copied"] += 1
            db_updates.append((src_nas, dst_nas))
            with migrate_lock: migrate_state["cur"] = rel
        except Exception as e:
            with migrate_lock: migrate_state["failed"] += 1
            print(f"[migrate] 复制失败 {rel}: {e}")
        # 每100个批量改一次DB
        if len(db_updates) >= 100:
            _flush_migrate_db(db_updates)
            db_updates = []
    _flush_migrate_db(db_updates)'''

new = '''    for fp in all_files:
        rel = os.path.relpath(fp, src)
        dst_smb = os.path.join(dst_smb_root, rel)
        try:
            os.makedirs(os.path.dirname(dst_smb), exist_ok=True)
            if os.path.exists(dst_smb) and os.path.getsize(dst_smb) == os.path.getsize(fp):
                with migrate_lock: migrate_state["skipped"] += 1
            else:
                shutil.copy2(fp, dst_smb)
                with migrate_lock: migrate_state["copied"] += 1
            with migrate_lock: migrate_state["cur"] = rel
        except Exception as e:
            with migrate_lock: migrate_state["failed"] += 1
            print(f"[migrate] 复制失败 {rel}: {e}")'''

if old not in c:
    print("NOT FOUND migrate loop")
else:
    c = c.replace(old, new, 1)
    print("OK migrate")
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
