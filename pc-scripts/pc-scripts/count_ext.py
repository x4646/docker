import os
roots = ["D:/"]
from collections import Counter
cnt = Counter()
for root in roots:
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if not d.startswith(".") and d not in {"$RECYCLE.BIN","损坏文件"}]
        for n in fns:
            e = os.path.splitext(n)[1].lower()
            if e in {".webp",".gif",".bmp",".tiff",".heic",".heif"}:
                cnt[e]+=1
print(dict(cnt))
