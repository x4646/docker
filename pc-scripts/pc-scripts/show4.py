import io
with io.open("sync_by_exif.py","r",encoding="utf-8-sig") as f:
    lines = f.readlines()
for i in range(124, 148):
    print(i+1, lines[i].rstrip())
