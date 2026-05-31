#!/bin/sh
# inotify文件监听脚本
# 监听NAS目录变化，推送到nas-sync数据库

NAS_SYNC_URL="http://192.168.0.3:3040"

# 从nas-sync获取监听目录列表
get_dirs() {
  curl -s "$NAS_SYNC_URL/api/config/dirs" | grep -o '"nas":"[^"]*"' | sed 's/"nas":"//;s/"//'
}

# 发送事件到nas-sync
send_event() {
  event=$1
  path=$2
  old_path=$3
  size=$(stat -c%s "$path" 2>/dev/null || echo 0)

  if [ -n "$old_path" ]; then
    curl -s -X POST "$NAS_SYNC_URL/api/event" \
      -H "Content-Type: application/json" \
      -d "{\"event\":\"$event\",\"path\":\"$path\",\"oldPath\":\"$old_path\",\"size\":$size}" > /dev/null
  else
    curl -s -X POST "$NAS_SYNC_URL/api/event" \
      -H "Content-Type: application/json" \
      -d "{\"event\":\"$event\",\"path\":\"$path\",\"size\":$size}" > /dev/null
  fi
}

# 获取监听目录
DIRS=$(get_dirs)
if [ -z "$DIRS" ]; then
  echo "没有配置同步目录"
  exit 1
fi

echo "开始监听目录："
echo "$DIRS"

# 开始监听
inotifywait -m -r -e create,modify,move,delete \
  --format '%e %w%f %w%f' \
  $DIRS 2>/dev/null | while read event path oldpath; do

  case "$event" in
    CREATE|MOVED_TO)
      [ -f "$path" ] && send_event "create" "$path"
      ;;
    MODIFY)
      [ -f "$path" ] && send_event "modify" "$path"
      ;;
    DELETE|MOVED_FROM)
      send_event "delete" "$path"
      ;;
    MOVED_FROM,MOVED_TO)
      send_event "move" "$path" "$oldpath"
      ;;
  esac

done
