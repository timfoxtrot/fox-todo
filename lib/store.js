import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const DATA_DIR = path.join(import.meta.dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'history.json');

let items = [];
let loaded = false;
let writing = Promise.resolve();

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    items = JSON.parse(await fs.readFile(FILE, 'utf8'));
    if (!Array.isArray(items)) items = [];
  } catch {
    items = []; // first run, or the file was removed
  }
}

function persist() {
  // Serialize writes so concurrent prints cannot corrupt the file.
  writing = writing.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(items, null, 2));
  }).catch((err) => {
    console.error('[store] could not save history:', err.message);
  });
  return writing;
}

export async function addItem(item) {
  await load();
  items.unshift(item);
  if (items.length > config.historyLimit) items.length = config.historyLimit;
  await persist();
  return item;
}

export async function listItems(limit = 25) {
  await load();
  return items.slice(0, limit);
}
