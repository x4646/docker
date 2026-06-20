# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''    # 清理孤立记录：把扫描到的所有文件路径发给NAS，删掉DB里不存在的
    all_scanned_paths = []
    for dirpath, dirnames, filenames in os.walk(pc_path):
        dirnames[:] = sorted([d for d in dirnames if not d.startswith(".") and not d.startswith("@")])
        for filename in filenames:
            if os.path.splitext(filename)[1].lower() in IMG_EXTS:
                all_scanned_paths.append(os.path.join(dirpath, filename).replace(chr(92), "/"))

    # 发完成信号+汇总stats
    if task_id:
        try:
            requests.post(f"{PHOTO_URL}/api/pc/scan-progress", json={
                "taskId":        task_id,
                "stats":         dir_stats,
                "done":          True,
                "scannedPaths":  all_scanned_paths,
                "rootPath":      pc_path.replace(chr(92), "/"),
            }, timeout=60)
        except Exception as e:
            print(f"发完成信号失败: {e}")'''

new = '''    # 发完成信号+汇总stats+清理孤立记录
    if task_id:
        try:
            requests.post(f"{PHOTO_URL}/api/pc/scan-progress", json={
                "taskId":   task_id,
                "stats":    dir_stats,
                "done":     True,
                "rootPath": pc_path.replace(chr(92), "/"),
            }, timeout=30)
        except Exception as e:
            print(f"发完成信号失败: {e}")'''

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
