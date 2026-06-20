import io
with io.open("sync_by_exif.py","r",encoding="utf-8-sig") as f:
    lines = f.readlines()
# process函数定义
for i, l in enumerate(lines):
    if l.startswith("def process"):
        for j in range(i, min(i+12, len(lines))):
            print(j+1, lines[j].rstrip())
        break
