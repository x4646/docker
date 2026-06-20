import os, re, requests

PHOTO_URL = "http://192.168.0.3:3050"
SKIP = {"$RECYCLE.BIN", "System Volume Information"}

def clean_name(name):
    cleaned = re.sub(r"[\[\]{}<>|*?\"/:^~`!#$%&=+;,\uff0f]", "", name)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned

def collect_dirs(path, results, depth=0):
    if depth > 15: return
    try:
        entries = os.listdir(path)
    except: return
    for name in entries:
        if name in SKIP: continue
        full = os.path.join(path, name)
        try:
            if os.path.isdir(full):
                collect_dirs(full, results, depth+1)
                new_name = clean_name(name)
                if new_name and new_name != name:
                    results.append((full, os.path.join(path, new_name)))
        except: continue

print("扫描目录...")
dir_renames = []
collect_dirs("F:\\", dir_renames)
print(f"需要改名: {len(dir_renames)} 个")
for old, new in dir_renames[:5]:
    print(f"  {os.path.basename(old)} -> {os.path.basename(new)}")

if not dir_renames:
    print("没有需要改名的目录")
    exit()

confirm = input("\n确认改名？(y/n): ")
if confirm.lower() != "y":
    exit()

done = fail = 0
db_updates = []
for old, new in dir_renames:
    try:
        os.rename(old, new)
        db_updates.append((old.replace("\\", "/"), new.replace("\\", "/")))
        done += 1
        print(f"[{done}] {os.path.basename(old)} -> {os.path.basename(new)}")
    except Exception as e:
        print(f"失败: {os.path.basename(old)} - {e}")
        fail += 1

print(f"\n改名完成: 成功{done} 失败{fail}")

# 同步DB
print("同步DB...")
db_done = 0
for old_path, new_path in db_updates:
    try:
        r = requests.post(f"{PHOTO_URL}/api/db/query",
            json={"sql": f"UPDATE photos SET path=REPLACE(path,'{old_path}/','{new_path}/') WHERE path LIKE '{old_path}/%'"},
            timeout=10)
        changes = r.json().get("changes", 0)
        if changes > 0:
            db_done += changes
            print(f"+{changes}: {os.path.basename(new_path)}")
    except Exception as e:
        print(f"DB失败: {e}")

print(f"DB更新: {db_done} 条")
