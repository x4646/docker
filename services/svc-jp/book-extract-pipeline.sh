#!/bin/bash
# 安宁《日语词汇新思维》/《日语语法新思维》页面转录用的图片预处理流水线。
# 用法: book-extract-pipeline.sh <pdf路径> <起始页> <结束页> <输出目录前缀>
# 输出: <输出目录>/page-NNN.png，已裁边+灰度二值化+缩到70%，可直接用 Read 工具读取转录。
set -e
PDF="$1"
FROM="$2"
TO="$3"
OUTDIR="$4"

POPPLER="/c/Users/x4646/AppData/Local/Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin/pdftoppm.exe"
MAGICK="/c/Program Files/ImageMagick-7.1.2-Q16-HDRI/magick.exe"

mkdir -p "$OUTDIR"
RAWDIR="$OUTDIR/raw"
mkdir -p "$RAWDIR"

"$POPPLER" -f "$FROM" -l "$TO" -r 300 -png "$PDF" "$RAWDIR/p"

for f in "$RAWDIR"/p-*.png; do
  base=$(basename "$f")
  num=$(echo "$base" | sed -E 's/p-0*([0-9]+)\.png/\1/')
  out="$OUTDIR/page-$(printf '%03d' "$num").png"
  "$MAGICK" "$f" -trim +repage -colorspace Gray -normalize -threshold 60% -resize 70% "$out"
done

rm -rf "$RAWDIR"
echo "done: $(ls "$OUTDIR" | wc -l) pages -> $OUTDIR"
