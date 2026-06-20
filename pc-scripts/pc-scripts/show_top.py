import io
with io.open("nas_client.py","r",encoding="utf-8-sig") as f:
    lines = f.readlines()
# 看顶部import和全局变量
for i in range(0, 25):
    print(i+1, lines[i].rstrip())
