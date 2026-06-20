import io
with io.open("nas_client.py","r",encoding="utf-8-sig") as f:
    lines = f.readlines()
start = None
for i, l in enumerate(lines):
    if "def _do_migrate" in l:
        start = i
        break
for i in range(start, min(start+50, len(lines))):
    print(i+1, lines[i].rstrip())
