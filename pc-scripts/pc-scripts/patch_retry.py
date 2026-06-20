# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

# 加路由
old = """        elif path == '/migrate':
            r = start_migrate(body.get('srcPath',''), body.get('dstRoot',''))
            self._json(r)"""
new = """        elif path == '/migrate':
            r = start_migrate(body.get('srcPath',''), body.get('dstRoot',''))
            self._json(r)
        elif path == '/migrate-retry-one':
            r = migrate_retry_one(body.get('srcNas',''), body.get('dstNas',''))
            self._json(r)"""
if old in c and "/migrate-retry-one" not in c:
    c = c.replace(old, new, 1)
    print("OK route")
else:
    print("route SKIP")

# 加函数
target = "def get_migrate_status():"
func = '''def migrate_retry_one(src_nas, dst_nas):
    """单文件重试复制：src_nas是DB里F:/...格式，dst_nas是/share/...格式"""
    if not src_nas or not dst_nas:
        return {"success": False, "error": "缺少参数"}
    src_local = src_nas.replace("/", "\\\\")
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

def get_migrate_status():'''

if "def migrate_retry_one(" not in c and target in c:
    c = c.replace(target, func, 1)
    print("OK func")
else:
    print("func SKIP")

with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
    f.write(c)
