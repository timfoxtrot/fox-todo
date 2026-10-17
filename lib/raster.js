// Turns decoded RGBA pixels into a 1-bit ESC/POS raster image: flatten
// transparency onto white, box-filter resize to the printer's dot width,
// Floyd-Steinberg dither to black/white, then pack as GS v 0.

/** Box-filter downscale (area averaging) — much cleaner than nearest-neighbor
 *  for shrinking a large logo photo/export down to printer resolution. */
function resize(rgba, srcW, srcH, dstW, dstH) {
  const out = new Float64Array(dstW * dstH); // grayscale, 0-255, alpha already flattened by caller
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = Math.floor(dy * yRatio);
    const sy1 = Math.max(sy0 + 1, Math.floor((dy + 1) * yRatio));
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = Math.floor(dx * xRatio);
      const sx1 = Math.max(sx0 + 1, Math.floor((dx + 1) * xRatio));
      let sum = 0, count = 0;
      for (let sy = sy0; sy < sy1 && sy < srcH; sy++) {
        for (let sx = sx0; sx < sx1 && sx < srcW; sx++) {
          sum += rgba[sy * srcW + sx];
          count++;
        }
      }
      out[dy * dstW + dx] = count ? sum / count : 255;
    }
  }
  return out;
}

/** Flatten RGBA onto a white background and convert to 8-bit grayscale. */
function toGrayOnWhite(rgba, width, height, lighten = 0) {
  const gray = new Float64Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const a = rgba[i + 3] / 255;
    const r = rgba[i] * a + 255 * (1 - a);
    const g = rgba[i + 1] * a + 255 * (1 - a);
    const b = rgba[i + 2] * a + 255 * (1 - a);
    // Luminance weighting reads saturated colors (green especially) as much
    // darker than they look to the eye, so flat-color clipart can dither
    // into a dense, heavy-looking fill. `lighten` biases the whole image
    // toward white before thresholding to counter that; black linework stays
    // solidly black regardless since it starts near 0.
    gray[p] = Math.min(255, 0.299 * r + 0.587 * g + 0.114 * b + lighten);
  }
  return gray;
}

/**
 * Trim fully blank (near-white or fully transparent) margins from all four
 * edges, with a little padding put back. Logo exports very often have the
 * subject sitting in one corner of a much larger transparent/white canvas;
 * without this the receipt centers that whole canvas instead of the logo.
 */
function trimContentBounds(rgba, width, height, pad = 6) {
  const isBlank = (i) => rgba[i + 3] < 8 || (rgba[i] > 248 && rgba[i + 1] > 248 && rgba[i + 2] > 248);
  const rowBlank = (y) => {
    for (let x = 0; x < width; x++) if (!isBlank((y * width + x) * 4)) return false;
    return true;
  };
  const colBlank = (x) => {
    for (let y = 0; y < height; y++) if (!isBlank((y * width + x) * 4)) return false;
    return true;
  };

  let top = 0, bottom = height - 1, left = 0, right = width - 1;
  while (top < bottom && rowBlank(top)) top++;
  while (bottom > top && rowBlank(bottom)) bottom--;
  while (left < right && colBlank(left)) left++;
  while (right > left && colBlank(right)) right--;

  if (top === 0 && bottom === height - 1 && left === 0 && right === width - 1) {
    return { rgba, width, height }; // nothing to trim
  }

  top = Math.max(0, top - pad);
  left = Math.max(0, left - pad);
  bottom = Math.min(height - 1, bottom + pad);
  right = Math.min(width - 1, right + pad);

  const w = right - left + 1, h = bottom - top + 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const srcOff = ((y + top) * width + left) * 4;
    out.set(rgba.subarray(srcOff, srcOff + w * 4), y * w * 4);
  }
  return { rgba: out, width: w, height: h };
}

/** Floyd-Steinberg dither grayscale -> 1bpp (1 = black ink, matching ESC/POS raster). */
function ditherToBits(gray, width, height) {
  const buf = Float64Array.from(gray); // working copy, errors diffused into it
  const bits = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = buf[i];
      const black = old < 128;
      bits[i] = black ? 1 : 0;
      const error = old - (black ? 0 : 255);
      if (x + 1 < width) buf[i + 1] += error * (7 / 16);
      if (y + 1 < height) {
        if (x > 0) buf[i + width - 1] += error * (3 / 16);
        buf[i + width] += error * (5 / 16);
        if (x + 1 < width) buf[i + width + 1] += error * (1 / 16);
      }
    }
  }
  return bits;
}

/** Pack 1bpp bits (row-major, 1 = black) into ESC/POS GS v 0 raster bytes. */
function packEscposRaster(bits, width, height) {
  const bytesPerRow = Math.ceil(width / 8);
  const data = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!bits[y * width + x]) continue;
      const byteIndex = y * bytesPerRow + (x >> 3);
      data[byteIndex] |= 0x80 >> (x & 7);
    }
  }
  const GS = 0x1d;
  const xL = bytesPerRow & 0xff, xH = (bytesPerRow >> 8) & 0xff;
  const yL = height & 0xff, yH = (height >> 8) & 0xff;
  const header = Buffer.from([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
  return Buffer.concat([header, data]);
}

/**
 * Convert decoded PNG pixels to ESC/POS raster bytes at `targetWidth` dots,
 * preserving aspect ratio. Blank margins are trimmed first so the visible
 * logo — not its canvas — ends up centered. `lighten` (0-255) biases flat
 * colors toward white before dithering; see toGrayOnWhite for why.
 * Returns { bytes, width, height } (post-resize dot size).
 */
export function toEscposRaster({ width, height, rgba }, targetWidth, { lighten = 0 } = {}) {
  const trimmed = trimContentBounds(rgba, width, height);
  width = trimmed.width; height = trimmed.height; rgba = trimmed.rgba;

  const dstW = Math.min(targetWidth, width) || 1;
  const dstH = Math.max(1, Math.round((height / width) * dstW));

  const gray = toGrayOnWhite(rgba, width, height, lighten);
  const resized = resize(gray, width, height, dstW, dstH);
  const bits = ditherToBits(resized, dstW, dstH);
  // ESC/POS raster width must be a multiple of 8 dots; pad with white on the right.
  const padded = Math.ceil(dstW / 8) * 8;
  let finalBits = bits, finalW = dstW;
  if (padded !== dstW) {
    finalBits = new Uint8Array(padded * dstH);
    for (let y = 0; y < dstH; y++) finalBits.set(bits.subarray(y * dstW, y * dstW + dstW), y * padded);
    finalW = padded;
  }
  return { bytes: packEscposRaster(finalBits, finalW, dstH), width: finalW, height: dstH };
}
