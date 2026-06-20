# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''                key  = hashlib.md5(f"{filename}_{stat.st_size}_{int(stat.st_mtime)}".encode()).hexdigest()
                fwd = filepath.replace(chr(92), "/")
                files.append({
                    "path":  fwd,
                    "name":  filename,
                    "size":  stat.st_size,
                    "mtime": int(stat.st_mtime),
                    "key":   key,
                })
                all_file_paths.add(fwd)'''

new = '''                key  = hashlib.md5(f"{filename}_{stat.st_size}_{int(stat.st_mtime)}".encode()).hexdigest()
                fwd = filepath.replace(chr(92), "/")
                # 读EXIF md5（只处理JPEG）
                exif_md5 = None
                if os.path.splitext(filename)[1].lower() in (".jpg", ".jpeg"):
                    try:
                        import piexif as _px
                        _exif = _px.load(filepath)
                        _cmt = _exif.get("Exif", {}).get(_px.ExifIFD.UserComment, b"")
                        _txt = _cmt.decode("utf-8", errors="ignore")
                        if "NAS_MD5=" in _txt:
                            exif_md5 = _txt.split("NAS_MD5=")[1][:32]
                    except: pass
                files.append({
                    "path":     fwd,
                    "name":     filename,
                    "size":     stat.st_size,
                    "mtime":    int(stat.st_mtime),
                    "key":      key,
                    "exif_md5": exif_md5,
                })
                all_file_paths.add(fwd)'''

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
