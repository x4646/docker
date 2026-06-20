# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

old = """    try:
        r = requests.post(f"{PHOTO_URL}/api/pc/submit-scan",
            json={"pcPath": pc_path, "files": [
                {"path": f.replace(chr(92), "/"),
                 "name": os.path.basename(f),
                 "size": os.path.getsize(f),
                 "mtime": int(os.path.getmtime(f))}
                for f in all_files
            ]}, timeout=60)
        print(f"提交扫描结果: {r.status_code}")
    except Exception as e:
        print(f"提交失败: {e}")"""

new = """    try:
        batch_size = 500
        total_sent = 0
        file_list = [{"path": f.replace(chr(92), "/"), "name": os.path.basename(f),
                      "size": os.path.getsize(f), "mtime": int(os.path.getmtime(f))}
                     for f in all_files]
        for i in range(0, len(file_list), batch_size):
            batch = file_list[i:i+batch_size]
            r = requests.post(f"{PHOTO_URL}/api/pc/submit-scan",
                json={"pcPath": pc_path, "files": batch}, timeout=30)
            total_sent += r.json().get("sent", 0)
            print(f"提交进度: {i+len(batch)}/{len(file_list)} sent={total_sent}")
    except Exception as e:
        print(f"提交失败: {e}")"""

if old not in content:
    print("NOT FOUND")
else:
    content = content.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK")
