const express = require('express');
const path    = require('path');
const http    = require('http');
const config  = require('./config');

const app  = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function proxyApi(req, res) {
  const query   = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const target  = new URL(config.INDEXER_URL);
  const options = {
    hostname: target.hostname,
    port:     parseInt(target.port) || 3050,
    path:     req.path + query,
    method:   req.method,
    headers:  { 'Content-Type': 'application/json' },
  };

  const proxyReq = http.request(options, (r) => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.send(data);
    });
  });

  proxyReq.on('error', e => res.status(500).json({ error: e.message }));
  if (req.method !== 'GET' && req.body) proxyReq.write(JSON.stringify(req.body));
  proxyReq.end();
}

app.get('/api/pc/file/*', (req, res) => res.redirect(`${config.INDEXER_URL}/api/pc/file/${req.params[0]}`));
app.all('/api/*', proxyApi);
app.get('/thumbs/:file',  (req, res) => res.redirect(`${config.INDEXER_URL}/thumbs/${req.params.file}`));
app.get('/preview/:file', (req, res) => res.redirect(`${config.INDEXER_URL}/preview/${req.params.file}`));
app.get('/original/*',    (req, res) => res.redirect(`${config.INDEXER_URL}/original/${req.params[0]}`));
app.get('/music/*',       (req, res) => res.redirect(`${config.INDEXER_URL}/music/${req.params[0]}`));

app.listen(config.PORT, '0.0.0.0', () => console.log(`Photo Viewer running on port ${config.PORT}`));
