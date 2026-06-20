import io
with io.open("nas_client.py","r",encoding="utf-8-sig") as f:
    lines = f.readlines()
for i in range(112, 128):
    print(i+1, lines[i].rstrip())
