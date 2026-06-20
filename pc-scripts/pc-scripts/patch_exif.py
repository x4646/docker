# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()
old = "        # 上报结果给NAS"
new = """        # 写md5到EXIF（只处理JPEG）
        if os.path.splitext(smb_path)[1].lower() in (".jpg", ".jpeg"):
            try:
                import piexif
                exif_dict = piexif.load(smb_path)
                comment = ("ASCII\\x00\\x00\\x00NAS_MD5=" + md5).encode("utf-8")
                exif_dict["Exif"][piexif.ExifIFD.UserComment] = comment
                piexif.insert(piexif.dump(exif_dict), smb_path)
            except Exception as _e:
                pass

        # 上报结果给NAS"""
if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")

