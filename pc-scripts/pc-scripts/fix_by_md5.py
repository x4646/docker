import os, hashlib, requests

PHOTO_URL = "http://192.168.0.3:3050"
ROOT = "F:\\"
IMG_EXTS = {".jpg",".jpeg",".png",".gif",".bmp",".tiff",".webp",".heic",".raw"}

def nas_to_smb(path):
    return "\\\\" + "whfnas" + "\\" + path.replace("/share/", "").replace("/", "\\")

def get_smb_host():
    try:
        return requests.get(f"{PHOTO_URL}/api/config/system", timeout=5).json().get("nas_smb_host","whfnas")
    except: return "whfnas"

smb_host = get_smb_host()
print(f"SMB: {smb_host}")

# 从NAS DB拿所有F盘done记录的md5
print("拉取done记录md5...")
r = requests.post(f"{PHOTO_URL}/api/db/query",
    json={"sql": "SELECT id,path,md5 FROM photos WHERE path LIKE 'F:%' AND status='done' AND md5 IS NOT NULL"},
    timeout=60)
done_rows = r.json().get("rows", [])
md5_to_done = {row["md5"]: row for row in done_rows}
print(f"done记录: {len(md5_to_done)} 条")

# 拉取pending记录
r = requests.post(f"{PHOTO_URL}/api/db/query",
    json={"sql": "SELECT id,path,file_key FROM photos WHERE path LIKE 'F:%' AND status='pending'"},
    timeout=60)
pending_rows = r.json().get("rows", [])
print(f"pending记录: {len(pending_rows)} 条")

# 对每个pending，算文件md5，看能不能匹配done记录
updated = deleted = skip = 0
for row in pending_rows:
    # 找实际文件
    pc_path = row["path"].replace("/", "\\")
    smb_path = f"\\\\{smb_host}\\" + row["path"].replace("F:/", "F$/").replace("/","\\")
    # 直接用PC路径
    local = row["path"].replace("F:/", "F:\\").replace("/","\\")
    if not os.path.exists(local):
        skip += 1
        continue
    try:
        with open(local, "rb") as f:
            data = f.read()
        md5 = hashlib.md5(data).hexdigest()
    except:
        skip += 1
        continue

    if md5 in md5_to_done:
        done = md5_to_done[md5]
        new_path = row["path"]
        # 更新done记录的path为新路径，删掉pending
        try:
            requests.post(f"{PHOTO_URL}/api/db/query",
                json={"sql": f"UPDATE photos SET path='{new_path.replace(chr(39),chr(39)*2)}' WHERE id={done['id']}"},
                timeout=10)
            requests.post(f"{PHOTO_URL}/api/db/query",
                json={"sql": f"DELETE FROM photos WHERE id={row['id']}"},
                timeout=10)
            updated += 1
            if updated % 100 == 0:
                print(f"进度: 更新{updated} 删除{deleted} 跳过{skip}")
        except Exception as e:
            print(f"失败: {e}")
    else:
        skip += 1

print(f"完成: 更新{updated} 跳过{skip}")
