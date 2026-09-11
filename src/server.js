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

async function resolveFood(mealieBase, token, name) {
  const search = await mealieRequest('GET', mealieBase, token, `/foods?search=${encodeURIComponent(name)}&perPage=10`, null);
  if (search.status === 200) {
    try {
      const data = JSON.parse(search.body);
      const items = data.items || data;
      const match = items.find(f => f.name.toLowerCase() === name.toLowerCase());
      if (match) return { id: match.id, name: match.name };
    } catch(e) {}
  }
  const create = await mealieRequest('POST', mealieBase, token, '/foods', { name });
  if (create.status === 200 || create.status === 201) {
    try { const food = JSON.parse(create.body); return { id: food.id, name: food.name }; } catch(e) {}
  }
  return null;
}

async function resolveUnit(mealieBase, token, name) {
  const search = await mealieRequest('GET', mealieBase, token, `/units?search=${encodeURIComponent(name)}&perPage=10`, null);
  if (search.status === 200) {
    try {
      const data = JSON.parse(search.body);
      const items = data.items || data;
      const match = items.find(u =>
        u.name.toLowerCase() === name.toLowerCase() ||
        (u.abbreviation || '').toLowerCase() === name.toLowerCase());
      if (match) return { id: match.id, name: match.name };
    } catch(e) {}
  }
  const create = await mealieRequest('POST', mealieBase, token, '/units', { name });
  if (create.status === 200 || create.status === 201) {
    try { const unit = JSON.parse(create.body); return { id: unit.id, name: unit.name }; } catch(e) {}
  }
  return null;
}

// ── Main proxy ────────────────────────────────────────────────────────────────
app.use('/mealie-api', (req, res) => {
  const mealieBase = (req.headers['x-mealie-url'] || '').replace(/\/$/, '');
  const token = req.headers['x-mealie-token'] || '';
  if (!mealieBase) return res.status(400).json({ error: 'Missing X-Mealie-Url header' });

  const fullUrl = `${mealieBase}/api${req.path}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
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
  proxyReq.on('error', err => res.status(502).json({ error: err.message }));
  if (req.body && Object.keys(req.body).length > 0) {
    const body = JSON.stringify(req.body);
    proxyReq.setHeader('Content-Length', Buffer.byteLength(body));
    proxyReq.write(body);
  }
  proxyReq.end();
});

// ── Push endpoint ─────────────────────────────────────────────────────────────
app.post('/push-ingredients', async (req, res) => {
  const { mealieUrl, token, slug, ingredients = [], instructions = [] } = req.body;
  if (!mealieUrl || !token || !slug) {
    return res.status(400).json({ error: 'Missing mealieUrl, token, or slug' });
  }

  // GET existing recipe
  const getResult = await mealieRequest('GET', mealieUrl, token, `/recipes/${slug}`, null);
  if (getResult.status !== 200) {
    return res.status(getResult.status).json({
      error: `Could not fetch recipe — HTTP ${getResult.status}. Check the slug is correct.`
    });
  }
  let recipe;
  try { recipe = JSON.parse(getResult.body); }
  catch (e) { return res.status(500).json({ error: 'Could not parse recipe response' }); }

  // Resolve ingredients — look up/create food & unit IDs
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

  // Build instruction steps
  const newInstructions = instructions.map(step => ({
    id: uuidv4(),
    title: step.title || '',
    text: step.text || '',
    summary: ''
  }));

  // Merge with existing
  const mergedIngredients = [...(recipe.recipeIngredient || []), ...newIngredients];
  const mergedInstructions = [...(recipe.recipeInstructions || []), ...newInstructions];

  // PATCH
  const patchResult = await mealieRequest('PATCH', mealieUrl, token, `/recipes/${slug}`, {
    ...recipe,
    recipeIngredient: mergedIngredients,
    recipeInstructions: mergedInstructions
  });

  if (patchResult.status >= 400) {
    return res.status(patchResult.status).json({
      error: `PATCH failed: HTTP ${patchResult.status}`,
      detail: patchResult.body.slice(0, 500)
    });
  }

  res.json({
    success: true,
    ingredientsAdded: newIngredients.length,
    instructionsAdded: newInstructions.length
  });
});

app.listen(PORT, () => {
  console.log(`Mealie Ingredient Pusher running on http://localhost:${PORT}`);
});
