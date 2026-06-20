# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

# 插到 def handle_clean_orphan 前面
target = "def handle_clean_orphan(pc_path):"

func = '''# ── 迁移：PC目录整体复制到NAS + 改DB ────────────────
migrate_state = {"running": False, "total": 0, "copied": 0, "skipped": 0, "failed": 0,
                 "cur": "", "src": "", "dst": "", "done": False, "error": ""}
migrate_lock = threading.Lock()

def get_migrate_status():
    with migrate_lock:
        return dict(migrate_state)

def start_migrate(src_path, dst_root):
    with migrate_lock:
        if migrate_state["running"]:
            return {"ok": False, "error": "已有迁移任务进行中"}
    if not src_path or not dst_root:
        return {"ok": False, "error": "缺少源或目标"}
    threading.Thread(target=_do_migrate, args=(src_path, dst_root), daemon=True).start()
    return {"ok": True, "message": "迁移已开始"}

def _do_migrate(src_path, dst_root):
    import requests as _req
    src = src_path.replace("/", "\\\\").rstrip("\\\\")
    src_fwd = src_path.replace("\\\\", "/").rstrip("/")
    dst_root_fwd = dst_root.replace("\\\\", "/").rstrip("/")   # /share/Person
    folder_name = src_fwd.split("/")[-1]                        # 脸红Dearie NO
    dst_nas_root = dst_root_fwd + "/" + folder_name             # /share/Person/脸红Dearie NO
    dst_smb_root = nas_to_smb(dst_nas_root)                     # \\\\whfnas\\Person\\脸红Dearie NO

    with migrate_lock:
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

    db_updates = []
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
    _flush_migrate_db(db_updates)

    with migrate_lock:
        migrate_state["running"] = False
        migrate_state["done"] = True
    print(f"[migrate] 完成: 复制{migrate_state[\\'copied\\']} 跳过{migrate_state[\\'skipped\\']} 失败{migrate_state[\\'failed\\']}")

def _flush_migrate_db(updates):
    """改DB path: src_nas -> dst_nas。注意DB里PC路径存的是 F:/ 格式"""
    import requests as _req
    if not updates:
        return
    sqls = []
    for src_nas, dst_nas in updates:
        # DB里PC图片path是 F:/... 格式(src_fwd就是)，直接改成 /share/...
        s = src_nas.replace("'", "''")
        d = dst_nas.replace("'", "''")
        sqls.append(f"UPDATE photos SET path='{d}', dir='{d.rsplit('/',1)[0]}' WHERE path='{s}'")
    try:
        _req.post(f"{PHOTO_URL}/api/db/batch", json={"sqls": sqls}, timeout=60)
    except Exception as e:
        print(f"[migrate] 改DB失败: {e}")


'''

if target not in c:
    print("NOT FOUND target")
else:
    c = c.replace(target, func + target, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
