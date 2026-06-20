# -*- coding: utf-8 -*-
"""
找出指定目录下不能打EXIF md5的图片
用法: python find_no_md5.py F:\
"""
import os, sys, piexif
from PIL import Image
from collections import defaultdict

IMG_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".webp", ".heic", ".raw", ".cr2", ".nef", ".arw"}
SUPPORT_EXTS = {".jpg", ".jpeg", ".png"}

root = sys.argv[1] if len(sys.argv) > 1 else "."
print(f"扫描目录: {root}")

ext_counts = defaultdict(int)
no_md5_files = []
total = 0

def check(filepath, ext):
    try:
        if ext in (".jpg", ".jpeg"):
            piexif.load(filepath)
            return True
        elif ext == ".png":
            Image.open(filepath)
            return True
    except Exception as e:
        return False
    return True

for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in {"$RECYCLE.BIN"}]
    for name in filenames:
        ext = os.path.splitext(name)[1].lower()
        if ext not in IMG_EXTS:
            continue
        total += 1
        ext_counts[ext] += 1
        filepath = os.path.join(dirpath, name)
        if ext not in SUPPORT_EXTS:
            no_md5_files.append((filepath, "格式不支持"))
        else:
            if not check(filepath, ext):
                no_md5_files.append((filepath, "文件损坏"))
        if total % 1000 == 0:
            print(f"进度: {total}张 不能打:{len(no_md5_files)}张")

print(f"\n各格式统计:")
for ext, cnt in sorted(ext_counts.items(), key=lambda x: -x[1]):
    can = "✅ 能打" if ext in SUPPORT_EXTS else "❌ 不能打"
    print(f"  {can} {ext}: {cnt}张")

print(f"\n不能打md5的文件: {len(no_md5_files)}张 / 共{total}张")
if no_md5_files:
    print("前20条:")
    for f, reason in no_md5_files[:20]:
        print(f"  {reason} | {f}")

    confirm = input(f"\n确认移动{len(no_md5_files)}张到 F:\\损坏文件？(y/n): ")
    if confirm.lower() == "y":
        import shutil
        BROKEN_DIR = r"D:\损坏文件"
        moved = fail = 0
        for filepath, reason in no_md5_files:
            drive = os.path.splitdrive(filepath)[0].rstrip(":")
            rel = os.path.relpath(os.path.dirname(filepath), root)
            dest_dir = os.path.join(BROKEN_DIR, drive, rel)
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(dest_dir, os.path.basename(filepath))
            try:
                shutil.copy2(filepath, dest)
                moved += 1
                if moved % 20 == 0:
                    print(f"已移动: {moved}")
            except Exception as e:
                print(f"移动失败: {os.path.basename(filepath)} - {e}")
                fail += 1
        print(f"移动完成: 成功{moved} 失败{fail}")
