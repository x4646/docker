#!/bin/sh
cd /share/Container/docker/nas-sync
docker stop nas-sync 2>/dev/null
docker rm nas-sync 2>/dev/null
docker rmi nas-sync 2>/dev/null
docker build -t nas-sync . --no-cache || { echo "❌ 构建失败"; exit 1; }
docker run -d \
  --name nas-sync \
  --restart unless-stopped \
  -p 3040:3040 \
  -v /share/Container/docker/data:/data \
  -v /share/Container/docker/nas-sync/public:/app/public \
  -v /share:/share \
  nas-sync
echo "✅ nas-sync 重建完成"
