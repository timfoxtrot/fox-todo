const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the server. Is `npm start` running?");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error (HTTP ${res.status})`);
  return data;
}

function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.classList.add('hide'), 2600);
  setTimeout(() => el.remove(), 3000);
}
const showError = (err) => toast(err.message || String(err), 'error');

// ---------- Theme: Auto (follow the system) → Light → Dark, same as the other apps ----------
const THEME_KEY = 'receipttodo:theme';
const THEME_ICONS = {
  auto: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  dark: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 10A6 6 0 0 1 6 2.5a6 6 0 1 0 7.5 7.5z" fill="currentColor"/></svg>',
};
function applyTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const label = theme[0].toUpperCase() + theme.slice(1);
  $('#themeBtn').innerHTML = `${THEME_ICONS[theme]}<span>${label}</span>`;
  $('#themeBtn').title = `Theme: ${label}. Click to change.`;
}
let theme = 'auto';
try { theme = localStorage.getItem(THEME_KEY) || 'auto'; } catch {}
$('#themeBtn').addEventListener('click', () => {
  theme = { auto: 'light', light: 'dark', dark: 'auto' }[theme] || 'auto';
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  applyTheme(theme);
});
applyTheme(theme);

// ---------- Remember the name locally so a shared page doesn't ask every time ----------
const NAME_KEY = 'receipttodo:name';
const addedByEl = $('#addedBy');
try {
  const saved = localStorage.getItem(NAME_KEY);
  if (saved) addedByEl.value = saved;
} catch { /* private mode, blocked storage - not important */ }
addedByEl.addEventListener('change', () => {
  try { localStorage.setItem(NAME_KEY, addedByEl.value.trim()); } catch {}
});

// ---------- Priority segmented control ----------
const prioritySeg = $('#prioritySeg');
let priority = 'normal';
prioritySeg.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-priority]');
  if (!btn) return;
  priority = btn.dataset.priority;
  $$('button', prioritySeg).forEach((b) => b.classList.toggle('on', b === btn));
});

// ---------- Category picker ----------
let categories = []; // loaded from /api/categories: [{ key, label, logo }]
let defaultLogo = null; // printed on a plain "TO DO" slip, if one is configured
let category = null;
const categoryGrid = $('#categoryGrid');

function categoryThumb(cat) {
  return cat?.logo ? `<img src="${esc(cat.logo)}" alt="">` : esc(cat ? cat.label.slice(0, 2).toUpperCase() : '—');
}

function renderCategoryGrid() {
  const tiles = [{ key: null, label: 'None', logo: defaultLogo }, ...categories];
  categoryGrid.innerHTML = tiles.map((cat) => `
    <button type="button" class="category-tile${cat.key === category ? ' on' : ''}" data-category="${esc(cat.key ?? '')}">
      <span class="thumb${cat.logo ? '' : ' empty'}">${categoryThumb(cat)}</span>
      <span>${esc(cat.label)}</span>
    </button>`).join('');
}

categoryGrid.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-category]');
  if (!btn) return;
  category = btn.dataset.category || null;
  $$('.category-tile', categoryGrid).forEach((b) => b.classList.toggle('on', b === btn));
});

async function loadCategories() {
  try {
    const data = await api('/api/categories');
    categories = data.categories;
    defaultLogo = data.defaultLogo;
  } catch {
    categories = [];
    defaultLogo = null;
  }
  renderCategoryGrid();
}

// ---------- Task counter ----------
const taskEl = $('#task');
const taskCount = $('#taskCount');
taskEl.addEventListener('input', () => { taskCount.textContent = taskEl.value.length; });

// ---------- Printer status chip ----------
const statusBtn = $('#status');
const statusText = $('#statusText');

function describeStatus(s) {
  if (!s.reachable) return { state: 'bad', text: `Printer offline (${s.host})` };
  if (s.paperEnd) return { state: 'bad', text: 'Out of paper' };
  if (s.coverOpen) return { state: 'bad', text: 'Cover is open' };
  if (s.cutterError) return { state: 'bad', text: 'Cutter jam' };
  if (s.offline) return { state: 'bad', text: 'Printer off-line' };
  if (s.paperNearEnd) return { state: 'warn', text: 'Paper running low' };
  return { state: 'ok', text: `Printer ready (${s.host})` };
}

async function loadStatus() {
  statusBtn.className = 'chip';
  statusText.textContent = 'Checking printer…';
  try {
    const s = await api('/api/status');
    const { state, text } = describeStatus(s);
    statusBtn.className = `chip ${state}`;
    statusText.textContent = text;
    $('#printerAddr').textContent = `${s.host}:${s.port}`;
  } catch {
    statusBtn.className = 'chip bad';
    statusText.textContent = 'Cannot reach server';
  }
}
statusBtn.addEventListener('click', loadStatus);

// ---------- History table ----------
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

function categoryCell(key) {
  const cat = categories.find((c) => c.key === key);
  if (!cat) return '<span class="muted">—</span>';
  return `<span class="cat-cell"><span class="thumb">${categoryThumb(cat)}</span>${esc(cat.label)}</span>`;
}

function historyRow(item) {
  const notes = item.notes ? `<span class="notes">${esc(item.notes)}</span>` : '';
  return `<tr>
    <td class="task">${esc(item.task)}${notes}</td>
    <td>${categoryCell(item.category)}</td>
    <td class="who">${esc(item.addedBy) || '<span class="muted">—</span>'}</td>
    <td><span class="pill pill-${item.priority}">${esc(item.priority)}</span></td>
    <td class="date">${timeAgo(item.printedAt)}</td>
  </tr>`;
}

async function loadHistory() {
  const table = $('#history');
  try {
    const { items } = await api('/api/history?limit=25');
    if (items.length === 0) {
      table.innerHTML = `<tbody><tr class="empty-row"><td>Nothing printed yet.</td></tr></tbody>`;
      return;
    }
    table.innerHTML = `
      <thead><tr><th>Task</th><th>Category</th><th class="who">From</th><th>Priority</th><th>Printed</th></tr></thead>
      <tbody>${items.map(historyRow).join('')}</tbody>`;
  } catch {
    table.innerHTML = `<tbody><tr class="empty-row"><td>Could not load history.</td></tr></tbody>`;
  }
}
$('#refresh').addEventListener('click', loadHistory);

// ---------- Form submit ----------
const form = $('#form');
const submitBtn = $('#submit');
const testBtn = $('#testBtn');
const notesEl = $('#notes');

// Ctrl+Enter (Cmd+Enter on Mac) prints from anywhere in the form, including
// mid-textarea where plain Enter is busy inserting a newline.
form.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  if (!submitBtn.disabled) form.requestSubmit();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const task = taskEl.value.trim();
  if (!task) { taskEl.focus(); return toast('Type a task first.', 'error'); }

  submitBtn.disabled = true;
  testBtn.disabled = true;
  submitBtn.textContent = 'Printing…';

  try {
    await api('/api/print', {
      method: 'POST',
      body: { task, notes: notesEl.value, addedBy: addedByEl.value, priority, category },
    });
    toast('Printed.');
    taskEl.value = '';
    notesEl.value = '';
    taskCount.textContent = '0';
    taskEl.focus();
    loadHistory();
  } catch (err) {
    showError(err);
    loadStatus();
  } finally {
    submitBtn.disabled = false;
    testBtn.disabled = false;
    submitBtn.textContent = 'Print it';
  }
});

testBtn.addEventListener('click', async () => {
  testBtn.disabled = true;
  submitBtn.disabled = true;
  try {
    await api('/api/test', { method: 'POST' });
    toast('Test slip sent.');
  } catch (err) {
    showError(err);
  } finally {
    testBtn.disabled = false;
    submitBtn.disabled = false;
    loadStatus();
  }
});

loadStatus();
loadCategories().then(loadHistory); // history rows need category labels/logos to render
setInterval(loadStatus, 30_000);
