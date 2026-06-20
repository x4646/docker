import torch, torchvision.transforms.functional as TF
from PIL import Image
import io, time, os

DEVICE = torch.device("cuda")
THUMB_SIZE = 400

# 找10张本地图片
imgs = []
for root, dirs, files in os.walk(r"F:\脸红Dearie NO"):
    for f in files:
        if f.lower().endswith(".jpg"):
            imgs.append(os.path.join(root, f))
        if len(imgs) >= 10: break
    if len(imgs) >= 10: break

print(f"找到{len(imgs)}张图")

# GPU批量：先逐张resize到固定尺寸再batch
t0 = time.time()
tensors = []
for p in imgs:
    with open(p,"rb") as f: data = f.read()
    img = Image.open(io.BytesIO(data)).convert("RGB")
    # 先CPU resize到固定尺寸
    img.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.BILINEAR)
    tensors.append(TF.to_tensor(img).unsqueeze(0))
# 批量转GPU做最终处理
batch = torch.cat(tensors).to(DEVICE)
batch = batch.cpu()
print(f"GPU批量10张: {time.time()-t0:.2f}s")

# CPU逐张
t0 = time.time()
for p in imgs:
    with open(p,"rb") as f: data = f.read()
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
print(f"CPU逐张10张: {time.time()-t0:.2f}s")
