import os, re

SKIP = {"$RECYCLE.BIN", "System Volume Information"}

def clean_name(name):
    cleaned = re.sub(r"[\[\]{}<>|*?\"/:^~`!#$%&=+;,]", "", name)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned

def scan(path, results, depth=0):
    if depth > 10: return
    try:
        entries = os.listdir(path)
    except Exception as e:
        print(f"跳过: {path} - {e}")
        return
    for name in entries:
        if name in SKIP:
            continue
        full = os.path.join(path, name)
        new_name = clean_name(name)
        if new_name != name and new_name:
            results.append((full, os.path.join(path, new_name)))
            print(f"{name}\n  -> {new_name}")
        try:
            if os.path.isdir(full):
                scan(full, results, depth+1)
        except: pass

root = "F:\\"
results = []
scan(root, results)
print(f"\n共 {len(results)} 个需要改名")
