#!/bin/sh
cd /share/Container/docker/stock-monitor
docker stop stock-monitor 2>/dev/null
docker rm stock-monitor 2>/dev/null
docker build -t stock-monitor . --no-cache || { echo "❌ 构建失败"; exit 1; }
/share/CACHEDEV1_DATA/.qpkg/container-station/usr/local/lib/docker/cli-plugins/docker-compose up -d
echo "✅ stock-monitor 重建完成"
