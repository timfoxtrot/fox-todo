import express from 'express';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { config, CATEGORIES, DEFAULT_LOGO } from './config.js';
import { sendToPrinter, readPrinterStatus } from './lib/printer.js';
import { renderTodo, renderTestSlip } from './lib/todo.js';
import { addItem, listItems } from './lib/store.js';

const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(import.meta.dirname, 'public')));

const MAX_TASK = 240;
const MAX_NOTES = 500;
const MAX_NAME = 32;
const PRIORITIES = new Set(['low', 'normal', 'high']);
const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));

// Light rate limit: a shared LAN page should not be able to empty the paper roll.
const hits = new Map();
function rateLimited(ip, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) hits.clear();
  return recent.length > limit;
}

function validate(body) {
  const task = String(body.task ?? '').trim();
  if (!task) return { error: 'A task is required.' };
  if (task.length > MAX_TASK) return { error: `Keep the task under ${MAX_TASK} characters.` };

  const notes = String(body.notes ?? '').trim();
  if (notes.length > MAX_NOTES) return { error: `Keep notes under ${MAX_NOTES} characters.` };

  const addedBy = String(body.addedBy ?? '').trim().slice(0, MAX_NAME);
  const priority = PRIORITIES.has(body.priority) ? body.priority : 'normal';
  const category = CATEGORY_KEYS.has(body.category) ? body.category : null;

  return { value: { task, notes, addedBy, priority, category } };
}

app.get('/api/status', async (_req, res) => {
  res.json(await readPrinterStatus());
});

function logoUrl(file) {
  const exists = fs.existsSync(path.join(import.meta.dirname, 'public', 'logos', file));
  return exists ? `/logos/${file}` : null;
}

app.get('/api/categories', (_req, res) => {
  const categories = CATEGORIES.map((c) => ({ key: c.key, label: c.label, logo: logoUrl(c.logo) }));
  res.json({ categories, defaultLogo: logoUrl(DEFAULT_LOGO.logo) });
});

app.get('/api/history', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  res.json({ items: await listItems(limit) });
});

app.post('/api/print', async (req, res) => {
  if (rateLimited(req.ip)) {
    return res.status(429).json({ error: 'Too many prints in the last minute. Give it a moment.' });
  }

  const { error, value } = validate(req.body || {});
  if (error) return res.status(400).json({ error });

  const printedAt = new Date();
  try {
    await sendToPrinter(renderTodo({ ...value, printedAt }));
  } catch (err) {
    console.error('[print] failed:', err.message);
    return res.status(502).json({ error: err.message });
  }

  const item = {
    id: randomUUID(),
    ...value,
    printedAt: printedAt.toISOString(),
  };
  await addItem(item);
  res.status(201).json({ item });
});

app.post('/api/test', async (_req, res) => {
  try {
    await sendToPrinter(renderTestSlip());
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

app.listen(config.port, config.host, () => {
  console.log(`Fox Todo -> printer ${config.printerHost}:${config.printerPort} (${config.columns} cols)`);
  console.log(`  local:   http://localhost:${config.port}`);
  for (const addr of lanAddresses()) {
    console.log(`  network: http://${addr}:${config.port}`);
  }
});
