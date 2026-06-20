# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

# 1. 加 kill_all_workers 函数（放在 get_worker_status 后面）
old1 = '''def _worker_pool_monitor():'''
new1 = '''def kill_all_workers():
    """杀掉所有worker进程+清空队列"""
    with worker_lock:
        killed = 0
        for path in list(worker_pool.keys()):
            try:
                worker_pool[path]["proc"].kill()
                killed += 1
            except: pass
        worker_pool.clear()
        worker_queue.clear()
    print(f"[worker-pool] 已杀死 {killed} 个worker，清空队列")
    return killed

def _worker_pool_monitor():'''

if old1 not in c:
    print("NOT FOUND func")
else:
    c = c.replace(old1, new1, 1)

# 2. 加路由
old2 = """        elif path == '/worker-status':
            self._json(get_worker_status())"""
new2 = """        elif path == '/worker-status':
            self._json(get_worker_status())
        elif path == '/kill-workers':
            n = kill_all_workers()
            self._json({'ok': True, 'killed': n})"""

if old2 not in c:
    print("NOT FOUND route")
else:
    c = c.replace(old2, new2, 1)

with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
    f.write(c)
print("OK")
