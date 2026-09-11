'use strict';

// ── Persistence ──────────────────────────────────────────────────────────────
function save() {
  localStorage.setItem('mip-url', document.getElementById('mealie-url').value);
  localStorage.setItem('mip-token', document.getElementById('api-token').value);
  localStorage.setItem('mip-slug', document.getElementById('recipe-slug').value);
}

function load() {
  const url = localStorage.getItem('mip-url') || '';
  const token = localStorage.getItem('mip-token') || '';
  const slug = localStorage.getItem('mip-slug') || '';
  document.getElementById('mealie-url').value = url;
  document.getElementById('api-token').value = token;
  document.getElementById('recipe-slug').value = slug;
}

['mealie-url','api-token','recipe-slug'].forEach(id => {
  document.getElementById(id).addEventListener('input', save);
});

// ── Slug extraction ───────────────────────────────────────────────────────────
document.getElementById('recipe-slug').addEventListener('blur', function () {
  const val = this.value.trim();
  if (val.includes('/')) {
    const parts = val.split('/').filter(Boolean);
    this.value = parts[parts.length - 1];
    save();
  }
});

// ── Ingredient parser ─────────────────────────────────────────────────────────
const UNITS = [
  'tablespoon','tablespoons','teaspoon','teaspoons',
  'tbsp','tsp','cup','cups','fl oz','oz','lb','lbs','g','kg','mg','ml','l','liter','liters',
  'leaves','leaf','cloves','clove','pinch','dash','bunch','bunches',
  'can','cans','slice','slices','piece','pieces','whole',
  'stalk','stalks','sprig','sprigs','head','heads','strip','strips'
];

const FRACTION_MAP = { '½':'1/2','¼':'1/4','¾':'3/4','⅓':'1/3','⅔':'2/3','⅛':'1/8','⅜':'3/8','⅝':'5/8' };

function evalFrac(str) {
  str = str.trim();
  for (const [k,v] of Object.entries(FRACTION_MAP)) str = str.split(k).join(v);
  if (/^\d+\s+\d+\/\d+$/.test(str)) {
    const [whole, frac] = str.split(/\s+/);
    return parseFloat(whole) + evalFrac(frac);
  }
  if (str.includes('/')) {
    const [n, d] = str.split('/');
    return Math.round((parseFloat(n) / parseFloat(d)) * 10000) / 10000;
  }
  return parseFloat(str) || 0;
}

function normalise(line) {
  for (const [k,v] of Object.entries(FRACTION_MAP)) line = line.split(k).join(v);
  return line.trim();
}

function parseIngredient(raw) {
  const line = normalise(raw);
  if (!line) return null;

  const QTY = '(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+\\.?\\d*)';
  const UNIT_RE = UNITS.join('|');

  let m;

  // "Food Name (qty unit)" — e.g. "Thyme (1 tbsp)" or "Ground Pork (1lb)"
  m = line.match(new RegExp(`^(.+?)\\s*\\(${QTY}\\s*(${UNIT_RE})\\.?s?\\)$`, 'i'));
  if (m) return { food: m[1].trim(), quantity: evalFrac(m[2]), unit: m[3].toLowerCase(), display: raw };

  // "Food Name (qty)" — no unit
  m = line.match(/^(.+?)\s*\((\d[\d\s\/.]*)\s*\)$/);
  if (m) return { food: m[1].trim(), quantity: evalFrac(m[2]), unit: '', display: raw };

  // "qty unit Food" — e.g. "1 tbsp Thyme"
  m = line.match(new RegExp(`^${QTY}\\s+(${UNIT_RE})\\.?s?\\s+(.+)$`, 'i'));
  if (m) return { quantity: evalFrac(m[1]), unit: m[2].toLowerCase(), food: m[3].trim(), display: raw };

  // "qty Food" — no unit
  m = line.match(new RegExp(`^${QTY}\\s+(.+)$`));
  if (m) return { quantity: evalFrac(m[1]), unit: '', food: m[2].trim(), display: raw };

  // Just a name
  return { quantity: 0, unit: '', food: line, display: raw };
}

function parseAll() {
  const raw = document.getElementById('raw-ingredients').value;
  return raw.split('\n').map(l => l.trim()).filter(Boolean).map(parseIngredient).filter(Boolean);
}

// ── Preview ───────────────────────────────────────────────────────────────────
function previewParse() {
  const parsed = parseAll();
  const area = document.getElementById('preview-area');
  if (!parsed.length) { area.innerHTML = ''; return; }

  const rows = parsed.map(p => {
    const qtyOk = p.quantity > 0;
    const foodClass = p.food ? 'food' : 'warn';
    return `<tr>
      <td>${esc(p.display)}</td>
      <td>${qtyOk ? p.quantity : '<span style="color:#9E9E9E">—</span>'}</td>
      <td>${p.unit ? esc(p.unit) : '<span style="color:#9E9E9E">—</span>'}</td>
      <td class="${foodClass}">${esc(p.food) || '⚠ check this'}</td>
    </tr>`;
  }).join('');

  area.innerHTML = `
    <div class="preview-wrap">
      <table>
        <thead><tr><th>Original</th><th>Qty</th><th>Unit</th><th>Food</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:8px">${parsed.length} ingredient${parsed.length !== 1 ? 's' : ''} parsed. Check the Food column before pushing.</p>`;
}

// ── API helpers ───────────────────────────────────────────────────────────────
function getMealieHeaders() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Mealie-Url': document.getElementById('mealie-url').value.replace(/\/$/, ''),
    'X-Mealie-Token': document.getElementById('api-token').value.trim()
  };
}

async function testConnection() {
  const btn = document.getElementById('test-btn');
  const label = document.getElementById('test-label');
  const result = document.getElementById('test-result');

  const url = document.getElementById('mealie-url').value.trim();
  const token = document.getElementById('api-token').value.trim();
  if (!url || !token) {
    result.innerHTML = '<span class="test-err">Enter a URL and token first.</span>';
    return;
  }

  label.textContent = 'Testing…';
  btn.disabled = true;
  result.innerHTML = '';

  try {
    // Try v1 path first, then fallback to older path
    let res = await fetch('/mealie-api/users/self', { headers: getMealieHeaders() });
    if (res.status === 404) {
      res = await fetch('/mealie-api/user/self', { headers: getMealieHeaders() });
    }
    if (res.ok) {
      const data = await res.json();
      result.innerHTML = `<span class="test-ok">✓ Connected as ${esc(data.fullName || data.username || data.email || 'user')}</span>`;
    } else if (res.status === 401 || res.status === 403) {
      result.innerHTML = `<span class="test-err">✗ HTTP ${res.status} — token invalid or expired.</span>`;
    } else if (res.status === 404) {
      // 404 on user endpoint might just mean different Mealie version — try a recipes ping
      const res2 = await fetch('/mealie-api/recipes?page=1&perPage=1', { headers: getMealieHeaders() });
      if (res2.ok) {
        result.innerHTML = `<span class="test-ok">✓ Connected to Mealie successfully</span>`;
      } else {
        result.innerHTML = `<span class="test-err">✗ HTTP ${res2.status} — check your Mealie URL.</span>`;
      }
    } else {
      result.innerHTML = `<span class="test-err">✗ HTTP ${res.status} — check your URL and token.</span>`;
    }
  } catch (e) {
    result.innerHTML = `<span class="test-err">✗ ${esc(e.message)}</span>`;
  }

  label.textContent = 'Test connection';
  btn.disabled = false;
}

// ── Push ──────────────────────────────────────────────────────────────────────
async function pushAll() {
  const slug = document.getElementById('recipe-slug').value.trim().split('/').filter(Boolean).pop();
  const errEl = document.getElementById('preview-area');
  const pushBtn = document.getElementById('push-btn');

  if (!document.getElementById('mealie-url').value.trim() ||
      !document.getElementById('api-token').value.trim() || !slug) {
    errEl.innerHTML = '<p style="color:#E53935;font-size:13px;margin-top:8px">Fill in connection details and a recipe slug first.</p>';
    return;
  }

  const parsed = parseAll();
  if (!parsed.length) {
    errEl.innerHTML = '<p style="color:#E53935;font-size:13px;margin-top:8px">No ingredients found — paste some ingredients first.</p>';
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

  // Build list items first so user sees progress
  const items = parsed.map(p => {
    const li = document.createElement('li');
    li.className = 'status-item pending';
    li.innerHTML = `<span class="status-icon">⏳</span><div><div>${esc(p.display)}</div></div>`;
    list.appendChild(li);
    return { ingredient: p, el: li };
  });

  let ok = 0, fail = 0;

  for (let i = 0; i < items.length; i++) {
    const { ingredient: ing, el } = items[i];
    summary.textContent = `${i + 1} / ${items.length}`;

    try {
      const body = {
        quantity: ing.quantity,
        unit: ing.unit ? { name: ing.unit } : null,
        food: { name: ing.food },
        note: '',
        isFood: true,
        disableAmount: ing.quantity === 0,
        display: ''
      };

      const res = await fetch(`/mealie-api/recipes/${slug}/ingredient`, {
        method: 'POST',
        headers: getMealieHeaders(),
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${txt ? ': ' + txt.slice(0, 120) : ''}`);
      }

      el.className = 'status-item ok';
      const detail = [ing.quantity || '', ing.unit || '', ing.food].filter(Boolean).join(' ');
      el.innerHTML = `<span class="status-icon">✓</span><div><div>${esc(ing.display)}</div><div class="status-detail">${esc(detail)}</div></div>`;
      ok++;
    } catch (e) {
      el.className = 'status-item err';
      el.innerHTML = `<span class="status-icon">✗</span><div><div>${esc(ing.display)}</div><div class="status-detail">${esc(e.message)}</div></div>`;
      fail++;
    }
  }

  summary.textContent = `${ok} added${fail ? ', ' + fail + ' failed' : ''}`;
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
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Init
load();
