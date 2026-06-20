# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''    # 清理孤立记录：分批发所有路径给NAS
    root_fwd = pc_path.replace(chr(92), "/")
    batch_size = 500
    paths_list = list(all_file_paths)
    print(f"清理孤立记录: 共{len(paths_list)}个文件路径发给NAS")
    for i in range(0, len(paths_list), batch_size):
        batch = paths_list[i:i+batch_size]
        try:
            requests.post(f"{PHOTO_URL}/api/pc/cleanup-orphans", json={
                "rootPath": root_fwd,
                "paths":    batch,
                "final":    (i + batch_size >= len(paths_list)),
            }, timeout=30)
        except Exception as e:
            print(f"清理孤立失败: {e}")
            break'''

new = '''    # 清理孤立记录：PC做差分，删掉DB里不存在的文件记录
    root_fwd = pc_path.replace(chr(92), "/")
    try:
        r = requests.post(f"{PHOTO_URL}/api/db/query",
            json={"sql": f"SELECT id,path FROM photos WHERE path LIKE '{root_fwd}%'"},
            timeout=30)
        db_rows = r.json().get("rows", [])
        to_delete = [row["id"] for row in db_rows if row["path"] not in all_file_paths]
        if to_delete:
            print(f"清理孤立记录: 删除{len(to_delete)}条")
            batch_size = 100
            for i in range(0, len(to_delete), batch_size):
                batch = to_delete[i:i+batch_size]
                ids_str = ",".join(str(x) for x in batch)
                requests.post(f"{PHOTO_URL}/api/db/query",
                    json={"sql": f"DELETE FROM photos WHERE id IN ({ids_str})"},
                    timeout=10)
        else:
            print("清理孤立记录: 无需清理")
    except Exception as e:
        print(f"清理孤立失败: {e}")'''

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
