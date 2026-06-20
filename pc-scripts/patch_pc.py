# -*- coding: utf-8 -*-
import io

FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    lines = f.read().split("\n")

changed = []

# 改 smb_path 那行：PC本地路径直接用，不转SMB
for i, l in enumerate(lines):
    if "smb_path = nas_to_smb(nas_path)" in l and "handle_photo_process" not in l:
        lines[i] = l.replace(
            "smb_path = nas_to_smb(nas_path)",
            "smb_path = nas_path if not nas_path.startswith('/share') else nas_to_smb(nas_path)"
        )
        changed.append("smb_path")
        break

with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(lines))
print("已应用:", ", ".join(changed) if changed else "无")
