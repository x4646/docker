# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

# 插到 handle_scan_and_process 定义前面
target = "def handle_scan_and_process(msg):"

func = '''def handle_clean_orphan(pc_path):
    """清理孤立记录：DB里有但PC本地文件已不存在的，删DB记录+NAS缩略图"""
    import requests as _req
    if not pc_path:
        print("[clean-orphan] 缺少路径")
        return
    fwd = pc_path.replace("\\\\", "/").rstrip("/")
    print(f"[clean-orphan] 开始检查: {fwd}")

    # 拉该目录所有DB记录
    try:
        r = _req.post(f"{PHOTO_URL}/api/db/query",
            json={"sql": f"SELECT id,path FROM photos WHERE REPLACE(path,'\\\\','/') LIKE '{fwd}/%'"},
            timeout=120)
        rows = r.json().get("rows", [])
    except Exception as e:
        print(f"[clean-orphan] 拉取DB失败: {e}")
        return

    print(f"[clean-orphan] DB记录 {len(rows)} 条，逐个检查本地文件...")
    orphan_ids = []
    checked = 0
    for row in rows:
        local = row["path"].replace("/", "\\\\")
        if not os.path.exists(local):
            orphan_ids.append(row["id"])
        checked += 1
        if checked % 2000 == 0:
            print(f"[clean-orphan] 已检查 {checked}/{len(rows)}, 孤立 {len(orphan_ids)}")

    print(f"[clean-orphan] 检查完成: 孤立记录 {len(orphan_ids)} 条")
    if not orphan_ids:
        print("[clean-orphan] 无需清理")
        return

    # 批量回传NAS删除(删DB记录+NAS缩略图)
    BATCH = 200
    deleted = 0
    for i in range(0, len(orphan_ids), BATCH):
        batch = orphan_ids[i:i+BATCH]
        try:
            resp = _req.post(f"{PHOTO_URL}/api/photos/delete-by-ids",
                json={"ids": batch}, timeout=60)
            deleted += resp.json().get("deleted", 0)
        except Exception as e:
            print(f"[clean-orphan] 删除批次失败: {e}")
    print(f"[clean-orphan] 完成: 已删除 {deleted} 条孤立记录")


'''

if target not in c:
    print("NOT FOUND target")
else:
    c = c.replace(target, func + target, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK func")
