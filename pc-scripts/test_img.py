import os
from PIL import Image

path = r"F:\[www.98T.la@脸红Dearie\微博@Dearie697 [195P1V]\www.98T.la@1 (100).jpg"
print("exists:", os.path.exists(path))
try:
    img = Image.open(path)
    print("ok:", img.size, img.format)
except Exception as e:
    print("error:", type(e).__name__, str(e))
