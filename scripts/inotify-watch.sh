#!/bin/sh
NAS_SYNC_URL="http://192.168.0.3:3040"
LAST_EVENT=""
LAST_PATH=""
LAST_TIME=0

get_dirs() {
  curl -s "$NAS_SYNC_URL/api/config/dirs" | grep -o '"nas":"[^"]*"' | sed 's/"nas":"//;s/"//'
}

send_event() {
  event=$1
  path=$2
  old_path=$3
  now=$(date +%s)

  # 防抖：同一路径同一事件2秒内只处理一次
  if [ "$path" = "$LAST_PATH" ] && [ "$event" = "$LAST_EVENT" ]; then
    diff=$((now - LAST_TIME))
    if [ $diff -lt 2 ]; then
      return
    fi
  fi

  LAST_EVENT="$event"
  LAST_PATH="$path"
  LAST_TIME=$now

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

  echo "[$event] $path"
}

DIRS=$(get_dirs)
if [ -z "$DIRS" ]; then
  echo "没有配置同步目录"
  exit 1
fi

echo "开始监听："
echo "$DIRS"

inotifywait -m -r \
  -e create,close_write,move,delete \
  --format '%e %w%f' \
  $DIRS 2>/dev/null | while read event path; do

  case "$event" in
    CREATE)
      [ -f "$path" ] && send_event "create" "$path"
      ;;
    CLOSE_WRITE)
      [ -f "$path" ] && send_event "modify" "$path"
      ;;
    DELETE|MOVED_FROM)
      send_event "delete" "$path"
      ;;
    MOVED_TO)
      send_event "create" "$path"
      ;;
  esac

done
