# -*- coding: utf-8 -*-
import os, piexif, requests, threading
from concurrent.futures import ThreadPoolExecutor
from nas_client import PHOTO_URL, nas_to_smb

THREADS = 8
lock = threading.Lock()
counters = {"done": 0, "skip": 0, "fail": 0, "total": 0}

def get_smb_host():
    try:
        return requests.get(f"{PHOTO_URL}/api/config/system", timeout=5).json().get("nas_smb_host", "whfnas")
    except: return "whfnas"

def write_with_timeout(smb, md5, timeout=5):
    result = [False, None]
    def _write():
        try:
            exif = piexif.load(smb)
            comment = ("ASCII\x00\x00\x00NAS_MD5=" + md5).encode("utf-8")
            exif["Exif"][piexif.ExifIFD.UserComment] = comment
            piexif.insert(piexif.dump(exif), smb)
            result[0] = True
        except Exception as e:
            result[1] = str(e)
    t = threading.Thread(target=_write, daemon=True)
    t.start()
    t.join(timeout)
    if t.is_alive(): return False, "timeout"
    return result[0], result[1]

def process_photo(p):
    ext = os.path.splitext(p["path"])[1].lower()
    md5 = p.get("md5")
    with lock: counters["total"] += 1

    if ext not in (".jpg", ".jpeg") or not md5:
        with lock: counters["skip"] += 1
        return
    if p.get("exif_written"):
        with lock: counters["skip"] += 1
        return

    smb = nas_to_smb(p["path"])
    if not os.path.exists(smb):
        with lock: counters["skip"] += 1
        return

    # 检查是否已写
    try:
        exif = piexif.load(smb)
        cmt = exif.get("Exif", {}).get(piexif.ExifIFD.UserComment, b"").decode("utf-8", errors="ignore")
        if "NAS_MD5=" + md5 in cmt:
            requests.post(f"{PHOTO_URL}/api/db/query",
                json={"sql": f"UPDATE photos SET exif_written=1 WHERE id={p['id']}"}, timeout=5)
            with lock: counters["skip"] += 1
            return
    except: pass

    ok, err = write_with_timeout(smb, md5, timeout=5)
    if ok:
        try:
            requests.post(f"{PHOTO_URL}/api/db/query",
                json={"sql": f"UPDATE photos SET exif_written=1 WHERE id={p['id']}"}, timeout=5)
        except: pass
        with lock:
            counters["done"] += 1
            if counters["done"] % 100 == 0:
                print(f"进度: 写入{counters['done']} 跳过{counters['skip']} 失败{counters['fail']} 共{counters['total']}")
    else:
        with lock:
            counters["fail"] += 1

def main():
    print(f"NAS: {PHOTO_URL}")
    # 确保DB有exif_written字段
    try:
        requests.post(f"{PHOTO_URL}/api/db/query",
            json={"sql": "ALTER TABLE photos ADD COLUMN exif_written INTEGER DEFAULT 0"}, timeout=10)
    except: pass

    print("拉取图片列表...")
    page = 1
    all_photos = []
    while True:
        r = requests.get(f"{PHOTO_URL}/api/photos?status=done&limit=200&page={page}", timeout=30)
        data = r.json()
        photos = data.get("photos", [])
        if not photos: break
        all_photos.extend(photos)
        page += 1
        if len(photos) < 200: break

    print(f"共{len(all_photos)}张，开始{THREADS}线程处理...")
    with ThreadPoolExecutor(max_workers=THREADS) as pool:
        pool.map(process_photo, all_photos)

    print(f"完成！写入:{counters['done']} 跳过:{counters['skip']} 失败:{counters['fail']} 共:{counters['total']}")

if __name__ == "__main__":
    main()
