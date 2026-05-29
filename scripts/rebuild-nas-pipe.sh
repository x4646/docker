#!/bin/sh
cd /share/Container/docker/nas-pipe
docker stop nas-pipe 2>/dev/null
docker rm nas-pipe 2>/dev/null
docker build -t nas-pipe . --no-cache || { echo "❌ 构建失败"; exit 1; }
docker run -d \
  --name nas-pipe \
  --restart unless-stopped \
  -p 3030:3030 \
  nas-pipe
echo "✅ nas-pipe 重建完成"
