const config = {
  TOKEN: '8838005992:AAEETKYczov8IwloZdNOESpOWVgwnSpmb9U',
  ADMIN: '6423823321',
  NAS_IP:  '192.168.0.3',
  OLLAMA:  'http://192.168.0.3:11434',
  STOCK:   'http://192.168.0.3:3000',
  STOCK_CONTAINER: 'stock-monitor',
  STOCK_PORT:      3000,
  AI_MODEL:       'qwen2.5:1.5b',
  AI_TIMEOUT:     120000,
  CLAUDE_API_KEY: '',
  WEATHER_API_KEY: '95f6885e043c782e21cb7fa152fad7d6',
  WEATHER_CITY:    'Sumida',
  DASHBOARD_URL:   'http://192.168.0.3:3020',
  WEATHER_TEMP_DIFF: 5,   // 温度变化阈值°C
  WEATHER_WIND_LIMIT: 10, // 强风阈值m/s
  WEATHER_START_HOUR: 15, // 天气检测开始
  WEATHER_END_HOUR:   21, // 天气检测结束
  LOG_DIR:   '/data/logs',
  LOG_LEVEL: 'info',
  ALERT_PCT:      3,
  SUMMARY_HOUR:   15,
  SUMMARY_MIN:    35,
  ALERT_INTERVAL: 5,
  MARKET_HOURS: [
    { start: 540, end: 690 },
    { start: 750, end: 930 },
  ],
  RATE_LIMIT_MAX:    10,
  RATE_LIMIT_WINDOW: 60000,
  DANGEROUS_CMDS: [
    'rm -rf', 'mkfs', 'dd if', 'format', '> /dev', 'chmod 777', 'chown root',
  ],
  KEYBOARD_ROWS: [],
  BTN_MAP: {},
};

export default config;
