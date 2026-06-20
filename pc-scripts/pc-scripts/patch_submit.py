# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

old = "    # 写pc_dir_stats到NAS\n    try:\n        requests.post(f\"{PHOTO_URL}/api/pc/update-dir-stats\",\n            json={\"dirStats\": dir_stats}, timeout=30)\n    except Exception as e:\n        print(f\"写dir_stats失败: {e}\")"

new = """    # 写pc_dir_stats到NAS
    try:
        requests.post(f"{PHOTO_URL}/api/pc/update-dir-stats",
            json={"dirStats": dir_stats}, timeout=30)
    except Exception as e:
        print(f"写dir_stats失败: {e}")

    # 写pending到NAS DB（分批提交）
    try:
        file_list = [{"path": f.replace(chr(92), "/"), "name": os.path.basename(f),
                      "size": os.path.getsize(f), "mtime": int(os.path.getmtime(f))}
                     for f in all_files]
        batch_size = 500
        total_sent = 0
        for i in range(0, len(file_list), batch_size):
            batch = file_list[i:i+batch_size]
            r = requests.post(f"{PHOTO_URL}/api/pc/submit-scan",
                json={"pcPath": pc_path, "files": batch}, timeout=30)
            total_sent += r.json().get("sent", 0)
        print(f"写入pending: {total_sent} 条")
    except Exception as e:
        print(f"写pending失败: {e}")"""

if old not in content:
    print("NOT FOUND")
else:
    content = content.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK")
