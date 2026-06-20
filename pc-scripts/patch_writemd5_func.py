# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

new_func = '''
def handle_write_md5(msg):
    """遍历目录所有JPEG，打上EXIF md5并同步DB"""
    import hashlib, piexif as _px, requests as _req
    pc_path = msg.get("pcPath", "")
    if not pc_path or not os.path.exists(pc_path.replace("/", chr(92))):
        print(f"[write-md5] 目录不存在: {pc_path}")
        return
    pc_path = pc_path.replace("/", chr(92))
    IMG_EXTS = {".jpg", ".jpeg"}
    done = skip = fail = total = 0
    print(f"[write-md5] 开始: {pc_path}")

    # 拉取DB md5索引
    try:
        r = _req.post(f"{PHOTO_URL}/api/db/query",
            json={"sql": "SELECT id,path,md5 FROM photos WHERE md5 IS NOT NULL"},
            timeout=60)
        rows = r.json().get("rows", [])
        md5_index = {row["md5"]: {"id": row["id"], "path": row["path"]} for row in rows}
    except Exception as e:
        print(f"[write-md5] 拉取md5索引失败: {e}")
        return

    batch_upd = []
    batch_ins = []

    for dirpath, dirnames, filenames in os.walk(pc_path):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in {"$RECYCLE.BIN"}]
        for name in filenames:
            if os.path.splitext(name)[1].lower() not in IMG_EXTS:
                continue
            filepath = os.path.join(dirpath, name)
            total += 1
            nas_path = filepath.replace(chr(92), "/")

            # 读EXIF md5
            exif_md5 = None
            try:
                exif = _px.load(filepath)
                cmt = exif.get("Exif", {}).get(_px.ExifIFD.UserComment, b"")
                txt = cmt.decode("utf-8", errors="ignore")
                if "NAS_MD5=" in txt:
                    exif_md5 = txt.split("NAS_MD5=")[1][:32]
            except: pass

            if not exif_md5:
                # 算md5写EXIF
                try:
                    with open(filepath, "rb") as f:
                        exif_md5 = hashlib.md5(f.read()).hexdigest()
                    exif = _px.load(filepath)
                    comment = ("ASCII\\x00\\x00\\x00NAS_MD5=" + exif_md5).encode("utf-8")
                    exif["Exif"][_px.ExifIFD.UserComment] = comment
                    _px.insert(_px.dump(exif), filepath)
                except Exception as e:
                    fail += 1
                    continue

            # 查DB
            rec = md5_index.get(exif_md5)
            if rec:
                if rec["path"] != nas_path:
                    dir_path = nas_path.rsplit("/", 1)[0]
                    batch_upd.append((nas_path, dir_path, rec["id"]))
                else:
                    skip += 1
            else:
                try:
                    stat = os.stat(filepath)
                    key = hashlib.md5(f"{name}_{stat.st_size}_{int(stat.st_mtime)}".encode()).hexdigest()
                    dir_path = nas_path.rsplit("/", 1)[0]
                    batch_ins.append((nas_path, dir_path, stat.st_size, int(stat.st_mtime), key, exif_md5))
                except:
                    fail += 1

            # 批量提交
            if len(batch_upd) >= 200 or len(batch_ins) >= 200:
                _flush_md5_batch(batch_upd, batch_ins)
                done += len(batch_upd) + len(batch_ins)
                batch_upd, batch_ins = [], []

            if total % 500 == 0:
                print(f"[write-md5] 进度: {total}张 完成{done} 跳过{skip} 失败{fail}")

    _flush_md5_batch(batch_upd, batch_ins)
    done += len(batch_upd) + len(batch_ins)
    print(f"[write-md5] 完成: total={total} done={done} skip={skip} fail={fail}")


def _flush_md5_batch(upd, ins):
    import requests as _req
    if upd:
        for r in upd:
            try:
                _req.post(f"{PHOTO_URL}/api/db/query",
                    json={"sql": f"UPDATE photos SET path='{r[0]}',dir='{r[1]}',exif_written=1 WHERE id={r[2]}"},
                    timeout=10)
            except: pass
    if ins:
        vals = ",".join([f"('{r[0]}','{r[1]}',{r[2]},{r[3]},'{r[4]}','{r[5]}','pending',1)" for r in ins])
        try:
            _req.post(f"{PHOTO_URL}/api/db/query",
                json={"sql": f"INSERT OR IGNORE INTO photos (path,dir,size,mtime,file_key,md5,status,exif_written) VALUES {vals}"},
                timeout=30)
        except: pass

'''

# 插入到handle_scan_and_process前面
target = 'def handle_scan_and_process(msg):'
if target not in c:
    print("NOT FOUND")
else:
    c = c.replace(target, new_func + target, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
