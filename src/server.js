const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Proxy /mealie-api/* → target Mealie server, injecting the token server-side
app.use('/mealie-api', (req, res, next) => {
  const target = req.headers['x-mealie-url'];
  const token = req.headers['x-mealie-token'];

  if (!target) {
    return res.status(400).json({ error: 'Missing X-Mealie-Url header' });
  }

  // Strip our custom headers before forwarding
  delete req.headers['x-mealie-url'];
  delete req.headers['x-mealie-token'];

  if (token) {
    req.headers['authorization'] = `Bearer ${token}`;
  }

  createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite: { '^/mealie-api': '/api' },
    on: {
      error: (err, req, res) => {
        console.error('Proxy error:', err.message);
        res.status(502).json({ error: 'Could not reach Mealie server', detail: err.message });
      }
    }
  })(req, res, next);
});

app.listen(PORT, () => {
  console.log(`Mealie Ingredient Pusher running on http://localhost:${PORT}`);
});
