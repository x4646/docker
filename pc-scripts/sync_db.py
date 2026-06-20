import os, re, requests

PHOTO_URL = "http://192.168.0.3:3050"

def clean_name(name):
    base, ext = os.path.splitext(name)
    cleaned = re.sub(r"[\[\]{}<>|*?\"/:^~`!#$%&=+;,]", "", base)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned + ext if cleaned else ""

# 从DB拿所有F盘记录
print("从DB拉取F盘记录...")
page = 1
all_photos = []
while True:
    r = requests.get(f"{PHOTO_URL}/api/photos?dirPath=F:/&limit=200&page={page}", timeout=30)
    data = r.json()
    photos = data.get("photos", [])
    if not photos: break
    all_photos.extend(photos)
    page += 1
    if len(photos) < 200: break
print(f"共 {len(all_photos)} 条记录")

# 找出路径里有特殊字符的记录
updated = 0
for p in all_photos:
    old_path = p["path"]
    # 重建正确路径
    parts = old_path.replace("\\", "/").split("/")
    new_parts = []
    for i, part in enumerate(parts):
        if i == 0:  # 盘符 F:
            new_parts.append(part)
        else:
            base, ext = os.path.splitext(part)
            cleaned = re.sub(r"[\[\]{}<>|*?\"/:^~`!#$%&=+;,]", "", base)
            cleaned = re.sub(r"\s+", " ", cleaned).strip()
            new_parts.append(cleaned + ext if cleaned else part)
    new_path = "/".join(new_parts)
    if new_path != old_path:
        try:
            r = requests.post(f"{PHOTO_URL}/api/db/query",
                json={"sql": f"UPDATE photos SET path=? WHERE id=?",
                      "params": [new_path, p["id"]]},
                timeout=10)
            updated += 1
            if updated % 100 == 0:
                print(f"进度: {updated}")
        except Exception as e:
            print(f"失败: {e}")

print(f"同步完成: {updated} 条")
