#!/bin/sh
# 停止旧容器
docker stop nas-dashboard
docker rm nas-dashboard

# 重新启动
docker run -d \
  --name nas-dashboard \
  --restart unless-stopped \
  --network host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /share/Container/docker/nas-dashboard/data:/data \
  -v /share/Container/docker/nas-dashboard/public:/app/public \
  -v /share/Container/docker/nas-dashboard/modules:/app/modules \
  -v /share/Container/docker/nas-dashboard/server.js:/app/server.js \
  -v /share/Container/docker/weather-settings/data:/data/weather \
  -v /share/Container/docker/scripts:/scripts \
  nas-dashboard

echo "nas-dashboard 重启完成"
