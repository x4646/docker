# -*- coding: utf-8 -*-
"""
用法: python sync_by_exif.py D:\Pictures
"""
import os, sys, hashlib, piexif, requests, threading
from nas_client import PHOTO_URL

IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff"}
MD5_EXTS = {".jpg", ".jpeg", ".png"}  # 能写md5的格式
counters = {"skip": 0, "update_path": 0, "new": 0, "write_exif": 0, "fail": 0, "total": 0}
batch_insert = []
batch_update = []
batch_md5update = []  # path已存在，补md5
path_map = {}
NAS_MODE = False
NAS_SMB_ROOT = ""
NAS_SHARE_ROOT = ""
BATCH_SIZE = 200

def load_md5_index():
    print("加载DB索引...")
    # 拉所有PC记录：md5索引 + path索引
    r = requests.post(f"{PHOTO_URL}/api/db/query",
        json={"sql": "SELECT id,path,md5 FROM photos WHERE path LIKE 'D:%' OR path LIKE 'E:%' OR path LIKE 'F:%' OR path LIKE '/share/%'"},
        timeout=120)
    rows = r.json().get("rows", [])
    idx = {}
    path_map = {}
    for row in rows:
        if row["md5"]:
            idx[row["md5"]] = {"id": row["id"], "path": row["path"]}
        path_map[row["path"]] = {"id": row["id"], "md5": row["md5"]}
    print(f"已加载{len(idx)}条md5索引, {len(path_map)}条path索引")
    return idx, path_map

def flush_batch():
    global batch_insert, batch_update, batch_md5update
    if batch_md5update:
        for pid, md5 in batch_md5update:
            try:
                requests.post(f"{PHOTO_URL}/api/db/query",
                    json={"sql": f"UPDATE photos SET md5='{md5}',exif_written=1 WHERE id={pid}"},
                    timeout=10)
            except: pass
        batch_md5update = []
    if batch_insert:
        vals = ",".join([f"('{r[0]}','{r[1]}',{r[2]},{r[3]},'{r[4]}','{r[5]}','pending',1)" for r in batch_insert])
        try:
            requests.post(f"{PHOTO_URL}/api/db/query",
                json={"sql": f"INSERT OR IGNORE INTO photos (path,dir,size,mtime,file_key,md5,status,exif_written) VALUES {vals}"},
                timeout=30)
        except Exception as e:
            print(f"批量insert失败: {e}")
        batch_insert = []
    if batch_update:
        for r in batch_update:
            try:
                requests.post(f"{PHOTO_URL}/api/db/query",
                    json={"sql": f"UPDATE photos SET path='{r[0]}',dir='{r[1]}',exif_written=1 WHERE id={r[2]}"},
                    timeout=10)
            except: pass
        batch_update = []

def read_exif_md5(path):
    result = [None]
    def _read():
        try:
            exif = piexif.load(path)
            cmt = exif.get("Exif", {}).get(piexif.ExifIFD.UserComment, b"")
            txt = cmt.decode("utf-8", errors="ignore")
            if "NAS_MD5=" in txt:
                result[0] = txt.split("NAS_MD5=")[1][:32]
        except: pass
    t = threading.Thread(target=_read, daemon=True)
    t.start()
    t.join(3)
    return result[0]

def write_exif_md5(path, md5):
    try:
        exif = piexif.load(path)
        comment = ("ASCII\x00\x00\x00NAS_MD5=" + md5).encode("utf-8")
        exif["Exif"][piexif.ExifIFD.UserComment] = comment
        piexif.insert(piexif.dump(exif), path)
        return True
    except: return False

def process(filepath, md5_index):
    global batch_insert, batch_update
    counters["total"] += 1
    if NAS_MODE:
        # SMB路径转回 /share 存DB
        smb_fwd = filepath.replace("\\", "/")
        smb_root_fwd = NAS_SMB_ROOT.replace("\\", "/")
        rel = smb_fwd[len(smb_root_fwd):].lstrip("/")
        nas_path = NAS_SHARE_ROOT + "/" + rel
    else:
        nas_path = filepath.replace("\\", "/")

    ext = os.path.splitext(filepath)[1].lower()
    # 不能写md5的格式(webp/gif/heic等)：走纯file_key分支
    if ext not in MD5_EXTS:
        existing = path_map.get(nas_path)
        if existing:
            counters["skip"] += 1
            return
        try:
            stat = os.stat(filepath)
            key = hashlib.md5(f"{os.path.basename(filepath)}_{stat.st_size}_{int(stat.st_mtime)}".encode()).hexdigest()
            dir_path = nas_path.rsplit("/", 1)[0]
            # md5列留NULL，靠file_key去重
            batch_insert.append((nas_path, dir_path, stat.st_size, int(stat.st_mtime), key, ""))
            counters["new"] += 1
            if len(batch_insert) >= BATCH_SIZE:
                flush_batch()
        except:
            counters["fail"] += 1
        return

    exif_md5 = read_exif_md5(filepath)

    if exif_md5:
        rec = md5_index.get(exif_md5)
        if rec:
            if rec["path"] == nas_path:
                counters["skip"] += 1
            else:
                dir_path = nas_path.rsplit("/", 1)[0]
                batch_update.append((nas_path, dir_path, rec["id"]))
                counters["update_path"] += 1
                if len(batch_update) >= BATCH_SIZE:
                    flush_batch()
        else:
            # md5不在库。先看path是否已存在(md5=NULL的情况)
            existing = path_map.get(nas_path)
            if existing:
                # path已存在但md5为空，补md5
                batch_md5update.append((existing["id"], exif_md5))
                counters["update_path"] += 1
                if len(batch_md5update) >= BATCH_SIZE:
                    flush_batch()
            else:
                try:
                    stat = os.stat(filepath)
                    key = hashlib.md5(f"{os.path.basename(filepath)}_{stat.st_size}_{int(stat.st_mtime)}".encode()).hexdigest()
                    dir_path = nas_path.rsplit("/", 1)[0]
                    batch_insert.append((nas_path, dir_path, stat.st_size, int(stat.st_mtime), key, exif_md5))
                    counters["new"] += 1
                    if len(batch_insert) >= BATCH_SIZE:
                        flush_batch()
                except:
                    counters["fail"] += 1
    else:
        try:
            with open(filepath, "rb") as f:
                md5 = hashlib.md5(f.read()).hexdigest()
        except:
            counters["fail"] += 1
            return

        write_exif_md5(filepath, md5)

        rec = md5_index.get(md5)
        if rec:
            if rec["path"] != nas_path:
                dir_path = nas_path.rsplit("/", 1)[0]
                batch_update.append((nas_path, dir_path, rec["id"]))
                counters["update_path"] += 1
                if len(batch_update) >= BATCH_SIZE:
                    flush_batch()
            else:
                counters["skip"] += 1
        else:
            existing = path_map.get(nas_path)
            if existing:
                # path已存在但md5为空，补md5
                batch_md5update.append((existing["id"], md5))
                counters["write_exif"] += 1
                counters["update_path"] += 1
                if len(batch_md5update) >= BATCH_SIZE:
                    flush_batch()
            else:
                try:
                    stat = os.stat(filepath)
                    key = hashlib.md5(f"{os.path.basename(filepath)}_{stat.st_size}_{int(stat.st_mtime)}".encode()).hexdigest()
                    dir_path = nas_path.rsplit("/", 1)[0]
                    batch_insert.append((nas_path, dir_path, stat.st_size, int(stat.st_mtime), key, md5))
                    counters["write_exif"] += 1
                    counters["new"] += 1
                    if len(batch_insert) >= BATCH_SIZE:
                        flush_batch()
                except:
                    counters["fail"] += 1

    if counters["total"] % 500 == 0:
        print(f"进度: 跳过{counters['skip']} 更新路径{counters['update_path']} 新增{counters['new']} 写EXIF{counters['write_exif']} 失败{counters['fail']} 共{counters['total']}")

def main():
    if len(sys.argv) < 2:
        print("用法: python sync_by_exif.py D:\\Pictures")
        exit()

    root = sys.argv[1]
    print(f"扫描目录: {root}")
    global path_map, NAS_MODE, NAS_SMB_ROOT, NAS_SHARE_ROOT
    md5_index, path_map = load_md5_index()

    # NAS路径(/share/开头)：转SMB walk，文件路径转回/share存DB
    walk_root = root
    if root.replace("\\","/").startswith("/share/"):
        from nas_client import nas_to_smb
        NAS_MODE = True
        NAS_SHARE_ROOT = root.replace("\\","/").rstrip("/")
        NAS_SMB_ROOT = nas_to_smb(NAS_SHARE_ROOT)
        walk_root = NAS_SMB_ROOT
        print(f"NAS模式: SMB={walk_root}")

    all_files = []
    for dirpath, dirnames, filenames in os.walk(walk_root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in {"$RECYCLE.BIN"}]
        for name in filenames:
            if os.path.splitext(name)[1].lower() in IMG_EXTS:
                all_files.append(os.path.join(dirpath, name))

    print(f"找到{len(all_files)}张JPEG，单线程处理...")
    for fp in all_files:
        process(fp, md5_index)

    flush_batch()

    print(f"\n完成！")
    print(f"  跳过(已同步): {counters['skip']}")
    print(f"  更新路径:     {counters['update_path']}")
    print(f"  新增pending:  {counters['new']}")
    print(f"  写入EXIF:     {counters['write_exif']}")
    print(f"  失败:         {counters['fail']}")
    print(f"  总计:         {counters['total']}")

if __name__ == "__main__":
    main()
