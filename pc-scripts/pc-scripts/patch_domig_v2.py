# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''    with migrate_lock:
        migrate_state.update({"running": True, "total": 0, "copied": 0, "skipped": 0,
                              "failed": 0, "cur": "", "src": src_fwd, "dst": dst_nas_root,
                              "done": False, "error": ""})
    print(f"[migrate] {src} -> {dst_smb_root}")

    # 收集所有文件
    all_files = []
    for dirpath, dirnames, filenames in os.walk(src):
        for name in filenames:
            all_files.append(os.path.join(dirpath, name))
    with migrate_lock:
        migrate_state["total"] = len(all_files)
    print(f"[migrate] 共 {len(all_files)} 个文件")

    for fp in all_files:
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
            print(f"[migrate] 复制失败 {rel}: {e}")

    with migrate_lock:
        migrate_state["running"] = False
        migrate_state["done"] = True
    print("[migrate] 完成: 复制%d 跳过%d 失败%d" % (migrate_state["copied"], migrate_state["skipped"], migrate_state["failed"]))'''

new = '''    # 批次ID：用时间戳
    batch_id = str(int(time.time()))
    with migrate_lock:
        migrate_state.update({"running": True, "total": 0, "copied": 0, "skipped": 0,
                              "failed": 0, "cur": "", "src": src_fwd, "dst": dst_nas_root,
                              "done": False, "error": "", "batch": batch_id})
    print(f"[migrate] batch={batch_id} {src} -> {dst_smb_root}")

    # 收集所有文件
    all_files = []
    for dirpath, dirnames, filenames in os.walk(src):
        for name in filenames:
            all_files.append(os.path.join(dirpath, name))
    with migrate_lock:
        migrate_state["total"] = len(all_files)
    print(f"[migrate] 共 {len(all_files)} 个文件")

    # 收集成功/失败
    updates = []   # [{src: F:/x, dst: /share/y}]
    failures = [] # [{src, dst, error}]

    for fp in all_files:
        rel = os.path.relpath(fp, src)
        dst_smb = os.path.join(dst_smb_root, rel)
        # 源NAS格式path(DB里的) + 目标NAS格式path
        rel_fwd = rel.replace("\\\\", "/")
        src_nas = src_fwd + "/" + rel_fwd
        dst_nas = dst_nas_root + "/" + rel_fwd
        try:
            os.makedirs(os.path.dirname(dst_smb), exist_ok=True)
            if os.path.exists(dst_smb) and os.path.getsize(dst_smb) == os.path.getsize(fp):
                with migrate_lock: migrate_state["skipped"] += 1
                updates.append({"src": src_nas, "dst": dst_nas})  # 跳过=已存在，也算迁移成功
            else:
                shutil.copy2(fp, dst_smb)
                with migrate_lock: migrate_state["copied"] += 1
                updates.append({"src": src_nas, "dst": dst_nas})
            with migrate_lock: migrate_state["cur"] = rel
        except Exception as e:
            err_msg = str(e)
            with migrate_lock: migrate_state["failed"] += 1
            failures.append({"src": src_nas, "dst": dst_nas, "error": err_msg})
            print(f"[migrate] 复制失败 {rel}: {err_msg}")

    # 复制结束：成功的批量改DB，失败的存表
    import requests as _req
    if updates:
        try:
            r = _req.post(f"{PHOTO_URL}/api/migrate-commit", json={"updates": updates}, timeout=60)
            print(f"[migrate] DB更新: {r.json()}")
        except Exception as e:
            print(f"[migrate] DB更新失败: {e}")
    if failures:
        try:
            r = _req.post(f"{PHOTO_URL}/api/migrate-failures", json={"batch": batch_id, "failures": failures}, timeout=30)
            print(f"[migrate] 失败记录: {r.json()}")
        except Exception as e:
            print(f"[migrate] 失败记录写入失败: {e}")

    with migrate_lock:
        migrate_state["running"] = False
        migrate_state["done"] = True
    print("[migrate] 完成: 复制%d 跳过%d 失败%d" % (migrate_state["copied"], migrate_state["skipped"], migrate_state["failed"]))'''

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
