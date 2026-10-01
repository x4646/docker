class ConsoleLogger {
  fmt(level, msg, meta) {
    const t = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const m = meta ? ' ' + JSON.stringify(meta) : '';
    return `${t} [nas-media] ${level}: ${msg}${m}`;
  }
  info(msg, meta)  { console.log(this.fmt('info',  msg, meta)); }
  warn(msg, meta)  { console.warn(this.fmt('warn', msg, meta)); }
  error(msg, meta) { console.error(this.fmt('error', msg, meta)); }
  debug(msg, meta) { console.debug(this.fmt('debug', msg, meta)); }
}

module.exports = { ConsoleLogger };
