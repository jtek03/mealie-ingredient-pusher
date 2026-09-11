const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Proxy /mealie-api/* → Mealie /api/* server-side (avoids browser CORS entirely)
app.use('/mealie-api', (req, res) => {
  const mealieBase = (req.headers['x-mealie-url'] || '').replace(/\/$/, '');
  const token = req.headers['x-mealie-token'] || '';

  if (!mealieBase) {
    return res.status(400).json({ error: 'Missing X-Mealie-Url header' });
  }

  const targetPath = '/api' + req.path;
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const fullUrl = `${mealieBase}${targetPath}${qs}`;

  console.log(`[proxy] ${req.method} ${fullUrl}`);

  let targetUrl;
  try {
    targetUrl = new URL(fullUrl);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid Mealie URL', detail: e.message });
  }

  const transport = targetUrl.protocol === 'https:' ? https : http;

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    rejectUnauthorized: false
  };

  const proxyReq = transport.request(options, (proxyRes) => {
    console.log(`[proxy] response ${proxyRes.statusCode} from ${fullUrl}`);
    res.status(proxyRes.statusCode);
    res.set('Content-Type', proxyRes.headers['content-type'] || 'application/json');
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[proxy] error: ${err.message}`);
    res.status(502).json({ error: 'Could not reach Mealie server', detail: err.message });
  });

  if (req.body && Object.keys(req.body).length > 0) {
    const body = JSON.stringify(req.body);
    proxyReq.setHeader('Content-Length', Buffer.byteLength(body));
    proxyReq.write(body);
  }

  proxyReq.end();
});

app.listen(PORT, () => {
  console.log(`Mealie Ingredient Pusher running on http://localhost:${PORT}`);
});

// Debug routes (safe to leave in — no auth bypass, just proxies to Mealie)
require('./debug')(app);
