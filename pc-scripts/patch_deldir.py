# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()

old = """            self._json({'ok': True})
        else:
            self._json({"error": "unknown path"}, 404)"""

new = """            self._json({'ok': True})
        elif path == '/delete-dir':
            import re, shutil
            pc_path = body.get('pcPath', '').replace('/', '\\\\')
            # 安全检查：盘符根(如 F:\\ )拒绝，防止整盘删除
            if re.match(r'^[A-Za-z]:\\\\?$', pc_path):
                print(f'[delete-dir] 拒绝删除磁盘根: {pc_path}')
                self._json({'error': '不允许删除磁盘根目录'}, 403)
            elif not os.path.exists(pc_path):
                print(f'[delete-dir] 目录不存在: {pc_path}')
                self._json({'ok': True, 'note': '目录已不存在'})
            elif not os.path.isdir(pc_path):
                self._json({'error': '不是目录'}, 400)
            else:
                try:
                    shutil.rmtree(pc_path)
                    print(f'[delete-dir] 已删除目录: {pc_path}')
                    self._json({'ok': True, 'deleted': pc_path})
                except Exception as e:
                    print(f'[delete-dir] 删除失败: {e}')
                    self._json({'error': str(e)}, 500)
        else:
            self._json({"error": "unknown path"}, 404)"""

if old not in c:
    print("NOT FOUND")
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")
