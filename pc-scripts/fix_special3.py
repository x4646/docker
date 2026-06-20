import os, re, requests

PHOTO_URL = "http://192.168.0.3:3050"
SKIP = {"$RECYCLE.BIN", "System Volume Information"}

def clean_name(name):
    base, ext = os.path.splitext(name)
    # 只保留：中文、英文、数字、常用符号
    cleaned = re.sub(r"[^\u4e00-\u9fff\w\s\(\)\-\.@#&+]", "", base)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return (cleaned + ext) if cleaned else ""

def scan(path, files, dirs, depth=0):
    if depth > 15: return
    try:
        entries = os.listdir(path)
    except: return
    for name in entries:
        if name in SKIP: continue
        full = os.path.join(path, name)
        new_name = clean_name(name)
        if os.path.isdir(full):
            scan(full, files, dirs, depth+1)
            if new_name and new_name != name:
                dirs.append((full, os.path.join(path, new_name)))
        else:
            if new_name and new_name != name:
                files.append((full, os.path.join(path, new_name)))

file_renames = []
dir_renames = []
print("扫描中...")
scan("F:\\", file_renames, dir_renames)
print(f"文件: {len(file_renames)} 目录: {len(dir_renames)}")
for old, new in (file_renames + dir_renames)[:10]:
    print(f"  {os.path.basename(old)} -> {os.path.basename(new)}")

confirm = input("\n确认改名？(y/n): ")
if confirm.lower() != "y": exit()

done = fail = 0
for old, new in file_renames:
    try:
        os.rename(old, new)
        done += 1
        if done % 50 == 0: print(f"文件进度: {done}/{len(file_renames)}")
    except Exception as e:
        print(f"失败: {os.path.basename(old)} - {e}")
        fail += 1

for old, new in dir_renames:
    try:
        os.rename(old, new)
        done += 1
        print(f"[目录] {os.path.basename(old)} -> {os.path.basename(new)}")
    except Exception as e:
        print(f"失败: {os.path.basename(old)} - {e}")
        fail += 1

print(f"\n完成: 成功{done} 失败{fail}")
