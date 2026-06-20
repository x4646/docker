# -*- coding: utf-8 -*-
"""补全 pending+md5=NULL 的PC记录的md5"""
import os, hashlib, piexif, requests
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from nas_client import PHOTO_URL

def read_md5(filepath):
    ext = os.path.splitext(filepath)[1].lower()
    # 先读已有md5
    try:
        if ext in (".jpg", ".jpeg"):
            exif = piexif.load(filepath)
            cmt = exif.get("Exif", {}).get(piexif.ExifIFD.UserComment, b"")
            txt = cmt.decode("utf-8", errors="ignore")
            if "NAS_MD5=" in txt:
                return txt.split("NAS_MD5=")[1][:32], False
        elif ext == ".png":
            m = Image.open(filepath).info.get("NAS_MD5")
            if m: return m, False
    except: pass
    # 读不到就算md5
    try:
        with open(filepath, "rb") as f:
            return hashlib.md5(f.read()).hexdigest(), True
    except:
        return None, None

def write_md5(filepath, md5):
    ext = os.path.splitext(filepath)[1].lower()
    try:
        if ext in (".jpg", ".jpeg"):
            exif = piexif.load(filepath)
            exif["Exif"][piexif.ExifIFD.UserComment] = ("ASCII\x00\x00\x00NAS_MD5=" + md5).encode("utf-8")
            piexif.insert(piexif.dump(exif), filepath)
        elif ext == ".png":
            img = Image.open(filepath)
            meta = PngInfo()
            for k, v in img.info.items():
                if isinstance(v, str): meta.add_text(k, v)
            meta.add_text("NAS_MD5", md5)
            img.save(filepath, pnginfo=meta)
    except: pass

print("拉取 pending+md5=NULL 的PC记录...")
r = requests.post(f"{PHOTO_URL}/api/db/query",
    json={"sql": "SELECT id,path FROM photos WHERE status='pending' AND md5 IS NULL AND (path LIKE 'D:%' OR path LIKE 'E:%' OR path LIKE 'F:%')"},
    timeout=120)
rows = r.json().get("rows", [])
print(f"共 {len(rows)} 条")

batch = []
done = fail = skip = 0

def flush(b):
    if not b: return
    sqls = [f"UPDATE photos SET md5='{md5}',exif_written=1 WHERE id={pid}" for pid, md5 in b]
    try:
        requests.post(f"{PHOTO_URL}/api/db/batch", json={"sqls": sqls}, timeout=30)
    except Exception as e:
        print(f"批量提交失败: {e}")

for row in rows:
    local = row["path"].replace("/", "\\")
    if not os.path.exists(local):
        skip += 1
        continue
    md5, computed = read_md5(local)
    if not md5:
        fail += 1
        continue
    if computed:        # 算出来的，回写EXIF
        write_md5(local, md5)
    batch.append((row["id"], md5))
    done += 1
    if len(batch) >= 200:
        flush(batch); batch = []
    if done % 500 == 0:
        print(f"进度: 完成{done} 跳过{skip} 失败{fail}")

flush(batch)
print(f"完成: 更新{done} 跳过{skip} 失败{fail}")
