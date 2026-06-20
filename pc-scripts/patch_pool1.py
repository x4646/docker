# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''NAS_WS       = "ws://192.168.0.3:3030"
NAS_SYNC_URL = "http://192.168.0.3:3040"
PHOTO_URL    = "http://192.168.0.3:3050"'''

new = '''NAS_WS       = "ws://192.168.0.3:3030"
NAS_SYNC_URL = "http://192.168.0.3:3040"
PHOTO_URL    = "http://192.168.0.3:3050"

# ── Worker进程池（最多5个并发） ──────────────────────
MAX_WORKERS = 5
worker_pool = {}      # path -> {"proc": Popen, "status": "running"}
worker_queue = []     # 排队的path列表
worker_lock = threading.Lock()
_worker_seq = [0]

def _schedule_workers():
    """调度：保证运行中的worker不超过MAX_WORKERS，空位从队列补"""
    with worker_lock:
        # 清理已结束的
        for p in list(worker_pool.keys()):
            proc = worker_pool[p]["proc"]
            if proc.poll() is not None:
                del worker_pool[p]
        # 补空位
        while len(worker_pool) < MAX_WORKERS and worker_queue:
            path = worker_queue.pop(0)
            if path in worker_pool:
                continue
            _worker_seq[0] += 1
            wid = _worker_seq[0]
            script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker.py")
            fwd = path.replace("\\\\", "/")
            try:
                proc = subprocess.Popen(
                    ["python", script, str(wid), fwd],
                    creationflags=subprocess.CREATE_NEW_CONSOLE
                )
                worker_pool[path] = {"proc": proc, "status": "running"}
                print(f"[worker-pool] 启动 worker{wid} 处理 {fwd}")
            except Exception as e:
                print(f"[worker-pool] 启动失败 {fwd}: {e}")

def add_process_dir(path):
    """加入处理队列"""
    with worker_lock:
        if path in worker_pool:
            return "running"
        if path in worker_queue:
            return "queued"
        worker_queue.append(path)
    _schedule_workers()
    with worker_lock:
        return "running" if path in worker_pool else "queued"

def get_worker_status():
    """返回当前池+队列状态"""
    _schedule_workers()
    with worker_lock:
        return {
            "running": list(worker_pool.keys()),
            "queued": list(worker_queue),
            "max": MAX_WORKERS,
        }

def _worker_pool_monitor():
    """后台线程：定期调度，让队列里的在空位时自动启动"""
    while True:
        time.sleep(3)
        try: _schedule_workers()
        except: pass'''

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
