import io
with io.open("nas_client.py","r",encoding="utf-8-sig") as f:
    lines = f.readlines()
# 找 thumb_path / preview_path 出现的地方
for i, l in enumerate(lines):
    if "thumb_path" in l or "preview_path" in l or "'thumb'" in l or "result" in l.lower():
        print(i+1, l.rstrip())
