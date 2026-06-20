import os, re, requests

PHOTO_URL = "http://192.168.0.3:3050"

def clean_name(name):
    base, ext = os.path.splitext(name)
    # 清除特殊字符，包括全角斜杠
    cleaned = re.sub(r"[\[\]{}<>|*?\"/:^~`!#$%&=+;,\uff0f]", "", base)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return (cleaned + ext) if cleaned else ""

def clean_path(path):
    parts = path.replace("\\", "/").split("/")
    new_parts = []
    for i, part in enumerate(parts):
        if i == 0 or (i == 1 and len(part) <= 3 and ":" in part):
            new_parts.append(part)
            continue
        new_name = clean_name(part)
        new_parts.append(new_name if new_name else part)
    return "/".join(new_parts)

# 分页拉F盘所有记录
print("拉取DB记录...")
page = 1
updated = skipped = 0
while True:
    r = requests.post(f"{PHOTO_URL}/api/db/query",
        json={"sql": f"SELECT id,path FROM photos WHERE path LIKE 'F:%' LIMIT 500 OFFSET {(page-1)*500}"},
        timeout=30)
    rows = r.json().get("rows", [])
    if not rows: break
    for row in rows:
        old = row["path"]
        new = clean_path(old)
        if new != old:
            try:
                requests.post(f"{PHOTO_URL}/api/db/query",
                    json={"sql": f"UPDATE photos SET path='{new.replace(chr(39), chr(39)+chr(39))}' WHERE id={row['id']}"},
                    timeout=10)
                updated += 1
                if updated % 200 == 0:
                    print(f"进度: {updated}")
            except Exception as e:
                print(f"失败: {e}")
        else:
            skipped += 1
    page += 1
    if len(rows) < 500: break

print(f"完成: 更新{updated} 跳过{skipped}")
