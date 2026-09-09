import sharp from 'sharp';

/** Rohes RGBA-Bild. Alle Bildoperationen dieses Moduls rechnen darauf. */
export type Raster = { data: Buffer; w: number; h: number };

export type RGB = { r: number; g: number; b: number };

export function rasterFrom(data: Buffer, w: number, h: number): Raster {
  return { data, w, h };
}

/**
 * Auf 0..255 begrenzen. Ein Buffer ist ein Uint8Array: ein Wert von 255.4 aus einer
 * Fliesskommarechnung wuerde sonst nicht abgeschnitten, sondern auf 0 umbrechen und
 * einzelne Pixel schwarz faerben.
 */
function clamp8(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

export function emptyRaster(w: number, h: number): Raster {
  return { data: Buffer.alloc(w * h * 4, 0), w, h };
}

export function cloneRaster(src: Raster): Raster {
  return { data: Buffer.from(src.data), w: src.w, h: src.h };
}

/** Sharp-Instanz aus rohen Pixeln - Eingang fuer Encoder und Composite-Schritte. */
export function toSharp(r: Raster): sharp.Sharp {
  return sharp(r.data, { raw: { width: r.w, height: r.h, channels: 4 } });
}

/** Beliebiges Bild als RGBA in der Zielgroesse laden. */
export async function loadRaster(
  input: Buffer,
  fit?: { w: number; h: number },
): Promise<Raster> {
  let pipeline = sharp(input, { limitInputPixels: 40_000_000, density: 384 });
  if (fit) {
    pipeline = pipeline.resize(fit.w, fit.h, { fit: 'fill' });
  }
  const { data, info } = await pipeline
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

export function parseHexColor(hex: string): RGB {
  const value = hex.trim().replace(/^#/, '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value.slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return { r: 255, g: 255, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function luminance({ r, g, b }: RGB): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * Ist der Hintergrund schon transparent? Bei einem bereits freigestellten Foto
 * darf der Weiss-Test unten nicht laufen: weisse Ware waere sonst selbst
 * "Hintergrund" und wuerde mit weggeschnitten.
 */
function backgroundIsTransparent(raster: Raster): boolean {
  const { data, w, h } = raster;
  let transparent = 0;
  let total = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 64));

  for (let x = 0; x < w; x += step) {
    for (const y of [0, h - 1]) {
      total++;
      if (data[(y * w + x) * 4 + 3]! < 16) transparent++;
    }
  }
  for (let y = 0; y < h; y += step) {
    for (const x of [0, w - 1]) {
      total++;
      if (data[(y * w + x) * 4 + 3]! < 16) transparent++;
    }
  }

  return total > 0 && transparent / total > 0.6;
}

/**
 * Stellt den Hintergrund frei: Flood-Fill von allen Raendern nach innen, solange
 * die Pixel hell genug sind. Nur zusammenhaengende Randflaechen werden entfernt -
 * weisse Stellen im Produkt selbst bleiben dadurch erhalten.
 *
 * Zwei Schwellen sorgen fuer weiche Kanten: Ab `hard` gilt ein Pixel als reiner
 * Hintergrund und gibt die Fuellung weiter, zwischen `soft` und `hard` wird es
 * nur teilweise transparent und stoppt die Ausbreitung.
 *
 * Bringt das Foto bereits einen transparenten Hintergrund mit, laeuft die Fuellung
 * nur durch die transparenten Flaechen und laesst die Ware unangetastet.
 */
export function floodFillBackground(raster: Raster, tolerance = 26): Raster {
  const { data, w, h } = raster;
  const alreadyCut = backgroundIsTransparent(raster);
  const hard = 255 - tolerance;
  const soft = Math.max(0, 255 - tolerance * 2.6);
  const span = Math.max(1, hard - soft);

  const visited = new Uint8Array(w * h);
  // Ein Int32Array als Ringpuffer ist deutlich guenstiger als ein Array mit shift().
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const push = (i: number) => {
    if (!visited[i]) {
      visited[i] = 1;
      queue[tail++] = i;
    }
  };

  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }

  while (head < tail) {
    const i = queue[head++]!;
    const o = i * 4;
    const alpha = data[o + 3]!;

    let spreads = false;
    if (alpha < 16) {
      spreads = true;
    } else if (!alreadyCut) {
      // Weissgrad = dunkelster Kanal. Nur bei allen drei Kanaelen hell ist es Hintergrund.
      const whiteness = Math.min(data[o]!, data[o + 1]!, data[o + 2]!);
      if (whiteness >= hard) {
        data[o + 3] = 0;
        spreads = true;
      } else if (whiteness > soft) {
        data[o + 3] = clamp8((alpha * (hard - whiteness)) / span);
      }
    }

    if (!spreads) continue;

    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }

  return raster;
}

/** Alphakanal als eigene Maske sichern, bevor Farboperationen ihn ueberschreiben. */
export function extractAlpha(raster: Raster): Uint8Array {
  const mask = new Uint8Array(raster.w * raster.h);
  for (let i = 0; i < mask.length; i++) mask[i] = raster.data[i * 4 + 3]!;
  return mask;
}

export function applyAlpha(raster: Raster, mask: Uint8Array): Raster {
  for (let i = 0; i < mask.length; i++) raster.data[i * 4 + 3] = mask[i]!;
  return raster;
}

/** Farbe multiplikativ auflegen - dunkelt das Material ein, statt es zu uebermalen. */
export function multiplyColor(raster: Raster, color: RGB): Raster {
  const { data } = raster;
  for (let o = 0; o < data.length; o += 4) {
    if (data[o + 3] === 0) continue;
    data[o] = clamp8((data[o]! * color.r) / 255);
    data[o + 1] = clamp8((data[o + 1]! * color.g) / 255);
    data[o + 2] = clamp8((data[o + 2]! * color.b) / 255);
  }
  return raster;
}

/** Alphakanal einer Ebene mit dem einer Maske verrechnen (entspricht dest-in). */
export function maskWith(layer: Raster, mask: Uint8Array): Raster {
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4 + 3;
    layer.data[o] = clamp8((layer.data[o]! * mask[i]!) / 255);
  }
  return layer;
}

export function scaleAlpha(layer: Raster, factor: number): Raster {
  for (let o = 3; o < layer.data.length; o += 4) {
    layer.data[o] = clamp8(layer.data[o]! * factor);
  }
  return layer;
}

/** Alle sichtbaren Pixel auf eine Farbe setzen, Deckung bleibt erhalten. */
export function tintSilhouette(layer: Raster, color: RGB): Raster {
  const { data } = layer;
  for (let o = 0; o < data.length; o += 4) {
    if (data[o + 3] === 0) continue;
    data[o] = color.r;
    data[o + 1] = color.g;
    data[o + 2] = color.b;
  }
  return layer;
}

/** Ebene deckend ueber den Untergrund legen (source-over). */
export function compositeOver(base: Raster, layer: Raster): Raster {
  const { data } = base;
  const src = layer.data;
  for (let o = 0; o < data.length; o += 4) {
    const a = src[o + 3]! / 255;
    if (a === 0) continue;
    if (a === 1) {
      data[o] = src[o]!;
      data[o + 1] = src[o + 1]!;
      data[o + 2] = src[o + 2]!;
      data[o + 3] = 255;
      continue;
    }
    const baseAlpha = data[o + 3]! / 255;
    const outAlpha = a + baseAlpha * (1 - a);
    for (let c = 0; c < 3; c++) {
      const s = src[o + c]!;
      const d = data[o + c]!;
      data[o + c] = outAlpha === 0 ? 0 : clamp8((s * a + d * baseAlpha * (1 - a)) / outAlpha);
    }
    data[o + 3] = clamp8(outAlpha * 255);
  }
  return base;
}

export type BlendMode = 'multiply' | 'soft-light';

function blendChannel(mode: BlendMode, base: number, src: number): number {
  const b = base / 255;
  const s = src / 255;
  if (mode === 'multiply') return b * s * 255;
  // Soft-Light nach der W3C-Formel: hellt auf oder dunkelt ab, ohne Zeichnung zu verlieren.
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  const out = s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (d - b);
  return out * 255;
}

/**
 * Blendet eine Ebene im gewaehlten Modus ein. Die Staerke steckt im Alphakanal
 * der Ebene, sodass die Wirkung dort aufhoert, wo die Ebene transparent ist.
 */
export function blend(base: Raster, layer: Raster, mode: BlendMode): Raster {
  const { data } = base;
  const src = layer.data;
  for (let o = 0; o < data.length; o += 4) {
    const a = src[o + 3]! / 255;
    if (a === 0) continue;
    for (let c = 0; c < 3; c++) {
      const mixed = blendChannel(mode, data[o + c]!, src[o + c]!);
      data[o + c] = clamp8(data[o + c]! * (1 - a) + mixed * a);
    }
  }
  return base;
}

/** Ebene an fester Position in eine leere Flaeche der Zielgroesse einsetzen. */
export function placeInto(target: Raster, patch: Raster, left: number, top: number): Raster {
  const x0 = Math.round(left);
  const y0 = Math.round(top);
  for (let y = 0; y < patch.h; y++) {
    const ty = y0 + y;
    if (ty < 0 || ty >= target.h) continue;
    for (let x = 0; x < patch.w; x++) {
      const tx = x0 + x;
      if (tx < 0 || tx >= target.w) continue;
      const so = (y * patch.w + x) * 4;
      const to = (ty * target.w + tx) * 4;
      target.data[to] = patch.data[so]!;
      target.data[to + 1] = patch.data[so + 1]!;
      target.data[to + 2] = patch.data[so + 2]!;
      target.data[to + 3] = patch.data[so + 3]!;
    }
  }
  return target;
}

/** Weichzeichnen ueber sharp - fuer die uebermalte Stelle des alten Schriftzugs. */
export async function blurRaster(raster: Raster, sigma: number): Promise<Raster> {
  const { data, info } = await toSharp(raster)
    .blur(sigma)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
