# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''        if not files:
            continue

        total_actual += len(files)
        done_cnt = sum(1 for f in files if f["key"] in done_keys)
        dir_stats[dirpath] = {"total": len(files), "done": done_cnt}

        # 上报进度到NAS
        if task_id:
            try:
                requests.post(f"{PHOTO_URL}/api/pc/scan-progress", json={
                    "taskId":  task_id,
                    "dirPath": dirpath,
                    "files":   files,
                    "stats":   {dirpath: {"total": len(files), "done": done_cnt}},
                }, timeout=30)
            except Exception as e:
                print(f"上报失败: {dirpath} - {e}")'''

new = '''        if not files:
            continue

        # 对file_key不在done_keys的文件，读EXIF里的md5做第二层匹配
        for f in files:
            if f["key"] not in done_keys and f["path"].lower().endswith((".jpg",".jpeg")):
                try:
                    import piexif
                    local = f["path"].replace("/", chr(92))
                    exif = piexif.load(local)
                    cmt = exif.get("Exif", {}).get(piexif.ExifIFD.UserComment, b"")
                    txt = cmt.decode("utf-8", errors="ignore")
                    if "NAS_MD5=" in txt:
                        f["exif_md5"] = txt.split("NAS_MD5=")[1][:32]
                except: pass

        total_actual += len(files)
        done_cnt = sum(1 for f in files if f["key"] in done_keys)
        dir_stats[dirpath] = {"total": len(files), "done": done_cnt}

        # 上报进度到NAS
        if task_id:
            try:
                requests.post(f"{PHOTO_URL}/api/pc/scan-progress", json={
                    "taskId":  task_id,
                    "dirPath": dirpath,
                    "files":   files,
                    "stats":   {dirpath: {"total": len(files), "done": done_cnt}},
                }, timeout=30)
            except Exception as e:
                print(f"上报失败: {dirpath} - {e}")'''

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
