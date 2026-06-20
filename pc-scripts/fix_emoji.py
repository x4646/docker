import os, re
SKIP = {"$RECYCLE.BIN", "System Volume Information"}
def scan(path, depth=0):
    if depth > 15: return
    try: entries = os.listdir(path)
    except: return
    for name in entries:
        if name in SKIP: continue
        full = os.path.join(path, name)
        new_name = re.sub(r"[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9\s\(\)\-\.@#&+_]", "", name).strip()
        new_name = re.sub(r"\s+", " ", new_name).strip()
        if new_name and new_name != name:
            new_full = os.path.join(path, new_name)
            os.rename(full, new_full)
            print(f"改名: {name} -> {new_name}")
            full = new_full
        if os.path.isdir(full):
            scan(full, depth+1)
scan("F:\\")
print("完成")
