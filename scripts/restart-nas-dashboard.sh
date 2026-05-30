#!/bin/sh
docker stop nas-dashboard
docker rm nas-dashboard
docker run -d \
  --name nas-dashboard \
  --restart unless-stopped \
  --network host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /share/Container/docker/nas-dashboard/data:/data/dashboard \
  -v /share/Container/docker/nas-dashboard/public:/app/public \
  -v /share/Container/docker/nas-dashboard/modules:/app/modules \
  -v /share/Container/docker/nas-dashboard/server.js:/app/server.js \
  -v /share/Container/docker/data:/data \
  -v /share/Container/docker/scripts:/scripts \
  nas-dashboard
echo "nas-dashboard 重启完成"
