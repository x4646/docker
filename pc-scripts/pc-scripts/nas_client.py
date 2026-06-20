import asyncio
import requests
import websockets
import json
import os
import time
import shutil
import hashlib
import subprocess
import platform
import psutil
import ctypes
import threading
from datetime import datetime

NAS_WS       = "ws://192.168.0.3:3030"
NAS_SYNC_URL = "http://192.168.0.3:3040"
PHOTO_URL    = "http://192.168.0.3:3050"

# ── Worker进程池(最个并发） ──────────────────────
MAX_WORKERS = 5
worker_pool = {}      # path -> {"proc": Popen, "status": "running"}
worker_queue = []     # 排队的path列表
worker_lock = threading.Lock()
_worker_seq = [0]

def _schedule_workers():
    """调度：保证运行中的worker不超过MAX_WORKERS,空位从队列"""
    with worker_lock:
        # 清理已结束的
        for p in list(worker_pool.keys()):
            proc = worker_pool[p]["proc"]
            if proc.poll() is not None:
                del worker_pool[p]
        # 补空
        while len(worker_pool) < MAX_WORKERS and worker_queue:
            path = worker_queue.pop(0)
            if path in worker_pool:
                continue
            _worker_seq[0] += 1
            wid = _worker_seq[0]
            script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker.py")
            fwd = path.replace("\\", "/")
            try:
                si = subprocess.STARTUPINFO()
                si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                si.wShowWindow = 7  # SW_SHOWMINNOACTIVE 最小化且不抢焦
                proc = subprocess.Popen(
                    ["python", script, str(wid), fwd],
                    creationflags=subprocess.CREATE_NEW_CONSOLE,
                    startupinfo=si
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
    """返回当前队列状"""
    _schedule_workers()
    with worker_lock:
        return {
            "running": list(worker_pool.keys()),
            "queued": list(worker_queue),
            "max": MAX_WORKERS,
        }

def kill_all_workers():
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
    print(f"[worker-pool] 已杀{killed} 个worker,清空队")
    return killed

def _worker_pool_monitor():
    """后台线程：定期调度,让队列里的在空位时自动启"""
    while True:
        time.sleep(3)
        try: _schedule_workers()
        except: pass


# ── PC HTTP文件服务 ────────────────────────────────────
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import unquote, urlparse, parse_qs
import mimetypes
import json as _json

PC_ROOTS = {
    'cloud':  'D:\\cloud',
    'music':  'D:\\Music',
    'photos': 'D:\\Photos',
}

class PCFileHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # 关掉日志

    def do_GET(self):
        parsed = urlparse(self.path)
        path   = unquote(parsed.path)

        # 目录浏览API
        if path == '/count-images':
            cnt_path = params.get('path', [''])[0] if 'params' in dir() else parse_qs(parsed.query).get('path',[''])[0]
            import os as _os
            IMG = ('.jpg','.jpeg','.png','.gif','.webp','.bmp','.tiff','.tif','.heic')
            n = 0
            try:
                for dp, dn, fn in _os.walk(cnt_path):
                    for name in fn:
                        if name.lower().endswith(IMG):
                            n += 1
                            if n > 200000: break
            except: pass
            self._json({'realCount': n})
            return
        if path == '/browse':
            params  = parse_qs(parsed.query)
            dirPath = params.get('path', [''])[0]
            if not dirPath:
                # 返回所有盘
                import string
                drives = []
                for letter in string.ascii_uppercase:
                    d = f"{letter}:\\"
                    if os.path.exists(d):
                        drives.append({'name': f"{letter}:", 'path': d, 'type': 'dir'})
                self._json(drives)
                return
            try:
                items = []
                for name in os.listdir(dirPath):
                    full = os.path.join(dirPath, name)
                    try:
                        stat = os.stat(full)
                        if os.path.isdir(full):
                            items.append({'name': name, 'path': full, 'type': 'dir', 'mtime': int(stat.st_mtime)})
                        else:
                            ext = os.path.splitext(name)[1].lower()
                            if ext in {'.jpg','.jpeg','.png','.gif','.heic','.webp','.bmp','.tiff','.mp3','.flac','.aac','.wav','.m4a','.ogg'}:
                                items.append({'name': name, 'path': full, 'type': 'file', 'size': stat.st_size, 'mtime': int(stat.st_mtime), 'ext': ext})
                    except: pass
                items.sort(key=lambda x: (x['type']=='file', x['name'].lower()))
                self._json(items)
            except Exception as e:
                self._json({'error': str(e)}, 500)
            return

        # 文件访问
        if path.startswith('/file/'):
            filePath = unquote(path[6:]).replace('/', os.sep)
            if os.path.exists(filePath) and os.path.isfile(filePath):
                mime = mimetypes.guess_type(filePath)[0] or 'application/octet-stream'
                size = os.path.getsize(filePath)
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', size)
                self.send_header('Accept-Ranges', 'bytes')
                self.end_headers()
                with open(filePath, 'rb') as f:
                    while True:
                        chunk = f.read(65536)
                        if not chunk: break
                        self.wfile.write(chunk)
            else:
                self.send_response(404)
                self.end_headers()
            return

        self.send_response(404)
        self.end_headers()

    def _json(self, data, code=200):
        body = _json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)


    def do_POST(self):
        from urllib.parse import urlparse, unquote
        import json
        parsed = urlparse(self.path)
        path   = unquote(parsed.path)
        length = int(self.headers.get('Content-Length', 0))
        body   = json.loads(self.rfile.read(length)) if length else {}

        if path == '/scan':
            result = handle_scan_and_process(body)
            self._json(result)
        elif path == '/write-md5':
            import subprocess
            pc_path = body.get('pcPath', '').replace('/', '\\')
            print(f'[write-md5] pcPath={repr(pc_path)}')
            script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sync_by_exif.py')
            subprocess.Popen(
                ['python', script, pc_path],
                creationflags=0,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            self._json({'ok': True})
        elif path == '/clean-orphan':
            result = handle_clean_orphan(body.get('pcPath',''))
            self._json(result)
        elif path == '/process-dir':
            st = add_process_dir(body.get('pcPath',''))
            self._json({'ok': True, 'status': st})
        elif path == '/migrate-check':
            r = migrate_check(body.get('srcPath',''), body.get('dstRoot',''))
            self._json(r)
        elif path == '/migrate':
            r = start_migrate(body.get('srcPath',''), body.get('dstRoot',''))
            self._json(r)
        elif path == '/migrate-retry-one':
            r = migrate_retry_one(body.get('srcNas',''), body.get('dstNas',''))
            self._json(r)
        elif path == '/migrate-status':
            self._json(get_migrate_status())
        elif path == '/worker-status':
            self._json(get_worker_status())
        elif path == '/kill-workers':
            n = kill_all_workers()
            self._json({'ok': True, 'killed': n})
        elif path == '/delete-dir':
            import re, shutil
            pc_path = body.get('pcPath', '').replace('/', '\\')
            # 安全检查：盘符F:\ )拒绝,防止整盘删
            if re.match(r'^[A-Za-z]:\\?$', pc_path):
                print(f'[delete-dir] 拒绝删除磁盘 {pc_path}')
                self._json({'error': '不允许删除磁盘根目录'}, 403)
            elif not os.path.exists(pc_path):
                print(f'[delete-dir] 目录不存 {pc_path}')
                self._json({'ok': True, 'note': '目录已不存在'})
            elif not os.path.isdir(pc_path):
                self._json({'error': '不是目录'}, 400)
            else:
                try:
                    shutil.rmtree(pc_path)
                    print(f'[delete-dir] 已删除目 {pc_path}')
                    self._json({'ok': True, 'deleted': pc_path})
                except Exception as e:
                    print(f'[delete-dir] 删除失败: {e}')
                    self._json({'error': str(e)}, 500)
        else:
            self._json({"error": "unknown path"}, 404)

    def _json(self, data, code=200):
        import json
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

def start_http_server():
    server = HTTPServer(('0.0.0.0', 8080), PCFileHandler)
    print(f"PC HTTP服务启动: http://localhost:8080")
    server.serve_forever()

# ── 工具函数 ──────────────────────────────────────────
def scan_dir(root):
    files = []
    if not os.path.exists(root):
        return files
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith('.')]
        for filename in filenames:
            if filename.startswith('.'):
                continue
            filepath = os.path.join(dirpath, filename)
            try:
                stat     = os.stat(filepath)
                rel_path = os.path.relpath(filepath, root).replace(os.sep, '/')
                files.append({
                    'path':  rel_path,
                    'size':  stat.st_size,
                    'mtime': int(stat.st_mtime),
                })
            except Exception:
                pass
    return files

def calc_sha256(filepath):
    try:
        h = hashlib.sha256()
        with open(filepath, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None

_sys_config_cache = {}
def get_sys_config(key, default=None):
    """从NAS配置读取(带缓存"""
    global _sys_config_cache
    if not _sys_config_cache:
        try:
            _sys_config_cache = requests.get(f"{PHOTO_URL}/api/config/system", timeout=5).json()
        except: _sys_config_cache = {}
    return _sys_config_cache.get(key, default)

def nas_to_smb(nas_path):
    p = nas_path.replace('/share/', '').replace('/', '\\')
    return '\\\\whfnas\\' + p

def get_local_ip():
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return '127.0.0.1'

def get_pc_status():
    cpu    = psutil.cpu_percent(interval=1)
    mem    = psutil.virtual_memory()
    disk   = psutil.disk_usage('D:\\')
    return {
        'cpu':      cpu,
        'mem_total': round(mem.total / 1024**3, 1),
        'mem_used':  round(mem.used  / 1024**3, 1),
        'mem_pct':   mem.percent,
        'disk_total': round(disk.total / 1024**3, 1),
        'disk_used':  round(disk.used  / 1024**3, 1),
        'disk_pct':   round(disk.used / disk.total * 100, 1),
    }

# ── 任务处理 ──────────────────────────────────────────
def handle_sync(msg):
    event    = msg.get('event')
    nas_root = msg.get('nasPath')
    pc_root  = msg.get('pcPath')
    path     = msg.get('path')
    old_path = msg.get('oldPath')
    mode     = msg.get('mode', 'mirror')

    rel_path = path.replace(nas_root, '').lstrip('/')
    pc_file  = os.path.join(pc_root, rel_path.replace('/', os.sep))

    try:
        if event in ('create', 'modify'):
            smb_file = nas_to_smb(path)
            os.makedirs(os.path.dirname(pc_file), exist_ok=True)
            shutil.copy2(smb_file, pc_file)
            print(f"同步: {rel_path}")

        elif event == 'move' and old_path:
            old_rel = old_path.replace(nas_root, '').lstrip('/')
            pc_old  = os.path.join(pc_root, old_rel.replace('/', os.sep))
            if os.path.exists(pc_old):
                os.makedirs(os.path.dirname(pc_file), exist_ok=True)
                shutil.move(pc_old, pc_file)
                print(f"移动: {old_rel} -> {rel_path}")

        elif event == 'delete':
            if mode == 'mirror' and os.path.exists(pc_file):
                os.remove(pc_file)
                parent = os.path.dirname(pc_file)
                if os.path.exists(parent) and not os.listdir(parent):
                    os.rmdir(parent)
                print(f"删除: {rel_path}")

        return {'status': 'done'}

    except Exception as e:
        if 'Permission denied' in str(e):
            print(f"跳过(权限）: {rel_path}")
            return {'status': 'done'}
        print(f"同步失败: {rel_path} - {e}")
        return {'status': 'failed', 'error': str(e)}

def handle_file_index(msg):
    """扫描文件并计算sha256,分批返"""
    pc_path   = msg.get('pc_path', 'D:\\cloud')
    with_hash = msg.get('with_hash', False)
    files     = scan_dir(pc_path)

    if with_hash:
        for f in files:
            full = os.path.join(pc_path, f['path'].replace('/', os.sep))
            f['sha256'] = calc_sha256(full)

    return files

def handle_run_script(msg):
    """执行脚本或程"""
    script = msg.get('script', '')
    args   = msg.get('args', '')
    wait   = msg.get('wait', False)

    if not script:
        return {'status': 'failed', 'error': '缺少script参数'}

    try:
        cmd = f'"{script}" {args}' if args else f'"{script}"'
        if wait:
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
            return {'status': 'done', 'output': result.stdout + result.stderr}
        else:
            subprocess.Popen(cmd, shell=True)
            return {'status': 'done'}
    except Exception as e:
        return {'status': 'failed', 'error': str(e)}

def handle_notify(msg):
    """Windows弹出通知"""
    title   = msg.get('title', 'NAS通知')
    message = msg.get('message', '')
    try:
        ctypes.windll.user32.MessageBoxW(0, message, title, 0x40)
        return {'status': 'done'}
    except Exception as e:
        return {'status': 'failed', 'error': str(e)}

def handle_shutdown(msg):
    """关机/重启"""
    action = msg.get('action', 'shutdown')
    delay  = msg.get('delay', 60)
    try:
        if action == 'shutdown':
            subprocess.Popen(f'shutdown /s /t {delay}', shell=True)
        elif action == 'restart':
            subprocess.Popen(f'shutdown /r /t {delay}', shell=True)
        elif action == 'cancel':
            subprocess.Popen('shutdown /a', shell=True)
        return {'status': 'done'}
    except Exception as e:
        return {'status': 'failed', 'error': str(e)}

def handle_screenshot(msg):
    """截图(预留,需要pillow"""
    # TODO: 实现截图功能
    return {'status': 'failed', 'error': '功能预留,待实现'}

def handle_open_app(msg):
    """打开应用"""
    app = msg.get('app', '')
    if not app:
        return {'status': 'failed', 'error': '缺少app参数'}
    try:
        subprocess.Popen(f'start """ "{app}"', shell=True)
        return {'status': 'done'}
    except Exception as e:
        return {'status': 'failed', 'error': str(e)}


def handle_photo_process(msg):
    """处理图片：生成缩略图+预览EXIF+pHash"""
    import hashlib
    from PIL import Image
    import piexif
    import imagehash
    import io

    nas_path  = msg.get('path')
    data_path = msg.get('data_path', '/data/photos')
    task_id   = msg.get('task_id')

    # 路径处理：PC路径直接用,NAS路径转SMB
    import re
    if re.match(r'^[A-Za-z]:', nas_path.replace('/', chr(92))):
        smb_path = nas_path.replace('/', chr(92))
    else:
        smb_path = nas_to_smb(nas_path)
    print(f"处理图片: {smb_path}")

    try:
        # 获取文件元信        stat     = os.stat(smb_path)
        ctime    = int(stat.st_ctime)
        fsize    = stat.st_size

        # 打开图片
        img = Image.open(smb_path)
        # 根据EXIF自动旋转
        try:
            from PIL import ImageOps
            img = ImageOps.exif_transpose(img)
        except Exception:
            pass
        w, h = img.size

        # 生成文件名(用MD5
        with open(smb_path, 'rb') as f:
            data = f.read()
        md5 = hashlib.md5(data).hexdigest()

        thumb_name   = f"{md5}_thumb.jpg"
        preview_name = f"{md5}_preview.jpg"

        # NAS缩略图路径(SMB写入
        thumb_cfg   = get_sys_config('thumb_dir',   '/share/Container/docker/data/photos/thumbs')
        preview_cfg = get_sys_config('preview_dir', '/share/Container/docker/data/photos/preview')
        nas_thumb_dir   = nas_to_smb(thumb_cfg)
        nas_preview_dir = nas_to_smb(preview_cfg)
        os.makedirs(nas_thumb_dir,   exist_ok=True)
        os.makedirs(nas_preview_dir, exist_ok=True)

        # 生成缩略200x200
        thumb = img.copy()
        thumb.thumbnail((200, 200), Image.LANCZOS)
        thumb_rgb = thumb.convert('RGB')
        thumb_rgb.save(os.path.join(nas_thumb_dir, thumb_name), 'JPEG', quality=85)

        # 生成预览1920px
        preview = img.copy()
        preview.thumbnail((1920, 1920), Image.LANCZOS)
        preview_rgb = preview.convert('RGB')
        preview_rgb.save(os.path.join(nas_preview_dir, preview_name), 'JPEG', quality=90)

        # 计算pHash
        phash = str(imagehash.phash(img))

        # 读取EXIF
        exif_time   = None
        exif_camera = None
        exif_gps    = None
        try:
            exif_data = piexif.load(smb_path)
            exif_dict = exif_data.get('Exif', {})
            zeroth    = exif_data.get('0th', {})

            # 拍摄时间
            dt_str = exif_dict.get(piexif.ExifIFD.DateTimeOriginal)
            if dt_str:
                from datetime import datetime
                try:
                    dt = datetime.strptime(dt_str.decode(), '%Y:%m:%d %H:%M:%S')
                    exif_time = int(dt.timestamp())
                except: pass

            # 相机型号
            make  = zeroth.get(piexif.ImageIFD.Make,  b'').decode('utf-8', errors='ignore').strip('\x00')
            model = zeroth.get(piexif.ImageIFD.Model, b'').decode('utf-8', errors='ignore').strip('\x00')
            if make or model:
                exif_camera = f"{make} {model}".strip()

            # GPS
            gps = exif_data.get('GPS', {})
            if gps:
                def to_deg(val):
                    d, m, s = val
                    return d[0]/d[1] + m[0]/m[1]/60 + s[0]/s[1]/3600
                try:
                    lat = to_deg(gps[piexif.GPSIFD.GPSLatitude])
                    lon = to_deg(gps[piexif.GPSIFD.GPSLongitude])
                    if gps.get(piexif.GPSIFD.GPSLatitudeRef) == b'S': lat = -lat
                    if gps.get(piexif.GPSIFD.GPSLongitudeRef) == b'W': lon = -lon
                    exif_gps = f"{lat:.6f},{lon:.6f}"
                except: pass
        except: pass

        # 写md5到EXIF(只处理JPEG
        if os.path.splitext(smb_path)[1].lower() in (".jpg", ".jpeg"):
            try:
                import piexif
                exif_dict = piexif.load(smb_path)
                comment = ("ASCII\x00\x00\x00NAS_MD5=" + md5).encode("utf-8")
                exif_dict["Exif"][piexif.ExifIFD.UserComment] = comment
                piexif.insert(piexif.dump(exif_dict), smb_path)
            except Exception as _e:
                pass

        # 上报结果给NAS
        result = {
            'path':         nas_path,
            'ctime':        ctime,
            'thumb_path':   f"thumbs/{thumb_name}",
            'preview_path': f"preview/{preview_name}",
            'md5':          md5,
            'width':        w,
            'height':       h,
            'exif_time':    exif_time,
            'exif_camera':  exif_camera,
            'exif_gps':     exif_gps,
            'phash':        phash,
        }
        requests.post(f"{NAS_SYNC_URL.replace('3040','3050')}/api/photos/result",
                      json=result, timeout=10)
        print(f"图片处理完成: {os.path.basename(nas_path)}")
        return {'status': 'done'}

    except Exception as e:
        err = str(e)
        print(f"[ERROR] {nas_path} - {err}")
        try:
            requests.post(f"{NAS_SYNC_URL.replace('3040','3050')}/api/photos/result",
                          json={'path': nas_path, 'status': 'error'}, timeout=10)
        except Exception: pass
        return {'status': 'failed', 'error': err}



def handle_write_md5(msg):
    """遍历目录所有JPEG,打上EXIF md5并同步DB"""
    import hashlib, piexif as _px, requests as _req
    pc_path = msg.get("pcPath", "")
    if not pc_path or not os.path.exists(pc_path.replace("/", chr(92))):
        print(f"[write-md5] 目录不存 {pc_path}")
        return
    pc_path = pc_path.replace("/", chr(92))
    IMG_EXTS = {".jpg", ".jpeg"}
    done = skip = fail = total = 0
    print(f"[write-md5] 开 {pc_path}")

    # 拉取DB md5索引
    try:
        r = _req.post(f"{PHOTO_URL}/api/db/query",
            json={"sql": "SELECT id,path,md5 FROM photos WHERE md5 IS NOT NULL"},
            timeout=60)
        rows = r.json().get("rows", [])
        md5_index = {row["md5"]: {"id": row["id"], "path": row["path"]} for row in rows}
    except Exception as e:
        print(f"[write-md5] 拉取md5索引失败: {e}")
        return

    batch_upd = []
    batch_ins = []

    for dirpath, dirnames, filenames in os.walk(pc_path):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in {"$RECYCLE.BIN"}]
        for name in filenames:
            if os.path.splitext(name)[1].lower() not in IMG_EXTS:
                continue
            filepath = os.path.join(dirpath, name)
            total += 1
            nas_path = filepath.replace(chr(92), "/")

            # 读EXIF md5
            exif_md5 = None
            try:
                exif = _px.load(filepath)
                cmt = exif.get("Exif", {}).get(_px.ExifIFD.UserComment, b"")
                txt = cmt.decode("utf-8", errors="ignore")
                if "NAS_MD5=" in txt:
                    exif_md5 = txt.split("NAS_MD5=")[1][:32]
            except: pass

            if not exif_md5:
                # 算md5写EXIF
                try:
                    with open(filepath, "rb") as f:
                        exif_md5 = hashlib.md5(f.read()).hexdigest()
                    exif = _px.load(filepath)
                    comment = ("ASCII\x00\x00\x00NAS_MD5=" + exif_md5).encode("utf-8")
                    exif["Exif"][_px.ExifIFD.UserComment] = comment
                    _px.insert(_px.dump(exif), filepath)
                except Exception as e:
                    fail += 1
                    continue

            # 查DB
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
                except:
                    fail += 1

            # 批量提交
            if len(batch_upd) >= 200 or len(batch_ins) >= 200:
                _flush_md5_batch(batch_upd, batch_ins)
                done += len(batch_upd) + len(batch_ins)
                batch_upd, batch_ins = [], []

            if total % 500 == 0:
                print(f"[write-md5] 进度: {total}完成{done} 跳过{skip} 失败{fail}")

    _flush_md5_batch(batch_upd, batch_ins)
    done += len(batch_upd) + len(batch_ins)
    print(f"[write-md5] 完成: total={total} done={done} skip={skip} fail={fail}")


def _flush_md5_batch(upd, ins):
    import requests as _req
    if upd:
        for r in upd:
            try:
                _req.post(f"{PHOTO_URL}/api/db/query",
                    json={"sql": f"UPDATE photos SET path='{r[0]}',dir='{r[1]}',exif_written=1 WHERE id={r[2]}"},
                    timeout=10)
            except: pass
    if ins:
        vals = ",".join([f"('{r[0]}','{r[1]}',{r[2]},{r[3]},'{r[4]}','{r[5]}','pending',1)" for r in ins])
        try:
            _req.post(f"{PHOTO_URL}/api/db/query",
                json={"sql": f"INSERT OR IGNORE INTO photos (path,dir,size,mtime,file_key,md5,status,exif_written) VALUES {vals}"},
                timeout=30)
        except: pass

# ── 迁移：PC目录整体复制到NAS + 改DB ────────────────
migrate_state = {"running": False, "total": 0, "copied": 0, "skipped": 0, "failed": 0,
                 "cur": """, "src": """, "dst": """, "done": False, "error": """}
migrate_lock = threading.Lock()

def migrate_check(src_path, dst_root):
    """校验：检查目标位置有没有同名文件冲突。返回冲突列表,不迁移"""
    if not src_path or not dst_root:
        return {"ok": False, "error": "缺少源或目标"}
    src = src_path.replace("/", "\\").rstrip("\\")
    src_fwd = src_path.replace("\\", "/").rstrip("/")
    if not os.path.exists(src):
        return {"ok": False, "error": "源目录不存在"}
    dst_root_fwd = dst_root.replace("\\", "/").rstrip("/")
    folder_name = src_fwd.split("/")[-1]
    dst_nas_root = dst_root_fwd + ("/" + folder_name if folder_name else "")
    dst_smb_root = nas_to_smb(dst_nas_root)

    total = 0
    conflicts = []
    for dirpath, dirnames, filenames in os.walk(src):
        for name in filenames:
            total += 1
            fp = os.path.join(dirpath, name)
            rel = os.path.relpath(fp, src)
            dst_smb = os.path.join(dst_smb_root, rel)
            try:
                if os.path.exists(dst_smb):
                    conflicts.append(rel.replace("\\", "/"))
                    if len(conflicts) > 200:  # 太多就截
                        break
            except: pass
        if len(conflicts) > 200:
            break
    return {
        "ok": True,
        "total": total,
        "conflictCount": len(conflicts),
        "conflicts": conflicts[:200],
        "dstRoot": dst_nas_root,
        "hasConflict": len(conflicts) > 0
    }

def migrate_retry_one(src_nas, dst_nas):
    """单文件重试复制：src_nas是DB里F:/...格式,dst_nasshare/...格式"""
    if not src_nas or not dst_nas:
        return {"success": False, "error": "缺少参数"}
    src_local = src_nas.replace("/", "\\")
    dst_smb = nas_to_smb(dst_nas)
    if not os.path.exists(src_local):
        return {"success": False, "error": "源文件不存在: " + src_local}
    try:
        os.makedirs(os.path.dirname(dst_smb), exist_ok=True)
        if os.path.exists(dst_smb) and os.path.getsize(dst_smb) == os.path.getsize(src_local):
            return {"success": True, "skipped": True}
        shutil.copy2(src_local, dst_smb)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

def get_migrate_status():
    with migrate_lock:
        return dict(migrate_state)

def start_migrate(src_path, dst_root):
    with migrate_lock:
        if migrate_state["running"]:
            return {"ok": False, "error": "已有迁移任务进行"}
    if not src_path or not dst_root:
        return {"ok": False, "error": "缺少源或目标"}
    threading.Thread(target=_do_migrate, args=(src_path, dst_root), daemon=True).start()
    return {"ok": True, "message": "迁移已开"}

def _do_migrate(src_path, dst_root):
    import requests as _req
    src = src_path.replace("/", "\\").rstrip("\\")
    src_fwd = src_path.replace("\\", "/").rstrip("/")
    dst_root_fwd = dst_root.replace("\\", "/").rstrip("/")   # /share/Person
    folder_name = src_fwd.split("/")[-1]                        # 脸红Dearie NO
    dst_nas_root = dst_root_fwd + "/" + folder_name             # /share/Person/脸红Dearie NO
    dst_smb_root = nas_to_smb(dst_nas_root)                     # \\whfnas\Person\脸红Dearie NO

    # 批次ID：用时间
    batch_id = str(int(time.time()))
    with migrate_lock:
        migrate_state.update({"running": True, "total": 0, "copied": 0, "skipped": 0,
                              "failed": 0, "cur": """, "src": src_fwd, "dst": dst_nas_root,
                              "done": False, "error": """, "batch": batch_id})
    print(f"[migrate] batch={batch_id} {src} -> {dst_smb_root}")

    # 收集所有文    all_files = []
    for dirpath, dirnames, filenames in os.walk(src):
        for name in filenames:
            all_files.append(os.path.join(dirpath, name))
    with migrate_lock:
        migrate_state["total"] = len(all_files)
    print(f"[migrate] {len(all_files)} 个文")

    # 收集成功/失败
    updates = []   # [{src: F:/x, dst: /share/y}]
    failures = [] # [{src, dst, error}]

    for fp in all_files:
        rel = os.path.relpath(fp, src)
        dst_smb = os.path.join(dst_smb_root, rel)
        # 源NAS格式path(DB里的) + 目标NAS格式path
        rel_fwd = rel.replace("\\", "/")
        src_nas = src_fwd + "/" + rel_fwd
        dst_nas = dst_nas_root + "/" + rel_fwd
        try:
            os.makedirs(os.path.dirname(dst_smb), exist_ok=True)
            if os.path.exists(dst_smb) and os.path.getsize(dst_smb) == os.path.getsize(fp):
                with migrate_lock: migrate_state["skipped"] += 1
                updates.append({"src": src_nas, "dst": dst_nas})  # 跳过=已存在,也算迁移成功
            else:
                shutil.copy2(fp, dst_smb)
                with migrate_lock: migrate_state["copied"] += 1
                updates.append({"src": src_nas, "dst": dst_nas})
            with migrate_lock: migrate_state["cur"] = rel
        except Exception as e:
            err_msg = str(e)
            with migrate_lock: migrate_state["failed"] += 1
            failures.append({"src": src_nas, "dst": dst_nas, "error": err_msg})
            print(f"[migrate] 复制失败 {rel}: {err_msg}")

    # 复制结束：成功的批量改DB,没匹配上的追加到失败表
    import requests as _req
    if updates:
        try:
            r = _req.post(f"{PHOTO_URL}/api/migrate-commit", json={"updates": updates}, timeout=60)
            result = r.json()
            print(f"[migrate] DB更新: updated={result.get('updated',0)} unmatched={len(result.get('unmatched',[]))}")
            # 没匹配上的当复制成功但DB未关,追加到failures
            for u in result.get('unmatched', []):
                failures.append({"src": u["src"], "dst": u["dst"], "error": "复制成功但DB未匹配到记录(源不在数据库"})
                with migrate_lock:
                    migrate_state["failed"] += 1
                    migrate_state["copied"] -= 1  # 从复制数里扣回来
        except Exception as e:
            print(f"[migrate] DB更新失败: {e}")
    if failures:
        try:
            r = _req.post(f"{PHOTO_URL}/api/migrate-failures", json={"batch": batch_id, "failures": failures}, timeout=30)
            print(f"[migrate] 失败记录: {r.json()}")
        except Exception as e:
            print(f"[migrate] 失败记录写入失败: {e}")

    with migrate_lock:
        migrate_state["running"] = False
        migrate_state["done"] = True
    print("[migrate] 完成: 复制%d 跳过%d 失败%d" % (migrate_state["copied"], migrate_state["skipped"], migrate_state["failed"]))

def _flush_migrate_db(updates):
    """改DB path: src_nas -> dst_nas。注意DB里PC路径存的F:/ 格式"""
    import requests as _req
    if not updates:
        return
    sqls = []
    for src_nas, dst_nas in updates:
        # DB里PC图片pathF:/... 格式(src_fwd就是),直接改/share/...
        s = src_nas.replace("'", "''")
        d = dst_nas.replace("'", "''")
        sqls.append(f"UPDATE photos SET path='{d}', dir='{d.rsplit('/',1)[0]}' WHERE path='{s}'")
    try:
        _req.post(f"{PHOTO_URL}/api/db/batch", json={"sqls": sqls}, timeout=60)
    except Exception as e:
        print(f"[migrate] 改DB失败: {e}")


def handle_clean_orphan(pc_path):
    """清理孤立记录：DB里有但PC本地文件已不存在的,删DB记录+NAS缩略图。返回概要"""
    import requests as _req
    if not pc_path:
        return {"error": "缺少路径"}
    fwd = pc_path.replace("\\", "/").rstrip("/")
    print(f"[clean-orphan] 开始检 {fwd}")

    try:
        r = _req.post(f"{PHOTO_URL}/api/db/query",
            json={"sql": f"SELECT id,path FROM photos WHERE REPLACE(path,'\\','/') LIKE '{fwd}/%'"},
            timeout=120)
        rows = r.json().get("rows", [])
    except Exception as e:
        print(f"[clean-orphan] 拉取DB失败: {e}")
        return {"error": f"拉取DB失败: {e}"}

    total = len(rows)
    print(f"[clean-orphan] DB记录 {total} 条,逐个检查本地文..")
    orphan_ids = []
    checked = 0
    for row in rows:
        local = row["path"].replace("/", "\\")
        if not os.path.exists(local):
            orphan_ids.append(row["id"])
        checked += 1
        if checked % 2000 == 0:
            print(f"[clean-orphan] 已检{checked}/{total}, 孤立 {len(orphan_ids)}")

    orphan_cnt = len(orphan_ids)
    print(f"[clean-orphan] 检查完 孤立 {orphan_cnt} ")

    deleted = 0
    if orphan_ids:
        BATCH = 200
        for i in range(0, len(orphan_ids), BATCH):
            batch = orphan_ids[i:i+BATCH]
            try:
                resp = _req.post(f"{PHOTO_URL}/api/photos/delete-by-ids",
                    json={"ids": batch}, timeout=60)
                deleted += resp.json().get("deleted", 0)
            except Exception as e:
                print(f"[clean-orphan] 删除批次失败: {e}")
    print(f"[clean-orphan] 完成: 已删{deleted} ")

    return {"ok": True, "total": total, "orphan": orphan_cnt, "deleted": deleted}


def handle_scan_and_process(msg):
    """扫描PC目录：按文件夹单位上报进写路径到DB"""
    import hashlib, os

    pc_path  = msg.get("pcPath", """)
    task_id  = msg.get("task_id", """)
    if not pc_path or not os.path.exists(pc_path):
        print(f"目录不存 {pc_path}")
        return {"status": "failed", "error": "目录不存"}

    IMG_EXTS = {".jpg",".jpeg",".png",".gif",".bmp",".tiff",".webp",".heic",".raw"}

    # 从NAS DB拿已done的file_key集合
    done_keys = set()
    try:
        r = requests.get(f"{PHOTO_URL}/api/photos/done-keys", timeout=30)
        done_keys = set(r.json().get("keys", []))
    except Exception as e:
        print(f"获取done-keys失败: {e}")

    total_actual = 0
    dir_stats    = {}
    all_file_paths = set()

    # 按文件夹遍历,每扫完一个文件夹上报一
    for dirpath, dirnames, filenames in os.walk(pc_path):
        dirnames[:] = sorted([d for d in dirnames if not d.startswith(".") and not d.startswith("@")])
        files = []
        for filename in filenames:
            if os.path.splitext(filename)[1].lower() not in IMG_EXTS:
                continue
            filepath = os.path.join(dirpath, filename)
            try:
                stat = os.stat(filepath)
                key  = hashlib.md5(f"{filename}_{stat.st_size}_{int(stat.st_mtime)}".encode()).hexdigest()
                fwd = filepath.replace(chr(92), "/")
                # 读EXIF md5(JPEG用EXIF,PNG用tEXt块）
                exif_md5 = None
                ext = os.path.splitext(filename)[1].lower()
                if ext in (".jpg", ".jpeg"):
                    try:
                        import piexif as _px
                        _exif = _px.load(filepath)
                        _cmt = _exif.get("Exif", {}).get(_px.ExifIFD.UserComment, b"")
                        _txt = _cmt.decode("utf-8", errors="ignore")
                        if "NAS_MD5=" in _txt:
                            exif_md5 = _txt.split("NAS_MD5=")[1][:32]
                    except: pass
                elif ext == ".png":
                    try:
                        from PIL import Image as _Img
                        _img = _Img.open(filepath)
                        exif_md5 = _img.info.get("NAS_MD5")
                    except: pass
                files.append({
                    "path":     fwd,
                    "name":     filename,
                    "size":     stat.st_size,
                    "mtime":    int(stat.st_mtime),
                    "key":      key,
                    "exif_md5": exif_md5,
                })
                all_file_paths.add(fwd)
            except Exception:
                pass

        if not files:
            continue

        # 对file_key不在done_keys的文件,读EXIF里的md5做第二层匹配
        for f in files:
            if f["key"] not in done_keys and f["path"].lower().endswith((".jpg",".jpeg")):
                try:
                    import piexif
                    local = f["path"].replace("/", chr(92))
                    exif = piexif.load(local)
                    cmt = exif.get("Exif", {}).get(piexif.ExifIFD.UserComment, b"")
                    txt = cmt.decode("utf-8", errors="ignore")
                    if "NAS_MD5=" in txt:
                        f["exif_md5"] = txt.split("NAS_MD5=")[1][:32]
                except: pass

        total_actual += len(files)
        done_cnt = sum(1 for f in files if f["key"] in done_keys)
        dir_stats[dirpath] = {"total": len(files), "done": done_cnt}

        # 上报进度到NAS
        if task_id:
            try:
                requests.post(f"{PHOTO_URL}/api/pc/scan-progress", json={
                    "taskId":  task_id,
                    "dirPath": dirpath,
                    "files":   files,
                    "stats":   {dirpath: {"total": len(files), "done": done_cnt}},
                }, timeout=30)
            except Exception as e:
                print(f"上报失败: {dirpath} - {e}")

    # 冒泡汇总父目录
    all_needed = set(dir_stats.keys())
    for d in list(dir_stats.keys()):
        parent = os.path.dirname(d)
        while parent and len(parent) >= len(pc_path) and parent not in all_needed:
            all_needed.add(parent)
            parent = os.path.dirname(parent)
    for d in all_needed:
        if d not in dir_stats:
            dir_stats[d] = {"total": 0, "done": 0}
    for d in sorted(all_needed, key=lambda x: x.count(chr(92)), reverse=True):
        parent = os.path.dirname(d)
        if parent and parent != d and len(parent) >= len(pc_path):
            dir_stats[parent]["total"] += dir_stats[d]["total"]
            dir_stats[parent]["done"]  += dir_stats[d]["done"]
    dir_stats[pc_path] = {"total": total_actual, "done": dir_stats.get(pc_path, {}).get("done", 0)}

    # 发完成信汇总stats
    if task_id:
        try:
            requests.post(f"{PHOTO_URL}/api/pc/scan-progress", json={
                "taskId":   task_id,
                "stats":    dir_stats,
                "done":     True,
            }, timeout=30)
        except Exception as e:
            print(f"发完成信号失 {e}")

    # 清理孤立记录：PC做差分,删掉DB里不存在的文件记
    root_fwd = pc_path.replace(chr(92), "/")
    try:
        r = requests.post(f"{PHOTO_URL}/api/db/query",
            json={"sql": f"SELECT id,path FROM photos WHERE path LIKE '{root_fwd}%'"},
            timeout=30)
        db_rows = r.json().get("rows", [])
        to_delete = [row["id"] for row in db_rows if row["path"] not in all_file_paths]
        if to_delete:
            print(f"清理孤立记录: 删除{len(to_delete)}")
            batch_size = 100
            for i in range(0, len(to_delete), batch_size):
                batch = to_delete[i:i+batch_size]
                ids_str = ",".join(str(x) for x in batch)
                requests.post(f"{PHOTO_URL}/api/db/query",
                    json={"sql": f"DELETE FROM photos WHERE id IN ({ids_str})"},
                    timeout=10)
        else:
            print("清理孤立记录: 无需清理")
    except Exception as e:
        print(f"清理孤立失败: {e}")

    print(f"扫描完成: {total_actual} 张,{len(dir_stats)} 个目")
    return {"status": "done", "actual": total_actual, "dirStats": dir_stats}

def process_worker():
    print("图片处理worker启动,轮询NAS队列...")
    while True:
        try:
            r = requests.post(f"{PHOTO_URL}/api/photos/claim", json={"n": 1}, timeout=10)
            tasks = r.json().get("tasks", [])
        except Exception:
            time.sleep(15); continue
        if not tasks:
            time.sleep(15); continue
        for t in tasks:
            res = handle_photo_process({
                "path":      t["path"],
                "data_path": "/data/photos",
                "task_id":   t.get("id"),
            })
            if res and res.get("status") == "done":
                try: requests.post(f"{PHOTO_URL}/api/process-logs/add", json={"path": t["path"], "status": "done"}, timeout=10)
                except Exception: pass
            else:
                err_msg = res.get("error", "unknown") if res else "handle返回None"
                print(f"[FAIL] {t['path']} - {err_msg}")
                try: requests.post(f"{PHOTO_URL}/api/photos/fail", json={"path": t["path"]}, timeout=10)
                except Exception: pass
                try: requests.post(f"{PHOTO_URL}/api/process-logs/add", json={"path": t["path"], "status": "error", "error": err_msg}, timeout=10)
                except Exception: pass

# ── 消息路由 ──────────────────────────────────────────
HANDLERS = {
    'sync':         handle_sync,
    'run_script':   handle_run_script,
    'notify':       handle_notify,
    'shutdown':     handle_shutdown,
    'screenshot':   handle_screenshot,
    'open_app':      handle_open_app,
    'photo_process':      handle_photo_process,
    'scan_and_process': handle_scan_and_process,
}

async def connect():
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 正在连接NAS...")
    while True:
        try:
            async with websockets.connect(NAS_WS) as ws:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] 已连接NAS")

                await ws.send(json.dumps({
                    "type":   "online",
                    "gpu":    "RTX3080Ti",
                    "name":   "legion",
                    "ip":     get_local_ip(),
                    "status": get_pc_status(),
                }))

                async for message in ws:
                    msg  = json.loads(message)
                    mtype = msg.get("type")
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] 收到: {mtype}")

                    if mtype == "pong":
                        continue

                    elif mtype == "scan_request":
                        pc_path = msg.get("pc_path", "D:\\cloud")
                        files   = scan_dir(pc_path)
                        await ws.send(json.dumps({
                            "type":    "scan_result",
                            "task_id": msg.get("task_id"),
                            "pc_path": pc_path,
                            "files":   files,
                            "count":   len(files),
                        }))
                        print(f"扫描完成: {len(files)}个文")

                    elif mtype == "file_index":
                        files = handle_file_index(msg)
                        await ws.send(json.dumps({
                            "type":    "file_index_result",
                            "task_id": msg.get("task_id"),
                            "files":   files,
                            "count":   len(files),
                        }))
                        print(f"文件索引完成: {len(files)}个文")

                    elif mtype == "get_status":
                        await ws.send(json.dumps({
                            "type":    "status_result",
                            "task_id": msg.get("task_id"),
                            **get_pc_status(),
                        }))

                    elif mtype in HANDLERS:
                        result = HANDLERS[mtype](msg)
                        await ws.send(json.dumps({
                            "type":    "result",
                            "task_id": msg.get("task_id"),
                            **result,
                        }))

                    else:
                        print(f"未知消息类型: {mtype}")

        except Exception as e:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] 连接断开: {e}秒后重试...")
            await asyncio.sleep(5)

if __name__ == "__main__":
    threading.Thread(target=start_http_server, daemon=True).start()
    threading.Thread(target=_worker_pool_monitor, daemon=True).start()
    print("NAS Client 启动")
    print(f"连接地址: {NAS_WS}")
    asyncio.run(connect())











