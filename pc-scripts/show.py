import io
with io.open("sync_by_exif.py","r",encoding="utf-8-sig") as f:
    lines = f.readlines()
for i in range(13, 40):
    print(i+1, lines[i].rstrip())
print("---")
for i in range(70, 130):
    print(i+1, lines[i].rstrip())
