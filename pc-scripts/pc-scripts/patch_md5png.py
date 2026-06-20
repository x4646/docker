# -*- coding: utf-8 -*-
import io
FN = "md5_worker.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''def sync_dir(pc_path):
    IMG_EXTS = {".jpg", ".jpeg"}'''

new = '''def read_exif_md5(filepath):
    """读图片里的md5（JPEG用EXIF，PNG用tEXt块）"""
    ext = os.path.splitext(filepath)[1].lower()
    try:
        if ext in (".jpg", ".jpeg"):
            import piexif
            exif = piexif.load(filepath)
            cmt = exif.get("Exif", {}).get(piexif.ExifIFD.UserComment, b"")
            txt = cmt.decode("utf-8", errors="ignore")
            if "NAS_MD5=" in txt:
                return txt.split("NAS_MD5=")[1][:32]
        elif ext == ".png":
            from PIL import Image
            img = Image.open(filepath)
            return img.info.get("NAS_MD5")
    except: pass
    return None

def write_exif_md5(filepath, md5):
    """写md5到图片（JPEG用EXIF，PNG用tEXt块）"""
    ext = os.path.splitext(filepath)[1].lower()
    try:
        if ext in (".jpg", ".jpeg"):
            import piexif
            exif = piexif.load(filepath)
            comment = ("ASCII\x00\x00\x00NAS_MD5=" + md5).encode("utf-8")
            exif["Exif"][piexif.ExifIFD.UserComment] = comment
            piexif.insert(piexif.dump(exif), filepath)
            return True
        elif ext == ".png":
            from PIL import Image
            from PIL.PngImagePlugin import PngInfo
            img = Image.open(filepath)
            metadata = PngInfo()
            # 保留原有text块
            for k, v in img.info.items():
                if isinstance(v, str):
                    metadata.add_text(k, v)
            metadata.add_text("NAS_MD5", md5)
            img.save(filepath, pnginfo=metadata)
            return True
    except: pass
    return False

def sync_dir(pc_path):
    IMG_EXTS = {".jpg", ".jpeg", ".png"}'''

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    # 同时替换内部的读写EXIF逻辑
    c = c.replace(
        '''            exif_md5 = None
            try:
                exif = piexif.load(filepath)
                cmt = exif.get("Exif", {}).get(piexif.ExifIFD.UserComment, b"")
                txt = cmt.decode("utf-8", errors="ignore")
                if "NAS_MD5=" in txt:
                    exif_md5 = txt.split("NAS_MD5=")[1][:32]
            except: pass

            if not exif_md5:
                try:
                    with open(filepath, "rb") as f:
                        exif_md5 = hashlib.md5(f.read()).hexdigest()
                    exif = piexif.load(filepath)
                    comment = ("ASCII\x00\x00\x00NAS_MD5=" + exif_md5).encode("utf-8")
                    exif["Exif"][piexif.ExifIFD.UserComment] = comment
                    piexif.insert(piexif.dump(exif), filepath)
                except Exception as e:
                    fail += 1
                    continue''',
        '''            exif_md5 = read_exif_md5(filepath)

            if not exif_md5:
                try:
                    with open(filepath, "rb") as f:
                        exif_md5 = hashlib.md5(f.read()).hexdigest()
                    write_exif_md5(filepath, exif_md5)
                except Exception as e:
                    fail += 1
                    continue''',
        1
    )
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
