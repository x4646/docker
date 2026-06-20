import os, re

SKIP = {"$RECYCLE.BIN", "System Volume Information"}

def is_clean(name):
    cleaned = re.sub(r"[\uff00-\uffef\u2000-\u206f\u2e00-\u2e7f\u3000-\u303f]", "", name)
    cleaned = re.sub(r"[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9\s\(\)\-\.@#&+_]", "", cleaned)
    return cleaned == name

found = []
def scan(path, depth=0):
    if depth > 15: return
    try:
        entries = os.listdir(path)
    except: return
    for name in entries:
        if name in SKIP: continue
        if not is_clean(name):
            bad = [c for c in name if not re.match(r"[\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9\s\(\)\-\.@#&+_\uff00-\uffef\u2000-\u206f\u2e00-\u2e7f\u3000-\u303f]", c)]
            if bad:
                found.append((os.path.join(path, name), bad))
        full = os.path.join(path, name)
        if os.path.isdir(full):
            scan(full, depth+1)

scan("F:\\")
if found:
    print(f"发现 {len(found)} 个含特殊字符:")
    for path, chars in found[:20]:
        print(f"  {os.path.basename(path)} -> {chars}")
else:
    print("F盘干净了")
