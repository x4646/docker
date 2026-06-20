# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    content = f.read()

old = "    # NAS路径转SMB路径\n    smb_path = nas_path if not nas_path.startswith('/share') else nas_to_smb(nas_path)"
new = "    # 路径处理：PC路径直接用，NAS路径转SMB\n    if re.match(r'^[A-Za-z]:', nas_path.replace('/', chr(92))):\n        smb_path = nas_path.replace('/', chr(92))\n    else:\n        smb_path = nas_to_smb(nas_path)"

if old not in content:
    print("NOT FOUND")
else:
    content = content.replace(old, new, 1)
    # 确保import re存在
    if 'import re' not in content:
        content = content.replace('import os', 'import os\nimport re', 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    print("OK")
