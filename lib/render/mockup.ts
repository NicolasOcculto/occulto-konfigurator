import sharp from 'sharp';
import type { Product } from '../products';
import {
  type RGB,
  type Raster,
  applyAlpha,
  blend,
  blurRaster,
  cloneRaster,
  compositeOver,
  emptyRaster,
  extractAlpha,
  floodFillBackground,
  loadRaster,
  luminance,
  maskWith,
  multiplyColor,
  parseHexColor,
  placeInto,
  scaleAlpha,
  tintSilhouette,
} from './raster';

export type RenderOptions = {
  product: Product;
  /** Rohbytes des Produktfotos aus /public/products. */
  productImage: Buffer;
  /** Rohbytes des Logos, oder null fuer eine reine Farbvorschau. */
  logo: Buffer | null;
  /** Produktfarbe als Hex. */
  color: string;
  /** Optionaler Firmenname fuer den eingewebten Schriftzug. */
  company?: string;
  /** Ausgabebreite; die Hoehe folgt dem Seitenverhaeltnis des Produkts. */
  width?: number;
};

const WHITE: RGB = { r: 255, g: 255, b: 255 };
const LABEL_INK: RGB = { r: 36, g: 36, b: 36 };

/**
 * Farbe des Materials an der Stelle des eingewebten Schriftzugs. Damit laesst sich
 * der vorhandene Schriftzug uebermalen, ohne dass ein Fleck in falschem Ton entsteht.
 */
function sampleLabelColor(product: Product, raster: Raster): RGB {
  const cx = Math.round(product.name.x * raster.w);
  const cy = Math.round(product.name.y * raster.h);
  const reach = Math.round(raster.w * 0.04);
  const floor = product.dark ? 150 : 205;

  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;

  for (let y = Math.max(0, cy - reach); y < Math.min(raster.h, cy + reach); y++) {
    for (let x = Math.max(0, cx - reach); x < Math.min(raster.w, cx + reach); x++) {
      const o = (y * raster.w + x) * 4;
      // Nur deckende, helle Pixel: das ist die Stofflaeche, nicht der dunkle Schriftzug.
      if (raster.data[o + 3]! > 200 && raster.data[o]! > floor) {
        r += raster.data[o]!;
        g += raster.data[o + 1]!;
        b += raster.data[o + 2]!;
        n++;
      }
    }
  }

  if (n === 0) return product.dark ? { r: 242, g: 240, b: 236 } : { r: 251, g: 251, b: 251 };
  return { r: r / n, g: g / n, b: b / n };
}

type LabelBox = { cx: number; cy: number; halfW: number; halfH: number };

type LocalBox = { minX: number; maxX: number; minY: number; maxY: number };

function emptyBox(): LocalBox {
  return { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
}

function grow(box: LocalBox, x: number, y: number): void {
  if (x < box.minX) box.minX = x;
  if (x > box.maxX) box.maxX = x;
  if (y < box.minY) box.minY = y;
  if (y > box.maxY) box.maxY = y;
}

function isEmpty(box: LocalBox): boolean {
  return box.minX === Infinity;
}

/**
 * Sucht die tatsaechliche Ausdehnung des vorhandenen Aufdrucks.
 *
 * Feste Masse aus dem Katalog treffen die Stelle nur ungefaehr: beim Muetzenlabel
 * stehen Schriftzug, Trennlinie und Jahreszahl untereinander und ragen aus einem
 * fest gesetzten Rechteck heraus.
 *
 * Deshalb zwei Durchgaenge im gedrehten Koordinatensystem. Erst wird die helle
 * Traegerflaeche eingegrenzt - beim Label die weisse Webmarke, bei der Socke der
 * Stoff selbst. Erst darin gelten dunkle Pixel als Aufdruck. Ohne diese
 * Eingrenzung wuerde bei der dunklen Muetze der schwarze Strick ringsum als
 * Druck durchgehen und die Flaeche ins Uferlose wachsen.
 */
function measureExistingPrint(product: Product, raster: Raster, material: RGB): LabelBox {
  const { data, w, h } = raster;
  const n = product.name;
  const cx = n.x * w;
  const cy = n.y * h;
  const radians = (n.a * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const searchW = n.len * w * 1.8;
  const searchH = n.th * w * 4.5;
  const reach = Math.ceil(Math.hypot(searchW, searchH)) + 4;
  const materialLum = luminance(material);
  const carrierFloor = materialLum * 0.82;
  const inkCeiling = materialLum * 0.78;

  const x0 = Math.max(0, Math.floor(cx - reach));
  const x1 = Math.min(w, Math.ceil(cx + reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const y1 = Math.min(h, Math.ceil(cy + reach));

  /** Ruft `visit` fuer jedes Pixel im gedrehten Suchfenster auf. */
  const scan = (visit: (lx: number, ly: number, lum: number) => void): void => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        if (Math.abs(lx) > searchW || Math.abs(ly) > searchH) continue;
        const o = (y * w + x) * 4;
        if (data[o + 3]! < 200) continue;
        visit(lx, ly, luminance({ r: data[o]!, g: data[o + 1]!, b: data[o + 2]! }));
      }
    }
  };

  const carrier = emptyBox();
  scan((lx, ly, lum) => {
    if (lum >= carrierFloor) grow(carrier, lx, ly);
  });

  const ink = emptyBox();
  if (!isEmpty(carrier)) {
    scan((lx, ly, lum) => {
      if (lum > inkCeiling) return;
      if (lx < carrier.minX || lx > carrier.maxX || ly < carrier.minY || ly > carrier.maxY) return;
      grow(ink, lx, ly);
    });
  }

  const fallback: LabelBox = { cx, cy, halfW: n.len * w * 0.62, halfH: n.th * w * 1.1 };
  if (isEmpty(ink)) return fallback;

  // Etwas Luft rundum, damit auch weiche Kanten des Drucks verschwinden.
  const pad = n.th * w * 0.6;
  const halfW = Math.max((ink.maxX - ink.minX) / 2 + pad, fallback.halfW);
  const halfH = Math.max((ink.maxY - ink.minY) / 2 + pad, fallback.halfH);

  // Mittelpunkt des gefundenen Rechtecks zurueck in Bildkoordinaten drehen.
  const localCx = (ink.minX + ink.maxX) / 2;
  const localCy = (ink.minY + ink.maxY) / 2;

  return {
    cx: cx + localCx * cos - localCy * sin,
    cy: cy + localCx * sin + localCy * cos,
    halfW,
    halfH,
  };
}

/** Gedrehtes, weiches Rechteck ueber der Stelle des alten Schriftzugs. */
async function labelPatch(
  product: Product,
  raster: Raster,
  color: RGB,
  box: LabelBox,
): Promise<Raster> {
  const { w, h } = raster;
  const { cx, cy, halfW, halfH } = box;
  const radians = (product.name.a * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const reach = Math.ceil(Math.hypot(halfW, halfH)) + 8;

  const patch = emptyRaster(w, h);
  for (let y = Math.max(0, Math.floor(cy - reach)); y < Math.min(h, Math.ceil(cy + reach)); y++) {
    for (let x = Math.max(0, Math.floor(cx - reach)); x < Math.min(w, Math.ceil(cx + reach)); x++) {
      const dx = x - cx;
      const dy = y - cy;
      // Rueckdrehung in das lokale Koordinatensystem des Rechtecks.
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      if (Math.abs(lx) > halfW || Math.abs(ly) > halfH) continue;
      const o = (y * w + x) * 4;
      patch.data[o] = Math.round(color.r);
      patch.data[o + 1] = Math.round(color.g);
      patch.data[o + 2] = Math.round(color.b);
      patch.data[o + 3] = 255;
    }
  }

  // Weiche Kante, damit die uebermalte Flaeche nicht als Rechteck stehen bleibt.
  return blurRaster(patch, (3 * w) / 675);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Firmenname als gedrehter Schriftzug. Die Breite wird geschaetzt, nicht gemessen:
 * librsvg gibt keine Textmasse zurueck, und fuer Grossbuchstaben in einer
 * Grotesk-Schrift traegt die Naeherung von rund 0,63 em je Zeichen weit genug.
 */
async function nameLayer(
  product: Product,
  w: number,
  h: number,
  company: string,
  ink: RGB,
  box: LabelBox,
): Promise<Raster | null> {
  const text = company.toUpperCase().slice(0, 22).trim();
  if (!text) return null;

  const n = product.name;
  const tracking = 0.1;
  // Der neue Schriftzug bleibt innerhalb der uebermalten Flaeche.
  let size = Math.min(n.th * w * 1.35, box.halfH * 1.4);
  const target = box.halfW * 2 * 0.92;
  const estimated = text.length * (0.63 + tracking) * size;
  if (estimated > target) size *= target / estimated;

  const fill = `rgb(${Math.round(ink.r)},${Math.round(ink.g)},${Math.round(ink.b)})`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <g transform="translate(${box.cx.toFixed(2)} ${box.cy.toFixed(2)}) rotate(${n.a})">
    <text x="0" y="0" text-anchor="middle" dominant-baseline="central"
      font-family="basic-sans, Helvetica, Arial, DejaVu Sans, sans-serif"
      font-weight="600" font-size="${size.toFixed(2)}"
      letter-spacing="${(size * tracking).toFixed(2)}"
      fill="${fill}">${escapeXml(text)}</text>
  </g>
</svg>`;

  try {
    const { data, info } = await sharp(Buffer.from(svg, 'utf8'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height };
  } catch {
    // Fehlt auf dem Host eine brauchbare Schrift, bleibt das Mockup ohne Schriftzug.
    return null;
  }
}

/**
 * Logo mittig auf die vorgesehene Stelle setzen, Seitenverhaeltnis bleibt erhalten.
 *
 * Mit `box` sitzt das Logo auf der eingewebten Marke: dann geben deren
 * ausgemessene Masse Ort und Groesse vor statt der festen Katalogwerte.
 */
async function logoLayer(
  product: Product,
  w: number,
  h: number,
  logo: Buffer,
  box: LabelBox | null,
): Promise<Raster | null> {
  const targetWidth = box
    ? Math.max(8, Math.round(box.halfW * 2 * 0.92))
    : Math.max(8, Math.round(product.logo.s * w));
  // Nur auf dem Label ist die Hoehe begrenzt; frei auf der Ware darf das Logo
  // seinem eigenen Seitenverhaeltnis folgen.
  const targetHeight = box ? Math.max(6, Math.round(box.halfH * 2 * 0.9)) : undefined;

  try {
    const { data, info } = await sharp(logo, { limitInputPixels: 40_000_000, density: 384 })
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: 'inside',
        withoutEnlargement: false,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const patch: Raster = { data, w: info.width, h: info.height };

    // Viele Logos von Websites sind deckende Grafiken auf weissem Grund. Ohne
    // Freistellung waere die Silhouette das ganze Rechteck - auf dunkler Ware
    // entstand daraus ein weisser Kasten statt eines Logos.
    floodFillBackground(patch);

    const cx = box ? box.cx : product.logo.x * w;
    const cy = box ? box.cy : product.logo.y * h;
    const layer = emptyRaster(w, h);
    placeInto(layer, patch, cx - patch.w / 2, cy - patch.h / 2);
    return layer;
  } catch {
    return null;
  }
}

/**
 * Mittlere Helligkeit der sichtbaren Logopixel, 0 bis 1.
 *
 * Ein Logo, das ohnehin fast weiss ist, verschwindet auf heller Ware. Dann ist
 * Schwarz die einzige Wahl - eine weisse Silhouette waere unsichtbar.
 */
function logoHelligkeit(layer: Raster): number {
  const { data } = layer;
  let summe = 0;
  let n = 0;
  for (let o = 0; o < data.length; o += 4) {
    const a = data[o + 3]!;
    if (a < 128) continue;
    summe += luminance({ r: data[o]!, g: data[o + 1]!, b: data[o + 2]! });
    n++;
  }
  return n === 0 ? 0 : summe / n;
}

/**
 * Weiche Maske fuer das Farbband am Bund.
 *
 * Echte Ware wird nicht durchgefaerbt: der Schaft bleibt weiss, farbig ist nur
 * der gestrickte Bund. Ohne die weiche Kante stuende dort eine harte Treppe.
 */
function bandMask(
  w: number,
  h: number,
  band: { from: number; to: number },
  silhouette: Uint8Array,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  const from = band.from * h;
  const to = band.to * h;
  const feather = Math.max(1, (to - from) * 0.06);

  for (let y = 0; y < h; y++) {
    if (y < from || y > to) continue;
    const rand = Math.min(y - from, to - y);
    const v = Math.round(Math.min(1, rand / feather) * 255);
    if (v <= 0) continue;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      mask[i] = Math.min(v, silhouette[i]!);
    }
  }
  return mask;
}

/**
 * Setzt ein Produktmockup zusammen.
 *
 * Reihenfolge:
 *  1. Produktfoto laden und den Hintergrund per Flood-Fill freistellen.
 *  2. Den eingewebten Schriftzug des Musterprodukts uebermalen.
 *  3. Bei heller Ware die Wunschfarbe multiplikativ auflegen und die Alphamaske
 *     wieder aufsetzen, damit die Freistellung erhalten bleibt.
 *  4. Logo und Firmenname als eine Ebene aufbauen und auf die Silhouette beschneiden.
 *  5. Die Materialstruktur des Produkts durch diese Ebene zurueckholen - multiplikativ
 *     bei heller Ware, per Soft-Light bei dunkler. Erst das laesst das Motiv
 *     eingestrickt statt aufgeklebt wirken.
 */
export async function renderMockup(options: RenderOptions): Promise<Buffer> {
  const { product, productImage, logo, color, company } = options;

  const width = options.width ?? product.w;
  const height = Math.round((width * product.h) / product.w);

  // 1 - Produkt laden und freistellen.
  const base = await loadRaster(productImage, { w: width, h: height });
  floodFillBackground(base);
  const silhouette = extractAlpha(base);

  // 2 - Alten Schriftzug ausmessen und uebermalen.
  const labelColor = sampleLabelColor(product, base);
  const printBox = measureExistingPrint(product, base, labelColor);
  const patch = await labelPatch(product, base, labelColor, printBox);
  maskWith(patch, silhouette);
  compositeOver(base, patch);

  // 3 - Wunschfarbe auflegen. Dunkle Ware wird nicht eingefaerbt.
  const tint = parseHexColor(color);
  const tintIsWhite = tint.r > 250 && tint.g > 250 && tint.b > 250;
  if (!product.dark && !tintIsWhite) {
    if (product.band) {
      // Nur der Bund wird farbig, der Rest der Socke bleibt wie er ist.
      const streifen = cloneRaster(base);
      multiplyColor(streifen, tint);
      maskWith(streifen, bandMask(width, height, product.band, silhouette));
      compositeOver(base, streifen);
    } else {
      multiplyColor(base, tint);
    }
    applyAlpha(base, silhouette);
  }

  // Helle Flaeche heisst dunkles Logo, dunkle Flaeche heisst weisses Logo.
  // Mit Farbband bleibt die Flaeche unter dem Logo in der Grundfarbe der Ware,
  // die Wunschfarbe sagt dort also nichts ueber die Helligkeit aus.
  const lightGarment = product.dark ? false : product.band ? true : luminance(tint) > 0.55;

  // Die eingefaerbte Ware ist zugleich die Texturvorlage fuer Schritt 5.
  const texture = cloneRaster(base);

  // 4 - Logo und Schriftzug als gemeinsame Ebene.
  const artwork = emptyRaster(width, height);
  let hasArtwork = false;

  // Auf der Webmarke ist nur fuer eines Platz: dann gewinnt das Logo.
  const logoTakesLabel = Boolean(logo && product.logoOnLabel);

  if (logo) {
    const placed = await logoLayer(product, width, height, logo, logoTakesLabel ? printBox : null);
    if (placed) {
      // Auf der Ware behaelt das Logo seine eigenen Farben. Umgefaerbt wird nur,
      // wenn es sonst im Untergrund verschwaende:
      //  - auf der hellen Webmarke immer dunkel, auch bei schwarzer Ware,
      //  - auf dunkler Ware weiss,
      //  - auf heller Ware schwarz, falls das Logo selbst fast weiss ist.
      //    Weiss auf Weiss ergibt kein Bild.
      if (logoTakesLabel) tintSilhouette(placed, LABEL_INK);
      else if (!lightGarment) tintSilhouette(placed, WHITE);
      else if (logoHelligkeit(placed) > 0.72) tintSilhouette(placed, LABEL_INK);
      compositeOver(artwork, placed);
      hasArtwork = true;
    }
  }

  if (company && !logoTakesLabel) {
    // Das Muetzenlabel ist immer hell, dort steht der Name dunkel.
    const inkIsDark = product.dark ? true : lightGarment;
    const text = await nameLayer(
      product,
      width,
      height,
      company,
      inkIsDark ? LABEL_INK : WHITE,
      printBox,
    );
    if (text) {
      compositeOver(artwork, text);
      hasArtwork = true;
    }
  }

  if (hasArtwork) {
    // Auf die Silhouette beschneiden: nichts darf neben dem Produkt schweben.
    maskWith(artwork, silhouette);
    const artworkAlpha = extractAlpha(artwork);
    compositeOver(base, artwork);

    // 5 - Materialstruktur durch das Motiv zurueckholen.
    maskWith(texture, artworkAlpha);
    scaleAlpha(texture, product.dark ? 0.3 : 0.5);
    blend(base, texture, product.dark ? 'soft-light' : 'multiply');
  }

  return sharp(base.data, { raw: { width, height, channels: 4 } })
    .webp({ quality: 88, effort: 4 })
    .toBuffer();
}
