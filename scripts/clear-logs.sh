#!/bin/sh
for container in nas-bot nas-dashboard stock-monitor weather-settings; do
  logpath=$(docker inspect --format='{{.LogPath}}' $container 2>/dev/null)
  if [ -n "$logpath" ]; then
    echo "" > $logpath
    echo "✅ 已清空 $container 日志"
  fi
done
