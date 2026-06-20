import os, re, requests

PHOTO_URL = "http://192.168.0.3:3050"
SKIP = {"$RECYCLE.BIN", "System Volume Information"}

def clean_name(name):
    # 分离扩展名
    base, ext = os.path.splitext(name)
    cleaned = re.sub(r"[\[\]{}<>|*?\"/:^~`!#$%&=+;,]", "", base)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned + ext if cleaned else ""

def collect(path, file_renames, depth=0):
    if depth > 15: return
    try:
        entries = os.listdir(path)
    except: return
    for name in entries:
        if name in SKIP: continue
        full = os.path.join(path, name)
        try:
            is_dir = os.path.isdir(full)
        except: continue
        if not is_dir:
            new_name = clean_name(name)
            if new_name and new_name != name:
                file_renames.append((full, os.path.join(path, new_name)))
        if is_dir:
            collect(full, file_renames, depth+1)

# 第1步：收集文件改名
print("扫描文件...")
file_renames = []
collect("F:\\", file_renames)
print(f"需要改名的文件: {len(file_renames)} 个")
for old, new in file_renames[:10]:
    print(f"  {os.path.basename(old)} -> {os.path.basename(new)}")
if len(file_renames) > 10:
    print(f"  ...还有 {len(file_renames)-10} 个")

confirm = input("\n确认改名？(y/n): ")
if confirm.lower() != "y":
    print("取消")
    exit()

# 第2步：改文件名
done = fail = 0
db_updates = []
for old, new in file_renames:
    try:
        os.rename(old, new)
        db_updates.append((old.replace("\\", "/"), new.replace("\\", "/")))
        done += 1
        if done % 100 == 0:
            print(f"进度: {done}/{len(file_renames)}")
    except Exception as e:
        print(f"失败: {os.path.basename(old)} - {e}")
        fail += 1

print(f"改名完成: 成功{done} 失败{fail}")

# 第3步：同步DB
print("同步DB...")
db_done = 0
for old_path, new_path in db_updates:
    try:
        r = requests.post(f"{PHOTO_URL}/api/db/query",
            json={"sql": f"UPDATE photos SET path='{new_path}' WHERE path='{old_path}'"},
            timeout=10)
        if r.json().get("changes", 0) > 0:
            db_done += 1
    except: pass
print(f"DB更新: {db_done} 条")
