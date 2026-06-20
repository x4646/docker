# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

# 1. 加配置缓存读取函数（放在 nas_to_smb 前面）
old1 = "def nas_to_smb(nas_path):"
new1 = '''_sys_config_cache = {}
def get_sys_config(key, default=None):
    """从NAS配置读取（带缓存）"""
    global _sys_config_cache
    if not _sys_config_cache:
        try:
            _sys_config_cache = requests.get(f"{PHOTO_URL}/api/config/system", timeout=5).json()
        except: _sys_config_cache = {}
    return _sys_config_cache.get(key, default)

def nas_to_smb(nas_path):'''

if old1 not in c:
    print("NOT FOUND nas_to_smb")
else:
    c = c.replace(old1, new1, 1)

# 2. 改479-480行从配置读
old2 = '''        nas_thumb_dir   = nas_to_smb('/share/Container/docker/data/photos/thumbs')
        nas_preview_dir = nas_to_smb('/share/Container/docker/data/photos/preview')'''
new2 = '''        thumb_cfg   = get_sys_config('thumb_dir',   '/share/Container/docker/data/photos/thumbs')
        preview_cfg = get_sys_config('preview_dir', '/share/Container/docker/data/photos/preview')
        nas_thumb_dir   = nas_to_smb(thumb_cfg)
        nas_preview_dir = nas_to_smb(preview_cfg)'''

if old2 not in c:
    print("NOT FOUND thumb dirs")
else:
    c = c.replace(old2, new2, 1)

with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
    f.write(c)
print("OK")
