import zlib from 'node:zlib';

// A minimal PNG decoder: just enough to read logo files for thermal printing.
// Supports 8-bit grayscale / RGB / palette / grayscale+alpha / RGBA, non-interlaced.
// That covers the overwhelming majority of logo exports; anything else (16-bit,
// Adam7 interlacing) throws a clear error asking for a re-exported file rather
// than silently producing garbage.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }; // by color type

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Reverse PNG's per-scanline filtering in place. `raw` is one decompressed IDAT stream. */
function unfilter(raw, width, height, channels) {
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let rawOff = 0;
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOff++];
    const rowStart = y * stride;
    const prevRowStart = rowStart - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[rawOff++];
      const left = i >= channels ? out[rowStart + i - channels] : 0;
      const up = y > 0 ? out[prevRowStart + i] : 0;
      const upLeft = y > 0 && i >= channels ? out[prevRowStart + i - channels] : 0;
      let value;
      switch (filterType) {
        case 0: value = x; break;
        case 1: value = x + left; break;
        case 2: value = x + up; break;
        case 3: value = x + ((left + up) >> 1); break;
        case 4: value = x + paeth(left, up, upLeft); break;
        default: throw new Error(`Unsupported PNG filter type ${filterType}`);
      }
      out[rowStart + i] = value & 0xff;
    }
  }
  return out;
}

/** Decode a PNG buffer to straight (non-premultiplied) 8-bit RGBA. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file');

  let width, height, bitDepth, colorType, interlace;
  let palette = null, trns = null;
  const idatParts = [];

  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 8 + len + 4; // length + type + data + crc
  }

  if (width === undefined) throw new Error('Missing IHDR chunk');
  if (bitDepth !== 8) throw new Error(`Only 8-bit PNGs are supported (this one is ${bitDepth}-bit)`);
  if (interlace !== 0) throw new Error('Interlaced PNGs are not supported; re-export without interlacing');
  if (!(colorType in CHANNELS)) throw new Error(`Unsupported PNG color type ${colorType}`);

  const channels = CHANNELS[colorType];
  const inflated = zlib.inflateSync(Buffer.concat(idatParts));
  const pixels = unfilter(inflated, width, height, channels);

  // Expand to straight RGBA regardless of source color type.
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let p = 0, s = 0; p < width * height; p++, s += channels) {
    let r, g, b, a = 255;
    if (colorType === 0) { r = g = b = pixels[s]; }
    else if (colorType === 2) { r = pixels[s]; g = pixels[s + 1]; b = pixels[s + 2]; }
    else if (colorType === 4) { r = g = b = pixels[s]; a = pixels[s + 1]; }
    else if (colorType === 6) { r = pixels[s]; g = pixels[s + 1]; b = pixels[s + 2]; a = pixels[s + 3]; }
    else if (colorType === 3) {
      const idx = pixels[s];
      r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
      a = trns && idx < trns.length ? trns[idx] : 255;
    }
    const d = p * 4;
    rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = a;
  }

  return { width, height, rgba };
}
