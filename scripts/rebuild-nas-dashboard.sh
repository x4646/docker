#!/bin/sh
cd /share/Container/docker/nas-dashboard
docker stop nas-dashboard && docker rm nas-dashboard
docker rmi nas-dashboard
docker build -t nas-dashboard . --no-cache || { echo "❌ 构建失败"; exit 1; }
docker run -d \
  --name nas-dashboard \
  --restart unless-stopped \
  --network host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /share/Container/docker/nas-dashboard/data:/data \
  -v /share/Container/docker/nas-dashboard/public:/app/public \
  -v /share/Container/docker/nas-dashboard/modules:/app/modules \
  -v /share/Container/docker/weather-settings/data:/data/weather \
  nas-dashboard
echo "nas-dashboard 重建完成"
