// Minimal ESC/POS builder. Enough for text receipts on a Rongta/Epson-compatible
// thermal printer; no external dependencies.

const ESC = 0x1b;
const GS = 0x1d;

// CP437 high range (0x80-0xFF), which is what the printer expects after ESC t 0.
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

// Characters a browser will happily send that have no CP437 equivalent.
const TRANSLITERATE = new Map(Object.entries({
  '‘': "'", '’': "'", '‚': ',', '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '–': '-', '—': '--', '―': '-', '−': '-',
  '…': '...', '•': '*', ' ': ' ', ' ': ' ',
  '​': '', '→': '->', '←': '<-', '✓': 'v',
  '€': 'EUR', '™': '(TM)',
}));

/** Encode a JS string to a CP437 Buffer, dropping what cannot be represented. */
export function encodeCp437(text) {
  const out = [];
  for (const ch of text.normalize('NFC')) {
    if (TRANSLITERATE.has(ch)) {
      for (const c of TRANSLITERATE.get(ch)) out.push(c.charCodeAt(0));
      continue;
    }
    const code = ch.codePointAt(0);
    if (code === 0x0a || code === 0x0d) { out.push(code); continue; }
    if (code >= 0x20 && code <= 0x7e) { out.push(code); continue; }
    const high = CP437_HIGH.indexOf(ch);
    if (high !== -1) { out.push(0x80 + high); continue; }
    // Strip emoji and anything else unrepresentable rather than printing noise.
    if (code > 0x7e) continue;
  }
  return Buffer.from(out);
}

/** Split on newlines, tolerating CRLF input. */
export function splitLines(text) {
  return String(text).split(/\r?\n/);
}

/**
 * Word-wrap to `width` columns. Long unbroken tokens (URLs) are hard-split so
 * they never silently overflow and get clipped by the printer.
 */
export function wrap(text, width) {
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    if (paragraph.trim() === '') { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      let w = word;
      while (w.length > width) {
        if (line) { lines.push(line); line = ''; }
        lines.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ' ' + w;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Chainable ESC/POS document builder. */
export class Receipt {
  constructor({ columns = 48 } = {}) {
    this.columns = columns;
    this.chunks = [];
  }

  raw(...bytes) { this.chunks.push(Buffer.from(bytes)); return this; }

  /** ESC @ - reset, then ESC t 0 to select CP437. */
  init() { return this.raw(ESC, 0x40).raw(ESC, 0x74, 0x00); }

  /** 0 = left, 1 = center, 2 = right. */
  align(n) { return this.raw(ESC, 0x61, n); }

  bold(on = true) { return this.raw(ESC, 0x45, on ? 1 : 0); }

  underline(on = true) { return this.raw(ESC, 0x2d, on ? 1 : 0); }

  /** GS ! - width/height multipliers, 1..8 each. */
  size(width = 1, height = 1) {
    const w = Math.min(8, Math.max(1, width)) - 1;
    const h = Math.min(8, Math.max(1, height)) - 1;
    return this.raw(GS, 0x21, (w << 4) | h);
  }

  /** Width-aware text: wraps against the current character scale. */
  text(value, { scale = 1 } = {}) {
    const width = Math.max(1, Math.floor(this.columns / scale));
    for (const line of wrap(value, width)) {
      this.chunks.push(encodeCp437(line));
      this.chunks.push(Buffer.from([0x0a]));
    }
    return this;
  }

  /**
   * Emit a line verbatim: no word-wrapping, no whitespace collapsing. Use for
   * pre-formatted content (tick boxes, aligned art) where spacing is the point.
   */
  pre(value) {
    const width = this.columns;
    for (const line of splitLines(value)) {
      this.chunks.push(encodeCp437(line.slice(0, width)));
      this.chunks.push(Buffer.from([0x0a]));
    }
    return this;
  }

  line(char = '-') {
    this.chunks.push(encodeCp437(char.repeat(this.columns)));
    this.chunks.push(Buffer.from([0x0a]));
    return this;
  }

  /** Left text and right text on one row, padded apart. */
  columnsRow(left, right) {
    const l = String(left);
    const r = String(right);
    const gap = Math.max(1, this.columns - l.length - r.length);
    this.chunks.push(encodeCp437(l + ' '.repeat(gap) + r));
    this.chunks.push(Buffer.from([0x0a]));
    return this;
  }

  feed(lines = 1) { return this.raw(ESC, 0x64, lines); }

  /** Append pre-built GS v 0 raster image bytes (see lib/raster.js). */
  image(rasterBytes) {
    if (rasterBytes) this.chunks.push(rasterBytes);
    return this;
  }

  /** GS V 66 n - partial cut after feeding n dots. Ignored if no cutter. */
  cut(feed = 3) { return this.raw(GS, 0x56, 0x42, feed); }

  build() { return Buffer.concat(this.chunks); }
}
