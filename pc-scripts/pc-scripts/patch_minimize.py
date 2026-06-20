# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = '''            try:
                proc = subprocess.Popen(
                    ["python", script, str(wid), fwd],
                    creationflags=subprocess.CREATE_NEW_CONSOLE
                )
                worker_pool[path] = {"proc": proc, "status": "running"}
                print(f"[worker-pool] 启动 worker{wid} 处理 {fwd}")'''

new = '''            try:
                si = subprocess.STARTUPINFO()
                si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                si.wShowWindow = 7  # SW_SHOWMINNOACTIVE 最小化且不抢焦点
                proc = subprocess.Popen(
                    ["python", script, str(wid), fwd],
                    creationflags=subprocess.CREATE_NEW_CONSOLE,
                    startupinfo=si
                )
                worker_pool[path] = {"proc": proc, "status": "running"}
                print(f"[worker-pool] 启动 worker{wid} 处理 {fwd}")'''

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
