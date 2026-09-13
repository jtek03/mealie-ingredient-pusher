'use strict';

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.getElementById('theme-icon').textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('mip-theme', theme);
}
function loadTheme() {
  const saved = localStorage.getItem('mip-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  setTheme(saved);
}

// ── Persistence ───────────────────────────────────────────────────────────────
function save() {
  localStorage.setItem('mip-url',   document.getElementById('mealie-url').value);
  localStorage.setItem('mip-token', document.getElementById('api-token').value);
  localStorage.setItem('mip-slug',  document.getElementById('recipe-slug').value);
}
function loadSaved() {
  document.getElementById('mealie-url').value  = localStorage.getItem('mip-url')   || '';
  document.getElementById('api-token').value   = localStorage.getItem('mip-token') || '';
  document.getElementById('recipe-slug').value = localStorage.getItem('mip-slug')  || '';
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  document.getElementById('pane-ingredients').style.display  = name === 'ingredients'  ? '' : 'none';
  document.getElementById('pane-instructions').style.display = name === 'instructions' ? '' : 'none';
}

// ── Ingredient parser ─────────────────────────────────────────────────────────
const UNITS = [
  'tablespoon','tablespoons','teaspoon','teaspoons',
  'tbsp','tsp','cup','cups','fl oz','oz','lb','lbs','g','kg','mg','ml','l','liter','liters',
  'leaves','leaf','cloves','clove','pinch','dash','bunch','bunches',
  'can','cans','slice','slices','piece','pieces','whole',
  'stalk','stalks','sprig','sprigs','head','heads','strip','strips'
];
const FRACTIONS = {'½':'1/2','¼':'1/4','¾':'3/4','⅓':'1/3','⅔':'2/3','⅛':'1/8','⅜':'3/8','⅝':'5/8'};

function evalFrac(str) {
  str = str.trim();
  for (const [k,v] of Object.entries(FRACTIONS)) str = str.split(k).join(v);
  if (/^\d+\s+\d+\/\d+$/.test(str)) {
    const [w, f] = str.split(/\s+/);
    return parseFloat(w) + evalFrac(f);
  }
  if (str.includes('/')) {
    const [n, d] = str.split('/');
    return Math.round((parseFloat(n) / parseFloat(d)) * 10000) / 10000;
  }
  return parseFloat(str) || 0;
}

function normLine(line) {
  for (const [k,v] of Object.entries(FRACTIONS)) line = line.split(k).join(v);
  return line.trim();
}

function parseIngredient(raw) {
  const line = normLine(raw);
  if (!line) return null;
  const QTY = '(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+\\.?\\d*)';
  const UR  = UNITS.join('|');
  let m;
  // "Food (qty unit)" e.g. "Thyme (1 tbsp)"
  m = line.match(new RegExp(`^(.+?)\\s*\\(${QTY}\\s*(${UR})\\.?s?\\)$`, 'i'));
  if (m) return { food: m[1].trim(), quantity: evalFrac(m[2]), unit: m[3].toLowerCase(), display: raw };
  // "Food (qty)" no unit
  m = line.match(/^(.+?)\s*\((\d[\d\s\/.]*)\s*\)$/);
  if (m) return { food: m[1].trim(), quantity: evalFrac(m[2]), unit: '', display: raw };
  // "qty unit Food" e.g. "1 tbsp Thyme"
  m = line.match(new RegExp(`^${QTY}\\s+(${UR})\\.?s?\\s+(.+)$`, 'i'));
  if (m) return { quantity: evalFrac(m[1]), unit: m[2].toLowerCase(), food: m[3].trim(), display: raw };
  // "qty Food" no unit
  m = line.match(new RegExp(`^${QTY}\\s+(.+)$`));
  if (m) return { quantity: evalFrac(m[1]), unit: '', food: m[2].trim(), display: raw };
  // Just a name
  return { quantity: 0, unit: '', food: line, display: raw };
}

function parseAllIngredients() {
  const lines = document.getElementById('raw-ingredients').value
    .split('\n').map(l => l.trim()).filter(Boolean);
  
  const result = [];
  for (const line of lines) {
    if (line.startsWith('#')) {
      // Section header — push as a title-only ingredient
      result.push({ isSection: true, title: line.replace(/^#+\s*/, '').trim(), display: line });
    } else {
      const parsed = parseIngredient(line);
      if (parsed) result.push(parsed);
    }
  }
  return result;
}

function parseAllInstructions() {
  return document.getElementById('raw-instructions').value
    .split('\n').map(l => l.trim()).filter(Boolean)
    .map(text => ({ id: uuidv4(), title: '', text, summary: '' }));
}

// ── Preview ───────────────────────────────────────────────────────────────────
function previewParse() {
  const parsed = parseAllIngredients();
  const area = document.getElementById('preview-area');
  if (!parsed.length) { area.innerHTML = ''; return; }
  const rows = parsed.map(p => {
    if (p.isSection) {
      return `<tr><td colspan="4" style="font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);padding-top:10px">${esc(p.title)}</td></tr>`;
    }
    return `<tr>
      <td>${esc(p.display)}</td>
      <td>${p.quantity > 0 ? p.quantity : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${p.unit ? esc(p.unit) : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td class="food">${esc(p.food) || '⚠ check'}</td>
    </tr>`;
  }).join('');
  area.innerHTML = `
    <div class="preview-wrap"><table>
      <thead><tr><th>Original</th><th>Qty</th><th>Unit</th><th>Food</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="hint" style="margin-top:8px">${parsed.length} ingredient${parsed.length !== 1 ? 's' : ''} parsed.</p>`;
}

// ── API helpers ───────────────────────────────────────────────────────────────
function getMealieHeaders() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Mealie-Url':   document.getElementById('mealie-url').value.replace(/\/$/, ''),
    'X-Mealie-Token': document.getElementById('api-token').value.trim()
  };
}

// ── Test connection ───────────────────────────────────────────────────────────
async function testConnection() {
  const btn    = document.getElementById('test-btn');
  const result = document.getElementById('test-result');
  const url    = document.getElementById('mealie-url').value.trim();
  const token  = document.getElementById('api-token').value.trim();

  if (!url || !token) { result.innerHTML = '<span class="test-err">Enter a URL and token first.</span>'; return; }

  btn.textContent = 'Testing…'; btn.disabled = true; result.innerHTML = '';
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
        ? '<span class="test-ok">✓ Connected to Mealie</span>'
        : `<span class="test-err">✗ HTTP ${res.status} — check your URL and token.</span>`;
    }
  } catch (e) {
    result.innerHTML = `<span class="test-err">✗ ${esc(e.message)}</span>`;
  }
  btn.textContent = 'Test connection'; btn.disabled = false;
}

// ── Push ──────────────────────────────────────────────────────────────────────
async function pushAll() {
  const slug       = document.getElementById('recipe-slug').value.trim().split('/').filter(Boolean).pop();
  const mealieUrl  = document.getElementById('mealie-url').value.replace(/\/$/, '');
  const token      = document.getElementById('api-token').value.trim();
  const doIngr     = document.getElementById('push-ingredients-cb').checked;
  const doInstr    = document.getElementById('push-instructions-cb').checked;
  const pushBtn    = document.getElementById('push-btn');

  if (!mealieUrl || !token || !slug) { alert('Fill in your Mealie URL, API token, and recipe slug first.'); return; }
  if (!doIngr && !doInstr)           { alert('Select at least Ingredients or Instructions.'); return; }

  const ingredients  = doIngr ? parseAllIngredients() : [];
  const instructions = doInstr ? parseAllInstructions() : [];

  if (doIngr && !ingredients.length)  { alert('No ingredients found — paste some in the Ingredients tab.'); return; }
  if (doInstr && !instructions.length) { alert('No instructions found — paste some in the Instructions tab.'); return; }

  pushBtn.disabled = true;
  pushBtn.textContent = 'Pushing…';

  const resultsCard = document.getElementById('results-card');
  const list        = document.getElementById('status-list');
  const summary     = document.getElementById('results-summary');
  list.innerHTML = '';
  resultsCard.style.display = 'block';
  resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  summary.textContent = 'Working…';

  try {
    const res  = await fetch('/push-ingredients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mealieUrl, token, slug, ingredients, instructions })
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      addResult('err', '✗', data.error || 'Unknown error', data.detail || '');
      summary.textContent = 'Failed';
    } else {
      if (data.ingredientsAdded  > 0) addResult('ok', '✓', `${data.ingredientsAdded} ingredient${data.ingredientsAdded !== 1 ? 's' : ''} added`);
      if (data.instructionsAdded > 0) addResult('ok', '✓', `${data.instructionsAdded} instruction step${data.instructionsAdded !== 1 ? 's' : ''} added`);

      const parts = [];
      if (data.ingredientsAdded  > 0) parts.push(`${data.ingredientsAdded} ingredient${data.ingredientsAdded !== 1 ? 's' : ''}`);
      if (data.instructionsAdded > 0) parts.push(`${data.instructionsAdded} step${data.instructionsAdded !== 1 ? 's' : ''}`);
      summary.textContent = parts.join(' + ') + ' added';

      const link = document.getElementById('recipe-link');
      link.href = `${mealieUrl}/r/${slug}`;
      link.style.display = 'inline-flex';
    }
  } catch (e) {
    addResult('err', '✗', e.message);
    summary.textContent = 'Failed';
  }

  pushBtn.disabled = false;
  pushBtn.textContent = 'Push to Mealie';
}

function addResult(cls, icon, text, detail) {
  const li = document.createElement('li');
  li.className = `status-item ${cls}`;
  li.innerHTML = `<em class="status-icon">${icon}</em><div><div>${esc(text)}</div>${detail ? `<div class="status-detail">${esc(detail)}</div>` : ''}</div>`;
  document.getElementById('status-list').appendChild(li);
}

function resetResults() {
  document.getElementById('results-card').style.display = 'none';
  document.getElementById('status-list').innerHTML = '';
  document.getElementById('raw-ingredients').value = '';
  document.getElementById('raw-instructions').value = '';
  document.getElementById('preview-area').innerHTML = '';
  document.getElementById('recipe-link').style.display = 'none';
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init — wire up all events here, no inline onclick in HTML ─────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadSaved();

  document.getElementById('theme-toggle-btn').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  ['mealie-url','api-token','recipe-slug'].forEach(id =>
    document.getElementById(id).addEventListener('input', save));

  document.getElementById('recipe-slug').addEventListener('blur', function () {
    const val = this.value.trim();
    if (val.includes('/')) { this.value = val.split('/').filter(Boolean).pop(); save(); }
  });

  // Tab switching
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('test-btn').addEventListener('click', testConnection);
  document.getElementById('preview-btn').addEventListener('click', previewParse);
  document.getElementById('push-btn').addEventListener('click', pushAll);
  document.getElementById('reset-btn').addEventListener('click', resetResults);
});
