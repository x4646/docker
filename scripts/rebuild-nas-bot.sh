#!/bin/sh
cd /share/Container/docker/nas-bot
docker stop nas-bot && docker rm nas-bot
docker rmi nas-bot
docker build -t nas-bot . --no-cache || { echo "❌ 构建失败"; exit 1; }
docker run -d \
  --name nas-bot \
  --restart unless-stopped \
  --network host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /share/Container/docker/weather-settings/data:/data \
  nas-bot
echo "nas-bot 重建完成"
