import fs from 'node:fs';
import path from 'node:path';
import { decodePng } from './png.js';
import { toEscposRaster } from './raster.js';
import { config, CATEGORIES, DEFAULT_LOGO } from '../config.js';

const DEFAULT_KEY = '__default__';

const LOGO_DIR = path.join(import.meta.dirname, '..', 'public', 'logos');

// Rasterized logo bytes rarely change at runtime, so decode/dither once per
// category and reuse the ESC/POS bytes on every print. Keyed by category key;
// a missing or broken logo file caches `null` so we don't retry every print.
const cache = new Map();

function loadRaster(category) {
  const file = path.join(LOGO_DIR, category.logo);
  try {
    const png = decodePng(fs.readFileSync(file));
    return toEscposRaster(png, config.logoWidth, { lighten: category.lighten ?? 0 });
  } catch (err) {
    const reason = err.code === 'ENOENT' ? 'no logo file yet' : err.message;
    console.warn(`[logos] ${category.key}: ${reason} (${file})`);
    return null;
  }
}

/** ESC/POS raster bytes for a category's logo, or null if it has none. */
export function getLogoRaster(categoryKey) {
  if (cache.has(categoryKey)) return cache.get(categoryKey);
  const category = CATEGORIES.find((c) => c.key === categoryKey);
  const raster = category ? loadRaster(category) : null;
  cache.set(categoryKey, raster);
  return raster;
}

/** ESC/POS raster bytes for the plain "TO DO" header logo, or null if none is set. */
export function getDefaultLogoRaster() {
  if (cache.has(DEFAULT_KEY)) return cache.get(DEFAULT_KEY);
  const raster = DEFAULT_LOGO?.logo ? loadRaster({ key: DEFAULT_KEY, ...DEFAULT_LOGO }) : null;
  cache.set(DEFAULT_KEY, raster);
  return raster;
}

export function findCategory(key) {
  return CATEGORIES.find((c) => c.key === key) || null;
}

/** Clears the raster cache so replaced logo files are picked up without a restart. */
export function clearLogoCache() {
  cache.clear();
}
