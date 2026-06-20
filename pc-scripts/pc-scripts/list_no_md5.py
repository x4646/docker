import os, piexif, requests
from nas_client import PHOTO_URL

IMG_EXTS = {".jpg", ".jpeg"}
no_md5_dirs = set()
total = no_md5 = 0

def check(filepath):
    try:
        exif = piexif.load(filepath)
        cmt = exif.get("Exif", {}).get(piexif.ExifIFD.UserComment, b"")
        txt = cmt.decode("utf-8", errors="ignore")
        return "NAS_MD5=" in txt
    except: return False

r = requests.get(f"{PHOTO_URL}/api/pc-roots", timeout=10)
roots = r.json()

all_files = []
for root in roots:
    pc_path = root["path"].replace("/", "\\")
    for dirpath, dirnames, filenames in os.walk(pc_path):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in {"$RECYCLE.BIN"}]
        for name in filenames:
            if os.path.splitext(name)[1].lower() in IMG_EXTS:
                all_files.append(os.path.join(dirpath, name))

print(f"共找到{len(all_files)}张JPEG，开始检查...")
for fp in all_files:
    total += 1
    if not check(fp):
        no_md5 += 1
        no_md5_dirs.add(os.path.dirname(fp))
    if total % 1000 == 0:
        print(f"进度: {total}张 未写md5:{no_md5}张")

print(f"\n共{total}张，未写md5:{no_md5}张，涉及{len(no_md5_dirs)}个目录")
for d in sorted(no_md5_dirs):
    print(" ", d)
