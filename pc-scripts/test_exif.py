import os, piexif, requests

NAS_URL = "http://192.168.0.3:3050"

def nas_to_smb(path):
    return "\\\\whfnas\\" + path.replace("/share/", "").replace("/", "\\")

r = requests.get(f"{NAS_URL}/api/photos?status=done&limit=20&page=1", timeout=30)
photos = r.json().get("photos", [])
fail_count = 0
for p in photos:
    ext = os.path.splitext(p["path"])[1].lower()
    md5 = p.get("md5")
    if ext not in (".jpg",".jpeg") or not md5:
        continue
    smb = nas_to_smb(p["path"])
    if not os.path.exists(smb):
        print("文件不存在:", smb)
        continue
    try:
        exif = piexif.load(smb)
        comment = ("ASCII\x00\x00\x00NAS_MD5=" + md5).encode("utf-8")
        exif["Exif"][piexif.ExifIFD.UserComment] = comment
        piexif.insert(piexif.dump(exif), smb)
        print("OK:", os.path.basename(p["path"]))
    except Exception as e:
        print("FAIL:", os.path.basename(p["path"]), "-", type(e).__name__, str(e)[:80])
        fail_count += 1
print("失败总数:", fail_count)
