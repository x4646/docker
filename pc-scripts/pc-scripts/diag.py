import requests
from nas_client import PHOTO_URL
from collections import Counter
import os

r = requests.post(f"{PHOTO_URL}/api/db/query",
    json={"sql": "SELECT path FROM photos WHERE status='pending' AND md5 IS NULL AND (path LIKE 'D:%' OR path LIKE 'E:%' OR path LIKE 'F:%')"},
    timeout=60)
rows = r.json().get("rows", [])
print("总数:", len(rows))

exts = Counter(os.path.splitext(row["path"])[1].lower() for row in rows)
print("格式分布:")
for ext, cnt in exts.most_common():
    print(f"  {ext}: {cnt}")

# 抽查文件是否还存在
exist = gone = 0
for row in rows[:200]:
    local = row["path"].replace("/", "\\")
    if os.path.exists(local): exist += 1
    else: gone += 1
print(f"\n抽查前200条: 文件还在{exist} 已不存在{gone}")
