# GPU加速缩略图生成
import torch
import torchvision.transforms.functional as TF
from PIL import Image
import io

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"使用设备: {DEVICE}")

THUMB_SIZE  = (400, 400)
PREVIEW_SIZE = (1200, 1200)

def make_thumb_gpu(img_bytes, size):
    """用GPU生成缩略图"""
    try:
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        # 转tensor到GPU
        t = TF.to_tensor(img).unsqueeze(0).to(DEVICE)
        # resize
        h, w = t.shape[2], t.shape[3]
        scale = min(size[0]/h, size[1]/w)
        new_h, new_w = int(h*scale), int(w*scale)
        t = torch.nn.functional.interpolate(t, size=(new_h, new_w), mode="bilinear", align_corners=False)
        # 转回PIL
        t = t.squeeze(0).cpu()
        out = TF.to_pil_image(t)
        buf = io.BytesIO()
        out.save(buf, format="JPEG", quality=85)
        return buf.getvalue()
    except Exception as e:
        # 失败降级到CPU
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        img.thumbnail(size, Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue()

# 测试
import time
test_img = open(r"F:\脸红Dearie NO\脸红Dearie NO.001 推特@Dearie697 191P-20V-106MB\www.98T.la@002.jpg", "rb").read()
t0 = time.time()
for i in range(10):
    make_thumb_gpu(test_img, THUMB_SIZE)
print(f"GPU: 10张耗时 {time.time()-t0:.2f}s")

from PIL import Image
import io
t0 = time.time()
for i in range(10):
    img = Image.open(io.BytesIO(test_img)).convert("RGB")
    img.thumbnail(THUMB_SIZE, Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
print(f"CPU: 10张耗时 {time.time()-t0:.2f}s")
