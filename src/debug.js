// Debug route — add to server.js to expose a /debug endpoint
// Fetches the recipe and attempts a dry PATCH with one minimal ingredient
// so we can see exactly what Mealie accepts/rejects

module.exports = function addDebugRoute(app) {
  app.post('/debug/test-patch', async (req, res) => {
    const https = require('https');
    const http = require('http');
    const { URL } = require('url');

    const { mealieUrl, token, slug } = req.body;
    if (!mealieUrl || !token || !slug) {
      return res.json({ error: 'Missing mealieUrl, token, or slug' });
    }

    const base = mealieUrl.replace(/\/$/, '');
    const results = {};

    async function mealieReq(method, path, body) {
      const fullUrl = `${base}/api${path}`;
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
        const req2 = transport.request(opts, (r) => {
          r.on('data', c => chunks.push(c));
          r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(chunks).toString() }));
        });
        req2.on('error', e => resolve({ status: 0, body: e.message }));
        if (data) req2.write(data);
        req2.end();
      });
    }

    // 1. GET recipe
    const getResult = await mealieReq('GET', `/recipes/${slug}`);
    results.get = { status: getResult.status };
    let recipe;
    try { recipe = JSON.parse(getResult.body); results.get.keys = Object.keys(recipe); }
    catch(e) { results.get.parseError = getResult.body.slice(0, 300); return res.json(results); }

    // 2. Try PATCH with only recipeIngredient (one dummy ingredient)
    const minimalIngredient = {
      quantity: 1,
      unit: null,
      food: { name: 'test-debug-ingredient' },
      note: '',
      isFood: true,
      disableAmount: false,
      display: '1 test-debug-ingredient',
      title: null,
      referenceId: '00000000-0000-4000-a000-000000000001'
    };

    const patch1 = await mealieReq('PATCH', `/recipes/${slug}`, {
      recipeIngredient: [minimalIngredient]
    });
    results.patch_minimal = { status: patch1.status, body: patch1.body.slice(0, 500) };

    // 3. If that fails, try PUT instead of PATCH
    if (patch1.status >= 400) {
      const put1 = await mealieReq('PUT', `/recipes/${slug}`, {
        ...recipe,
        recipeIngredient: [...(recipe.recipeIngredient || []), minimalIngredient]
      });
      results.put_full = { status: put1.status, body: put1.body.slice(0, 500) };
    }

    // 4. Try PATCH with just the name field to confirm PATCH works at all
    const patch2 = await mealieReq('PATCH', `/recipes/${slug}`, { name: recipe.name });
    results.patch_name_only = { status: patch2.status, body: patch2.body.slice(0, 200) };

    res.json(results);
  });
};
