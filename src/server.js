const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

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

// Look up a food by name, create it if it doesn't exist, return its id
async function resolveFood(mealieBase, token, name) {
  // Search existing foods
  const search = await mealieRequest('GET', mealieBase, token, `/foods?search=${encodeURIComponent(name)}&perPage=10`, null);
  if (search.status === 200) {
    try {
      const data = JSON.parse(search.body);
      const items = data.items || data;
      const match = items.find(f => f.name.toLowerCase() === name.toLowerCase());
      if (match) return { id: match.id, name: match.name };
    } catch(e) {}
  }

  // Create it
  const create = await mealieRequest('POST', mealieBase, token, '/foods', { name });
  if (create.status === 200 || create.status === 201) {
    try {
      const food = JSON.parse(create.body);
      return { id: food.id, name: food.name };
    } catch(e) {}
  }

  return null;
}

// Look up a unit by name, create if needed, return its id
async function resolveUnit(mealieBase, token, name) {
  const search = await mealieRequest('GET', mealieBase, token, `/units?search=${encodeURIComponent(name)}&perPage=10`, null);
  if (search.status === 200) {
    try {
      const data = JSON.parse(search.body);
      const items = data.items || data;
      const match = items.find(u => u.name.toLowerCase() === name.toLowerCase() || (u.abbreviation || '').toLowerCase() === name.toLowerCase());
      if (match) return { id: match.id, name: match.name };
    } catch(e) {}
  }

  // Create it
  const create = await mealieRequest('POST', mealieBase, token, '/units', { name });
  if (create.status === 200 || create.status === 201) {
    try {
      const unit = JSON.parse(create.body);
      return { id: unit.id, name: unit.name };
    } catch(e) {}
  }

  return null;
}

// ── Main proxy ────────────────────────────────────────────────────────────────
app.use('/mealie-api', (req, res) => {
  const mealieBase = (req.headers['x-mealie-url'] || '').replace(/\/$/, '');
  const token = req.headers['x-mealie-token'] || '';
  if (!mealieBase) return res.status(400).json({ error: 'Missing X-Mealie-Url header' });

  const fullUrl = `${mealieBase}/api${req.path}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
  console.log(`[proxy] ${req.method} ${fullUrl}`);

  let targetUrl;
  try { targetUrl = new URL(fullUrl); }
  catch (e) { return res.status(400).json({ error: 'Invalid URL' }); }

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
    res.status(proxyRes.statusCode);
    res.set('Content-Type', proxyRes.headers['content-type'] || 'application/json');
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (err) => res.status(502).json({ error: err.message }));
  if (req.body && Object.keys(req.body).length > 0) {
    const body = JSON.stringify(req.body);
    proxyReq.setHeader('Content-Length', Buffer.byteLength(body));
    proxyReq.write(body);
  }
  proxyReq.end();
});

// ── Push ingredients (server-side: resolve foods/units → PATCH recipe) ────────
app.post('/push-ingredients', async (req, res) => {
  const { mealieUrl, token, slug, ingredients } = req.body;
  if (!mealieUrl || !token || !slug || !ingredients) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // 1. GET existing recipe
  const getResult = await mealieRequest('GET', mealieUrl, token, `/recipes/${slug}`, null);
  if (getResult.status !== 200) {
    return res.status(getResult.status).json({ error: `Could not fetch recipe: HTTP ${getResult.status}` });
  }
  let recipe;
  try { recipe = JSON.parse(getResult.body); }
  catch (e) { return res.status(500).json({ error: 'Could not parse recipe response' }); }

  // 2. Resolve each ingredient's food and unit to get IDs
  const newIngredients = [];
  for (const p of ingredients) {
    const food = p.food ? await resolveFood(mealieUrl, token, p.food) : null;
    const unit = p.unit ? await resolveUnit(mealieUrl, token, p.unit) : null;

    newIngredients.push({
      quantity: p.quantity > 0 ? p.quantity : null,
      unit: unit || null,
      food: food || null,
      note: '',
      display: p.display || '',
      title: '',
      originalText: p.display || '',
      referenceId: uuidv4(),
      referencedRecipe: null
    });
  }

  // 3. PATCH with full recipe + new ingredients appended
  const merged = [...(recipe.recipeIngredient || []), ...newIngredients];
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

  const getResult = await mealieRequest('GET', mealieUrl, token, `/recipes/${slug}`, null);
  let recipe;
  try { recipe = JSON.parse(getResult.body); }
  catch (e) { return res.json({ get_status: getResult.status, parse_error: getResult.body.slice(0,300) }); }

  // Resolve a real food id for the test ingredient
  const food = await resolveFood(mealieUrl, token, 'test-debug-delete-me');

  const testIng = {
    quantity: 1, unit: null,
    food: food || null,
    note: '', display: 'test-debug-delete-me',
    title: '', originalText: 'test-debug-delete-me',
    referenceId: uuidv4(), referencedRecipe: null
  };

  const patch = await mealieRequest('PATCH', mealieUrl, token, `/recipes/${slug}`, {
    ...recipe,
    recipeIngredient: [...(recipe.recipeIngredient || []), testIng]
  });

  res.json({
    get_status: getResult.status,
    existing_count: (recipe.recipeIngredient || []).length,
    sample: recipe.recipeIngredient?.[0] || null,
    food_resolved: food,
    patch_status: patch.status,
    patch_body: patch.body.slice(0, 500)
  });
});

app.listen(PORT, () => {
  console.log(`Mealie Ingredient Pusher running on http://localhost:${PORT}`);
});
