#!/bin/sh
# 监控nas-dashboard，停了就重启
while true; do
  if ! docker ps | grep -q nas-dashboard; then
    echo "$(date) nas-dashboard停止，正在重启..."
    sh /share/Container/docker/scripts/restart-nas-dashboard.sh
  fi
  sleep 5
done
