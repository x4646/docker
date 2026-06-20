# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = """        elif path == '/write-md5':
            import threading, md5_worker
            md5_worker.init(PHOTO_URL)
            threading.Thread(target=md5_worker.sync_dir, args=(body.get('pcPath',''),), daemon=True).start()
            self._json({'ok': True})"""

new = """        elif path == '/write-md5':
            import subprocess
            pc_path = body.get('pcPath', '').replace('/', '\\\\')
            script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sync_by_exif.py')
            subprocess.Popen(
                f'start cmd /k python "{script}" "{pc_path}"',
                shell=True
            )
            self._json({'ok': True})"""

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
