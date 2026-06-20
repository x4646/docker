# -*- coding: utf-8 -*-
"""
md5_server.py - 监听NAS的打MD5请求
启动: python md5_server.py
"""
import os, sys, hashlib, piexif, requests, threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from nas_client import PHOTO_URL

PORT = 8081

def load_md5_index():
    r = requests.post(f"{PHOTO_URL}/api/db/query",
        json={"sql": "SELECT id,path,md5 FROM photos WHERE md5 IS NOT NULL"},
        timeout=60)
    rows = r.json().get("rows", [])
    return {row["md5"]: {"id": row["id"], "path": row["path"]} for row in rows}

def sync_dir(pc_path):
    pc_path = pc_path.replace("/", "\\")
    if not os.path.exists(pc_path):
        print(f"目录不存在: {pc_path}")
        return
    print(f"开始打MD5: {pc_path}")
    md5_index = load_md5_index()
    print(f"已加载{len(md5_index)}条md5索引")

    IMG_EXTS = {".jpg", ".jpeg"}
    batch_ins = []
    batch_upd = []
    BATCH = 200
    done = skip = fail = total = 0

    def flush():
        if batch_ins:
            vals = ",".join([f"('{r[0]}','{r[1]}',{r[2]},{r[3]},'{r[4]}','{r[5]}','pending',1)" for r in batch_ins])
            try:
                requests.post(f"{PHOTO_URL}/api/db/query",
                    json={"sql": f"INSERT OR IGNORE INTO photos (path,dir,size,mtime,file_key,md5,status,exif_written) VALUES {vals}"},
                    timeout=30)
            except Exception as e: print(f"insert失败: {e}")
            batch_ins.clear()
        if batch_upd:
            for r in batch_upd:
                try:
                    requests.post(f"{PHOTO_URL}/api/db/query",
                        json={"sql": f"UPDATE photos SET path='{r[0]}',dir='{r[1]}',exif_written=1 WHERE id={r[2]}"},
                        timeout=10)
                except: pass
            batch_upd.clear()

    for dirpath, dirnames, filenames in os.walk(pc_path):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in {"$RECYCLE.BIN"}]
        for name in filenames:
            if os.path.splitext(name)[1].lower() not in IMG_EXTS:
                continue
            total += 1
            filepath = os.path.join(dirpath, name)
            nas_path = filepath.replace("\\", "/")

            # 读EXIF md5
            exif_md5 = None
            try:
                exif = piexif.load(filepath)
                cmt = exif.get("Exif", {}).get(piexif.ExifIFD.UserComment, b"")
                txt = cmt.decode("utf-8", errors="ignore")
                if "NAS_MD5=" in txt:
                    exif_md5 = txt.split("NAS_MD5=")[1][:32]
            except: pass

            if not exif_md5:
                # 算md5写EXIF
                try:
                    with open(filepath, "rb") as f:
                        exif_md5 = hashlib.md5(f.read()).hexdigest()
                    exif = piexif.load(filepath)
                    comment = ("ASCII\x00\x00\x00NAS_MD5=" + exif_md5).encode("utf-8")
                    exif["Exif"][piexif.ExifIFD.UserComment] = comment
                    piexif.insert(piexif.dump(exif), filepath)
                except Exception as e:
                    fail += 1
                    continue

            # 对比DB
            rec = md5_index.get(exif_md5)
            if rec:
                if rec["path"] != nas_path:
                    dir_path = nas_path.rsplit("/", 1)[0]
                    batch_upd.append((nas_path, dir_path, rec["id"]))
                else:
                    skip += 1
            else:
                try:
                    stat = os.stat(filepath)
                    key = hashlib.md5(f"{name}_{stat.st_size}_{int(stat.st_mtime)}".encode()).hexdigest()
                    dir_path = nas_path.rsplit("/", 1)[0]
                    batch_ins.append((nas_path, dir_path, stat.st_size, int(stat.st_mtime), key, exif_md5))
                    done += 1
                except:
                    fail += 1

            if len(batch_ins) >= BATCH or len(batch_upd) >= BATCH:
                flush()

            if total % 500 == 0:
                print(f"进度: {total}张 新增{done} 跳过{skip} 失败{fail}")

    flush()
    print(f"完成: total={total} done={done} skip={skip} fail={fail}")

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass
    def do_POST(self):
        import json
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        if self.path == "/write-md5":
            pc_path = body.get("pcPath", "")
            threading.Thread(target=sync_dir, args=(pc_path,), daemon=True).start()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    print(f"MD5 Server 启动，监听端口 {PORT}")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
