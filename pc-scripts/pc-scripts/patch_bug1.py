# -*- coding: utf-8 -*-
import io
FN = "sync_by_exif.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''def load_md5_index():
    print("加载DB md5索引...")
    r = requests.post(f"{PHOTO_URL}/api/db/query",
        json={"sql": "SELECT id,path,md5 FROM photos WHERE md5 IS NOT NULL"},
        timeout=60)
    rows = r.json().get("rows", [])
    idx = {}
    for row in rows:
        idx[row["md5"]] = {"id": row["id"], "path": row["path"]}
    print(f"已加载{len(idx)}条md5记录")
    return idx'''

new = '''def load_md5_index():
    print("加载DB索引...")
    # 拉所有PC记录：md5索引 + path索引
    r = requests.post(f"{PHOTO_URL}/api/db/query",
        json={"sql": "SELECT id,path,md5 FROM photos WHERE path LIKE 'D:%' OR path LIKE 'E:%' OR path LIKE 'F:%'"},
        timeout=120)
    rows = r.json().get("rows", [])
    idx = {}
    path_map = {}
    for row in rows:
        if row["md5"]:
            idx[row["md5"]] = {"id": row["id"], "path": row["path"]}
        path_map[row["path"]] = {"id": row["id"], "md5": row["md5"]}
    print(f"已加载{len(idx)}条md5索引, {len(path_map)}条path索引")
    return idx, path_map'''

if old not in c:
    print("NOT FOUND load_md5_index")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK 1")
