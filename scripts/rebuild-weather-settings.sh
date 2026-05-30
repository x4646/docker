#!/bin/sh
cd /share/Container/docker/weather-settings
docker stop weather-settings 2>/dev/null
docker rm weather-settings 2>/dev/null
docker build -t weather-settings . --no-cache || { echo "❌ 构建失败"; exit 1; }
docker run -d \
  --name weather-settings \
  --restart unless-stopped \
  -p 3010:3010 \
  -v /share/Container/docker/data:/data \
  weather-settings
echo "✅ weather-settings 重建完成"
