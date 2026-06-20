# -*- coding: utf-8 -*-
import io, requests, os, hashlib

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

OLD = '''def handle_scan_and_process(msg):
    """扫描PC目录并处理图片"""
    from PIL import Image, ImageOps
    import piexif
    import imagehash
    import hashlib'''

NEW = '''def handle_scan_and_process(msg):
    """扫描PC目录，写pending到NAS DB，由worker处理"""
    import hashlib'''

if OLD not in content:
    print("NOT FOUND header")
else:
    content = content.replace(OLD, NEW, 1)
    print("header OK")

# 替换函数体：从pc_path开始到return那行
OLD2 = '''    pc_path      = msg.get("pcPath", "")
    nas_data_path = msg.get("nasDataPath", "/data/photos")
    
    if not pc_path or not os.path.exists(pc_path):
        print(f"目录不存在: {pc_path}")
        return {"status": "failed", "error": "目录不存在"}

    IMG_EXTS = {".jpg",".jpeg",".png",".gif",".bmp",".tiff",".webp"}
    
    # 扫描目录下所有图片
    all_files = []
    for dirpath, dirnames, filenames in os.walk(pc_path):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and not d.startswith("@")]
        for filename in filenames:
            if os.path.splitext(filename)[1].lower() in IMG_EXTS:
                all_files.append(os.path.join(dirpath, filename))

    print(f"扫描完成: {len(all_files)} 张图片 in {pc_path}")
    
    nas_thumb_dir   = f"\\\\\\\\whfnas\\\\Container\\\\docker\\\\data\\\\photos\\\\thumbs"
    nas_preview_dir = f"\\\\\\\\whfnas\\\\Container\\\\docker\\\\data\\\\photos\\\\preview"
    os.makedirs(nas_thumb_dir,   exist_ok=True)
    os.makedirs(nas_preview_dir, exist_ok=True)

    done = 0
    for filepath in all_files:
        try:
            stat     = os.stat(filepath)
            file_key_raw = f"{os.path.basename(filepath)}_{stat.st_size}_{int(stat.st_mtime)}"
            file_key = hashlib.md5(file_key_raw.encode()).hexdigest()

            with open(filepath, "rb") as f:
                md5 = hashlib.md5(f.read()).hexdigest()

            thumb_name   = f"{md5}_thumb.jpg"
            preview_name = f"{md5}_preview.jpg"
            thumb_path   = os.path.join(nas_thumb_dir, thumb_name)
            preview_path = os.path.join(nas_preview_dir, preview_name)

            # 生成缩略图
            img = Image.open(filepath)
            try:
                from PIL import ImageOps
                img = ImageOps.exif_transpose(img)
            except: pass
            w, h = img.size

            if not os.path.exists(thumb_path):
                thumb = img.copy()
                thumb.thumbnail((200, 200), Image.LANCZOS)
                thumb.convert("RGB").save(thumb_path, "JPEG", quality=85)

            if not os.path.exists(preview_path):
                preview = img.copy()
                preview.thumbnail((1920, 1920), Image.LANCZOS)
                preview.convert("RGB").save(preview_path, "JPEG", quality=90)

            # 读EXIF
            exif_time = exif_camera = exif_gps = None
            try:
                exif_data = piexif.load(filepath)
                exif_dict = exif_data.get("Exif", {})
                zeroth    = exif_data.get("0th", {})
                dt_str    = exif_dict.get(piexif.ExifIFD.DateTimeOriginal)
                if dt_str:
                    from datetime import datetime
                    try:
                        dt = datetime.strptime(dt_str.decode(), "%Y:%m:%d %H:%M:%S")
                        exif_time = int(dt.timestamp())
                    except: pass
                make  = zeroth.get(piexif.ImageIFD.Make, b"").decode("utf-8", errors="ignore").strip("\\x00")
                model = zeroth.get(piexif.ImageIFD.Model, b"").decode("utf-8", errors="ignore").strip("\\x00")
                if make or model:
                    exif_camera = f"{make} {model}".strip()
            except: pass

            phash = str(imagehash.phash(img))
            ctime = int(stat.st_ctime)

            # 上报结果
            result = {
                "path":         filepath.replace("\\\\", "/"),
                "file_key":     file_key,
                "thumb_path":   f"thumbs/{thumb_name}",
                "preview_path": f"preview/{preview_name}",
                "md5":          md5,
                "width":        w,
                "height":       h,
                "exif_time":    exif_time,
                "exif_camera":  exif_camera,
                "exif_gps":     exif_gps,
                "phash":        phash,
                "ctime":        ctime,
                "size":         stat.st_size,
                "mtime":        int(stat.st_mtime),
            }
            requests.post(f"{PHOTO_URL}/api/photos/result", json=result, timeout=10)
            done += 1
            if done % 50 == 0:
                print(f"进度: {done}/{len(all_files)}")
        except Exception as e:
            print(f"处理失败: {filepath} - {e}")

    print(f"完成: {done}/{len(all_files)}")
    return {"status": "done", "processed": done, "total": len(all_files)}'''

NEW2 = '''    pc_path = msg.get("pcPath", "")
    if not pc_path or not os.path.exists(pc_path):
        print(f"目录不存在: {pc_path}")
        return {"status": "failed", "error": "目录不存在"}
    IMG_EXTS = {".jpg",".jpeg",".png",".gif",".bmp",".tiff",".webp",".heic",".raw"}
    all_files = []
    for dirpath, dirnames, filenames in os.walk(pc_path):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and not d.startswith("@")]
        for filename in filenames:
            if os.path.splitext(filename)[1].lower() in IMG_EXTS:
                all_files.append(os.path.join(dirpath, filename))
    print(f"扫描完成: {len(all_files)} 张图片 in {pc_path}")
    # 批量写pending到NAS DB（用dispatch/dir2接口）
    # PC路径转成正斜杠给NAS识别
    try:
        r = requests.post(f"{PHOTO_URL}/api/pc/submit-scan",
            json={"pcPath": pc_path, "files": [
                {"path": f.replace(chr(92), "/"),
                 "name": os.path.basename(f),
                 "size": os.path.getsize(f),
                 "mtime": int(os.path.getmtime(f))}
                for f in all_files
            ]}, timeout=60)
        print(f"提交扫描结果: {r.status_code}")
    except Exception as e:
        print(f"提交失败: {e}")
    return {"status": "done", "actual": len(all_files), "dirStats": {pc_path: {"total": len(all_files), "done": 0}}}'''

if OLD2 not in content:
    print("NOT FOUND body")
else:
    content = content.replace(OLD2, NEW2, 1)
    print("body OK")

with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
    f.write(content)
