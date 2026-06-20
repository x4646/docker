# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()
old = '''                # 读EXIF md5（只处理JPEG）
                exif_md5 = None
                if os.path.splitext(filename)[1].lower() in (".jpg", ".jpeg"):
                    try:
                        import piexif as _px
                        _exif = _px.load(filepath)
                        _cmt = _exif.get("Exif", {}).get(_px.ExifIFD.UserComment, b"")
                        _txt = _cmt.decode("utf-8", errors="ignore")
                        if "NAS_MD5=" in _txt:
                            exif_md5 = _txt.split("NAS_MD5=")[1][:32]
                    except: pass'''
new = '''                # 读EXIF md5（JPEG用EXIF，PNG用tEXt块）
                exif_md5 = None
                ext = os.path.splitext(filename)[1].lower()
                if ext in (".jpg", ".jpeg"):
                    try:
                        import piexif as _px
                        _exif = _px.load(filepath)
                        _cmt = _exif.get("Exif", {}).get(_px.ExifIFD.UserComment, b"")
                        _txt = _cmt.decode("utf-8", errors="ignore")
                        if "NAS_MD5=" in _txt:
                            exif_md5 = _txt.split("NAS_MD5=")[1][:32]
                    except: pass
                elif ext == ".png":
                    try:
                        from PIL import Image as _Img
                        _img = _Img.open(filepath)
                        exif_md5 = _img.info.get("NAS_MD5")
                    except: pass'''
if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
