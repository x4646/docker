import io
with io.open("worker.py","r",encoding="utf-8-sig") as f:
    lines = f.readlines()
for i in range(0, min(50, len(lines))):
    print(i+1, lines[i].rstrip())
