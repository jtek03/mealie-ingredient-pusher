const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

function mealieRequest(method, mealieBase, token, apiPath, body) {
  const fullUrl = `${mealieBase.replace(/\/$/, '')}/api${apiPath}`;
  const targetUrl = new URL(fullUrl);
  const transport = targetUrl.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      },
      rejectUnauthorized: false
    };
    const chunks = [];
    const req = transport.request(opts, (r) => {
      r.on('data', c => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

// ── Main proxy: /mealie-api/* → Mealie /api/* ─────────────────────────────────
app.use('/mealie-api', (req, res) => {
  const mealieBase = (req.headers['x-mealie-url'] || '').replace(/\/$/, '');
  const token = req.headers['x-mealie-token'] || '';

  if (!mealieBase) return res.status(400).json({ error: 'Missing X-Mealie-Url header' });

  const targetPath = '/api' + req.path;
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const fullUrl = `${mealieBase}${targetPath}${qs}`;
  console.log(`[proxy] ${req.method} ${fullUrl}`);

  let targetUrl;
  try { targetUrl = new URL(fullUrl); }
  catch (e) { return res.status(400).json({ error: 'Invalid Mealie URL', detail: e.message }); }

  const transport = targetUrl.protocol === 'https:' ? https : http;
  const opts = {
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

  const proxyReq = transport.request(opts, (proxyRes) => {
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

// ── Debug route ───────────────────────────────────────────────────────────────
app.post('/debug/test-patch', async (req, res) => {
  const { mealieUrl, token, slug } = req.body;
  if (!mealieUrl || !token || !slug) {
    return res.json({ error: 'Missing mealieUrl, token, or slug' });
  }

  const results = {};

  // 1. GET recipe
  const getResult = await mealieRequest('GET', mealieUrl, token, `/recipes/${slug}`, null);
  results.get_status = getResult.status;

  let recipe;
  try { recipe = JSON.parse(getResult.body); }
  catch (e) { return res.json({ ...results, get_parse_error: getResult.body.slice(0, 300) }); }

  results.recipe_keys = Object.keys(recipe);
  results.existing_ingredient_count = (recipe.recipeIngredient || []).length;
  if (recipe.recipeIngredient && recipe.recipeIngredient[0]) {
    results.sample_existing_ingredient = recipe.recipeIngredient[0];
  }

  // 2. PATCH with only recipeIngredient (minimal new ingredient)
  const minIng = {
    quantity: 1, unit: null,
    food: { name: 'test-debug-delete-me' },
    note: '', isFood: true, disableAmount: false,
    display: 'test-debug-delete-me', title: null,
    referenceId: '00000000-0000-4000-a000-000000000001'
  };

  const patch1 = await mealieRequest('PATCH', mealieUrl, token, `/recipes/${slug}`,
    { recipeIngredient: [minIng] });
  results.patch_minimal_status = patch1.status;
  results.patch_minimal_body = patch1.body.slice(0, 500);

  // 3. If PATCH fails, try PUT with full recipe body
  if (patch1.status >= 400) {
    const put1 = await mealieRequest('PUT', mealieUrl, token, `/recipes/${slug}`,
      { ...recipe, recipeIngredient: [...(recipe.recipeIngredient || []), minIng] });
    results.put_full_status = put1.status;
    results.put_full_body = put1.body.slice(0, 500);
  }

  res.json(results);
});

app.listen(PORT, () => {
  console.log(`Mealie Ingredient Pusher running on http://localhost:${PORT}`);
});
