const http = require('http');

module.exports = {
  name:        '股票今日总结',
  description: '获取今日持仓涨跌情况',
  icon:        '📈',

  async execute(params) {
    return new Promise((resolve) => {
      http.get('http://192.168.0.3:3000/api/prices', (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const prices = JSON.parse(data).filter(p => !p.error);
            const up     = prices.filter(p => p.changePct > 0).length;
            const down   = prices.filter(p => p.changePct < 0).length;

            const rows = prices.map(p => ({
              symbol:    p.symbol,
              price:     p.price,
              change:    (p.changePct >= 0 ? '+' : '') + p.changePct + '%',
              currency:  p.currency,
            }));

            resolve({
              type: 'table',
              title: `上涨 ${up} 支 | 下跌 ${down} 支`,
              data: rows
            });
          } catch(e) {
            resolve({ type: 'error', data: '获取失败' });
          }
        });
      }).on('error', () => resolve({ type: 'error', data: '连接失败' }));
    });
  }
};
