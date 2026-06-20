# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

# 路由：在 /browse 处理后加 /count-images
old = """        if path == '/browse':"""
new = """        if path == '/count-images':
            cnt_path = params.get('path', [''])[0] if 'params' in dir() else parse_qs(parsed.query).get('path',[''])[0]
            import os as _os
            IMG = ('.jpg','.jpeg','.png','.gif','.webp','.bmp','.tiff','.tif','.heic')
            n = 0
            try:
                for dp, dn, fn in _os.walk(cnt_path):
                    for name in fn:
                        if name.lower().endswith(IMG):
                            n += 1
                            if n > 200000: break
            except: pass
            self._json({'realCount': n})
            return
        if path == '/browse':"""

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
