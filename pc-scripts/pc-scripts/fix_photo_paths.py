import re, requests

PHOTO_URL = "http://192.168.0.3:3050"

def clean_name(name):
    import os
    base, ext = os.path.splitext(name)
    cleaned = re.sub(r"[\[\]{}<>|*?\"/:^~`!#$%&=+;,\uff0f]", "", base)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return (cleaned + ext) if cleaned else ""

def clean_path(path):
    parts = path.split("/")
    new_parts = []
    for i, part in enumerate(parts):
        if i <= 1:  # 保留空字符串和盘符 F:
            new_parts.append(part)
            continue
        import os
        new_name = clean_name(part)
        new_parts.append(new_name if new_name else part)
    return "/".join(new_parts)

print("拉取F盘done记录...")
page = 1
updated = skipped = 0
while True:
    r = requests.post(f"{PHOTO_URL}/api/db/query",
        json={"sql": f"SELECT id,path FROM photos WHERE path LIKE 'F:%' AND status='done' LIMIT 500 OFFSET {(page-1)*500}"},
        timeout=30)
    rows = r.json().get("rows", [])
    if not rows: break
    for row in rows:
        old = row["path"]
        new = clean_path(old)
        if new != old and new:
            safe_new = new.replace("'", "''")
            try:
                requests.post(f"{PHOTO_URL}/api/db/query",
                    json={"sql": f"UPDATE photos SET path='{safe_new}' WHERE id={row['id']}"},
                    timeout=10)
                updated += 1
                if updated % 500 == 0:
                    print(f"进度: {updated}")
            except Exception as e:
                print(f"失败: {e}")
        else:
            skipped += 1
    page += 1
    if len(rows) < 500: break

print(f"完成: 更新{updated} 跳过{skipped}")
