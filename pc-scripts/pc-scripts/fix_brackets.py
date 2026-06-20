import os, ctypes

# 用Windows API直接改名，绕过Python路径解析
kernel32 = ctypes.windll.kernel32

def rename_win(old, new):
    return kernel32.MoveFileW(old, new)

# F盘根目录下所有含[]的目录
import os
root = "F:\\"
try:
    entries = os.listdir(root)
except Exception as e:
    print(e)
    exit()

for name in entries:
    if "[" in name or "]" in name:
        import re
        new_name = re.sub(r"[\[\]{}]", "", name).strip()
        old_path = root + name
        new_path = root + new_name
        print(f"改名: {name} -> {new_name}")
        result = rename_win(old_path, new_path)
        print("结果:", "成功" if result else f"失败 错误码:{ctypes.GetLastError()}")
