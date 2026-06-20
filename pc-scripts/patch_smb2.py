# -*- coding: utf-8 -*-
import io
FN = "nas_client.py"
with io.open(FN, "r", encoding="utf-8-sig") as f:
    c = f.read()
old = "def nas_to_smb(nas_path):\n    p = nas_path.replace(\"/share/\", \"\").replace(\"/\", \"\\\\\")\n    return \"\\\\\\\\whfnas\\\\\" + p"
new = """def get_smb_host():
    try:
        import requests as _r
        cfg = _r.get(f"{PHOTO_URL}/api/config/system", timeout=5).json()
        return cfg.get("nas_smb_host", "whfnas")
    except:
        return "whfnas"

def nas_to_smb(nas_path):
    p = nas_path.replace("/share/", "").replace("/", "\\\\")
    return "\\\\\\\\" + get_smb_host() + "\\\\" + p"""
if old not in c:
    print("NOT FOUND")
    print("actual:", repr(c[5549:5649]))
else:
    c = c.replace(old, new, 1)
    with io.open(FN, "w", encoding="utf-8", newline="\n") as f:
        f.write(c)
    print("OK")

