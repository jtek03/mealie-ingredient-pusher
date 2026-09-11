'use strict';

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Persistence ───────────────────────────────────────────────────────────────
function save() {
  localStorage.setItem('mip-url', document.getElementById('mealie-url').value);
  localStorage.setItem('mip-token', document.getElementById('api-token').value);
  localStorage.setItem('mip-slug', document.getElementById('recipe-slug').value);
}
function load() {
  document.getElementById('mealie-url').value = localStorage.getItem('mip-url') || '';
  document.getElementById('api-token').value = localStorage.getItem('mip-token') || '';
  document.getElementById('recipe-slug').value = localStorage.getItem('mip-slug') || '';
}
['mealie-url','api-token','recipe-slug'].forEach(id =>
  document.getElementById(id).addEventListener('input', save));
document.getElementById('recipe-slug').addEventListener('blur', function () {
  const val = this.value.trim();
  if (val.includes('/')) { this.value = val.split('/').filter(Boolean).pop(); save(); }
});

// ── Parser ────────────────────────────────────────────────────────────────────
const UNITS = [
  'tablespoon','tablespoons','teaspoon','teaspoons',
  'tbsp','tsp','cup','cups','fl oz','oz','lb','lbs','g','kg','mg','ml','l','liter','liters',
  'leaves','leaf','cloves','clove','pinch','dash','bunch','bunches',
  'can','cans','slice','slices','piece','pieces','whole',
  'stalk','stalks','sprig','sprigs','head','heads','strip','strips'
];
const FRACTION_MAP = {'½':'1/2','¼':'1/4','¾':'3/4','⅓':'1/3','⅔':'2/3','⅛':'1/8','⅜':'3/8','⅝':'5/8'};

function evalFrac(str) {
  str = str.trim();
  for (const [k,v] of Object.entries(FRACTION_MAP)) str = str.split(k).join(v);
  if (/^\d+\s+\d+\/\d+$/.test(str)) {
    const [w, f] = str.split(/\s+/);
    return parseFloat(w) + evalFrac(f);
  }
  if (str.includes('/')) { const [n,d] = str.split('/'); return Math.round((parseFloat(n)/parseFloat(d))*10000)/10000; }
  return parseFloat(str) || 0;
}
function norm(line) {
  for (const [k,v] of Object.entries(FRACTION_MAP)) line = line.split(k).join(v);
  return line.trim();
}
function parseIngredient(raw) {
  const line = norm(raw);
  if (!line) return null;
  const QTY = '(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+\\.?\\d*)';
  const UR = UNITS.join('|');
  let m;
  m = line.match(new RegExp(`^(.+?)\\s*\\(${QTY}\\s*(${UR})\\.?s?\\)$`,'i'));
  if (m) return { food: m[1].trim(), quantity: evalFrac(m[2]), unit: m[3].toLowerCase(), display: raw };
  m = line.match(/^(.+?)\s*\((\d[\d\s\/.]*)\s*\)$/);
  if (m) return { food: m[1].trim(), quantity: evalFrac(m[2]), unit: '', display: raw };
  m = line.match(new RegExp(`^${QTY}\\s+(${UR})\\.?s?\\s+(.+)$`,'i'));
  if (m) return { quantity: evalFrac(m[1]), unit: m[2].toLowerCase(), food: m[3].trim(), display: raw };
  m = line.match(new RegExp(`^${QTY}\\s+(.+)$`));
  if (m) return { quantity: evalFrac(m[1]), unit: '', food: m[2].trim(), display: raw };
  return { quantity: 0, unit: '', food: line, display: raw };
}
function parseAll() {
  return document.getElementById('raw-ingredients').value
    .split('\n').map(l => l.trim()).filter(Boolean)
    .map(parseIngredient).filter(Boolean);
}

// ── Preview ───────────────────────────────────────────────────────────────────
function previewParse() {
  const parsed = parseAll();
  const area = document.getElementById('preview-area');
  if (!parsed.length) { area.innerHTML = ''; return; }
  const rows = parsed.map(p => `<tr>
    <td>${esc(p.display)}</td>
    <td>${p.quantity > 0 ? p.quantity : '<span style="color:#9E9E9E">—</span>'}</td>
    <td>${p.unit ? esc(p.unit) : '<span style="color:#9E9E9E">—</span>'}</td>
    <td class="food">${esc(p.food) || '⚠ check'}</td>
  </tr>`).join('');
  area.innerHTML = `
    <div class="preview-wrap"><table>
      <thead><tr><th>Original</th><th>Qty</th><th>Unit</th><th>Food</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="hint" style="margin-top:8px">${parsed.length} ingredient${parsed.length!==1?'s':''} parsed. Check the Food column before pushing.</p>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMealieHeaders() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Mealie-Url': document.getElementById('mealie-url').value.replace(/\/$/, ''),
    'X-Mealie-Token': document.getElementById('api-token').value.trim()
  };
}

// ── Test connection ───────────────────────────────────────────────────────────
async function testConnection() {
  const btn = document.getElementById('test-btn');
  const label = document.getElementById('test-label');
  const result = document.getElementById('test-result');
  if (!document.getElementById('mealie-url').value.trim() || !document.getElementById('api-token').value.trim()) {
    result.innerHTML = '<span class="test-err">Enter a URL and token first.</span>'; return;
  }
  label.textContent = 'Testing…'; btn.disabled = true; result.innerHTML = '';
  try {
    let res = await fetch('/mealie-api/users/self', { headers: getMealieHeaders() });
    if (res.status === 404) res = await fetch('/mealie-api/user/self', { headers: getMealieHeaders() });
    if (res.ok) {
      const data = await res.json();
      result.innerHTML = `<span class="test-ok">✓ Connected as ${esc(data.fullName || data.username || data.email || 'user')}</span>`;
    } else if (res.status === 401 || res.status === 403) {
      result.innerHTML = `<span class="test-err">✗ HTTP ${res.status} — token invalid or expired.</span>`;
    } else {
      const r2 = await fetch('/mealie-api/recipes?page=1&perPage=1', { headers: getMealieHeaders() });
      result.innerHTML = r2.ok
        ? `<span class="test-ok">✓ Connected to Mealie</span>`
        : `<span class="test-err">✗ HTTP ${res.status} — check your URL and token.</span>`;
    }
  } catch (e) { result.innerHTML = `<span class="test-err">✗ ${esc(e.message)}</span>`; }
  label.textContent = 'Test connection'; btn.disabled = false;
}

// ── Push — via server-side /push-ingredients endpoint ────────────────────────
async function pushAll() {
  const slug = document.getElementById('recipe-slug').value.trim().split('/').filter(Boolean).pop();
  const mealieUrl = document.getElementById('mealie-url').value.replace(/\/$/, '');
  const token = document.getElementById('api-token').value.trim();
  const pushBtn = document.getElementById('push-btn');
  const previewArea = document.getElementById('preview-area');

  if (!mealieUrl || !token || !slug) {
    previewArea.innerHTML = '<p style="color:#E53935;font-size:13px;margin-top:8px">Fill in connection details and a recipe slug first.</p>';
    return;
  }
  const parsed = parseAll();
  if (!parsed.length) {
    previewArea.innerHTML = '<p style="color:#E53935;font-size:13px;margin-top:8px">No ingredients found — paste some first.</p>';
    return;
  }

  pushBtn.disabled = true;
  pushBtn.textContent = 'Pushing…';

  const resultsCard = document.getElementById('results-card');
  const list = document.getElementById('status-list');
  const summary = document.getElementById('results-summary');
  list.innerHTML = '';
  resultsCard.style.display = 'block';
  resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    summary.textContent = 'Sending to Mealie…';

    const res = await fetch('/push-ingredients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mealieUrl, token, slug, ingredients: parsed })
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      const li = document.createElement('li');
      li.className = 'status-item err';
      li.innerHTML = `<span class="status-icon">✗</span><div>${esc(data.error || 'Unknown error')}<div class="status-detail">${esc(data.detail || '')}</div></div>`;
      list.appendChild(li);
      summary.textContent = 'Failed';
    } else {
      parsed.forEach(p => {
        const li = document.createElement('li');
        li.className = 'status-item ok';
        const detail = [p.quantity || '', p.unit || '', p.food].filter(Boolean).join(' ');
        li.innerHTML = `<span class="status-icon">✓</span><div><div>${esc(p.display)}</div><div class="status-detail">→ ${esc(detail)}</div></div>`;
        list.appendChild(li);
      });
      summary.textContent = `${data.added} ingredient${data.added !== 1 ? 's' : ''} added`;
    }
  } catch (e) {
    const li = document.createElement('li');
    li.className = 'status-item err';
    li.innerHTML = `<span class="status-icon">✗</span><div>${esc(e.message)}</div>`;
    list.appendChild(li);
    summary.textContent = 'Failed';
  }

  pushBtn.disabled = false;
  pushBtn.textContent = 'Push to Mealie';
}

function resetResults() {
  document.getElementById('results-card').style.display = 'none';
  document.getElementById('status-list').innerHTML = '';
  document.getElementById('raw-ingredients').value = '';
  document.getElementById('preview-area').innerHTML = '';
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
load();
