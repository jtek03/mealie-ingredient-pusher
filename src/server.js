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

// ── Push ingredients endpoint ─────────────────────────────────────────────────
// Handles the full GET → merge → PATCH flow server-side so the browser
// never has to deal with the large recipe payload.
app.post('/push-ingredients', async (req, res) => {
  const { mealieUrl, token, slug, ingredients } = req.body;
  if (!mealieUrl || !token || !slug || !ingredients) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // 1. GET existing recipe
  const getResult = await mealieRequest('GET', mealieUrl, token, `/recipes/${slug}`, null);
  if (getResult.status !== 200) {
    return res.status(getResult.status).json({ error: `Could not fetch recipe: HTTP ${getResult.status}`, detail: getResult.body.slice(0, 200) });
  }

  let recipe;
  try { recipe = JSON.parse(getResult.body); }
  catch (e) { return res.status(500).json({ error: 'Could not parse recipe response' }); }

  // 2. Build new ingredients in Mealie's exact format (from sample_existing_ingredient)
  function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  const newIngredients = ingredients.map(p => ({
    quantity: p.quantity > 0 ? p.quantity : null,
    unit: p.unit ? { name: p.unit } : null,
    food: p.food ? { name: p.food } : null,
    note: '',
    display: p.display || '',
    title: '',
    originalText: p.display || '',
    referenceId: uuidv4(),
    referencedRecipe: null
  }));

  // 3. Keep existing ingredients exactly as-is, append new ones
  const existingIngredients = recipe.recipeIngredient || [];
  const merged = [...existingIngredients, ...newIngredients];

  // 4. PATCH with full recipe to avoid Mealie's ValueError on partial updates
  const patchResult = await mealieRequest('PATCH', mealieUrl, token, `/recipes/${slug}`, {
    ...recipe,
    recipeIngredient: merged
  });

  if (patchResult.status >= 400) {
    return res.status(patchResult.status).json({
      error: `PATCH failed: HTTP ${patchResult.status}`,
      detail: patchResult.body.slice(0, 500)
    });
  }

  res.json({ success: true, added: newIngredients.length });
});

// ── Debug route ───────────────────────────────────────────────────────────────
app.post('/debug/test-patch', async (req, res) => {
  const { mealieUrl, token, slug } = req.body;
  if (!mealieUrl || !token || !slug) return res.json({ error: 'Missing fields' });

  const results = {};
  const getResult = await mealieRequest('GET', mealieUrl, token, `/recipes/${slug}`, null);
  results.get_status = getResult.status;

  let recipe;
  try { recipe = JSON.parse(getResult.body); }
  catch (e) { return res.json({ ...results, parse_error: getResult.body.slice(0,300) }); }

  results.existing_count = (recipe.recipeIngredient || []).length;
  results.sample = recipe.recipeIngredient?.[0] || null;

  // Try PATCH with full recipe + one new ingredient in exact Mealie format
  const testIng = {
    quantity: 1, unit: null,
    food: { name: 'test-debug-delete-me' },
    note: '', display: 'test-debug-delete-me',
    title: '', originalText: 'test-debug-delete-me',
    referenceId: '00000000-0000-4000-a000-000000000001',
    referencedRecipe: null
  };

  const patch = await mealieRequest('PATCH', mealieUrl, token, `/recipes/${slug}`, {
    ...recipe,
    recipeIngredient: [...(recipe.recipeIngredient || []), testIng]
  });
  results.patch_status = patch.status;
  results.patch_body = patch.body.slice(0, 500);

  res.json(results);
});

app.listen(PORT, () => {
  console.log(`Mealie Ingredient Pusher running on http://localhost:${PORT}`);
});
