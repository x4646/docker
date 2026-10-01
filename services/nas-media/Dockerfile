FROM node:20-alpine
WORKDIR /app
# 项目在host上的绝对路径(通过/share挂载可见),vthumbs等目录用它拼路径,不要在代码里写死
ENV PROJECT_DIR=/share/Container/docker/services/svc-photo
# 2026-09-24加: 视频实时转码(播放低分辨率版本)要用, NAS没有GPU, 纯CPU软转
RUN apk add --no-cache ffmpeg libheif-tools   # libheif-tools: HEIC(iPhone 照片)转 JPEG 用, 见 public/js/ingest-worker.js
COPY package.json .
RUN npm install
COPY . .
CMD ["node", "--watch", "src/index.js"]
