import io
with io.open("sync_by_exif.py","r",encoding="utf-8-sig") as f:
    lines = f.readlines()
for i in range(85, 92):
    print(i+1, lines[i].rstrip())
print("---")
for i in range(192, 210):
    print(i+1, lines[i].rstrip())
