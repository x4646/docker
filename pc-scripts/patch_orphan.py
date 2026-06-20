# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''    # 发完成信号+汇总stats+清理孤立记录
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

new = '''    # 发完成信号+汇总stats
    if task_id:
        try:
            requests.post(f"{PHOTO_URL}/api/pc/scan-progress", json={
                "taskId":   task_id,
                "stats":    dir_stats,
                "done":     True,
            }, timeout=30)
        except Exception as e:
            print(f"发完成信号失败: {e}")

    # 清理孤立记录：分批发所有路径给NAS
    root_fwd = pc_path.replace(chr(92), "/")
    batch_size = 500
    paths_list = list(all_file_paths)
    print(f"清理孤立记录: 共{len(paths_list)}个文件路径发给NAS")
    for i in range(0, len(paths_list), batch_size):
        batch = paths_list[i:i+batch_size]
        try:
            requests.post(f"{PHOTO_URL}/api/pc/cleanup-orphans", json={
                "rootPath": root_fwd,
                "paths":    batch,
                "final":    (i + batch_size >= len(paths_list)),
            }, timeout=30)
        except Exception as e:
            print(f"清理孤立失败: {e}")
            break'''

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK patch1")
