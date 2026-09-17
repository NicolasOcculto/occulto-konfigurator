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
/**
 * Waagrechte Mitte der Ware auf einer bestimmten Hoehe.
 *
 * Damit sitzen Logo und Schriftzug mittig auf dem Schaft, statt auf einem
 * von Hand eingetragenen Anteil, der nach jedem Fototausch wieder daneben
 * liegt. Gemittelt ueber ein paar Zeilen, damit eine ausgefranste Kante den
 * Wert nicht verzieht.
 */
function mitteDerWare(
  silhouette: Uint8Array,
  w: number,
  h: number,
  yAnteil: number,
): number | null {
  const y0 = Math.max(0, Math.round(yAnteil * h) - 6);
  const y1 = Math.min(h - 1, Math.round(yAnteil * h) + 6);
  let summe = 0;
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    let links = -1;
    let rechts = -1;
    for (let x = 0; x < w; x++) {
      if (silhouette[y * w + x]! > 128) {
        if (links < 0) links = x;
        rechts = x;
      }
    }
    if (links < 0 || rechts - links < w * 0.05) continue;
    summe += (links + rechts) / 2;
    n++;
  }
  return n ? summe / n : null;
}

/** Das Rechteck, das allein aus den Angaben am Produkt folgt. */
function nameBox(product: Product, w: number, h: number, mitte?: number | null): LabelBox {
  const n = product.name;
  return {
    cx: mitte ?? n.x * w,
    cy: n.y * h,
    halfW: n.len * w * 0.62,
    halfH: n.th * w * 1.1,
  };
}

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

  const fallback = nameBox(product, w, h);
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
  mitte: number | null,
  grad: number,
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

    let patch: Raster = { data, w: info.width, h: info.height };

    // Viele Logos von Websites sind deckende Grafiken auf weissem Grund. Ohne
    // Freistellung waere die Silhouette das ganze Rechteck - auf dunkler Ware
    // entstand daraus ein weisser Kasten statt eines Logos.
    floodFillBackground(patch);

    // Die Ware steht im Foto schraeg. Waagrecht aufgesetzt sieht das Logo
    // aufgeklebt aus statt eingestrickt - es bekommt dieselbe Neigung wie die
    // Ringe. Auf dem Muetzenlabel (box gesetzt) bleibt es gerade: dort liegt
    // eine flache Webmarke, keine gewoelbte Flaeche.
    const neigung = box ? 0 : grad;
    if (neigung !== 0) {
      // Erst freistellen, dann drehen: die Freistellung erkennt einen weissen
      // Grund nur, solange er noch deckend ist. Nach dem Drehen waeren die
      // Ecken durchsichtig und sie hielte das Bild fuer bereits freigestellt.
      const gedreht = await sharp(Buffer.from(patch.data), {
        raw: { width: patch.w, height: patch.h, channels: 4 },
      })
        .rotate(neigung, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .raw()
        .toBuffer({ resolveWithObject: true });
      patch = { data: gedreht.data, w: gedreht.info.width, h: gedreht.info.height };
    }

    const cx = box
      ? box.cx
      : (mitte ?? product.logo.x * w) + (product.logo.dx ?? 0) * w;
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
 * Hoehe eines einzelnen Rings, als Anteil des ausgemessenen Bandes.
 *
 * Zwei schmale Ringe statt eines breiten Blocks - so tragen Sportsocken ihre
 * Farbe. Der breite Block sah aus wie eine aufgesetzte Kappe.
 *
 * Die Ringe sitzen an den beiden Raendern des gemessenen Bandes: aussen und
 * innen bleibt damit alles, wie es an der echten Ware gemessen wurde, nur die
 * Mitte dazwischen behaelt die Grundfarbe.
 *
 * Ein Drittel, nicht 0.3: damit ist der Zwischenraum genau so dick wie ein
 * Ring. Zwei Ringe und eine Luecke teilen sich das Band zu gleichen Teilen -
 * jede andere Zahl macht eines von beidem zum Zufall. Vorher lagen 0.3 zu
 * 0.4, die Luecke war also breiter als die Streifen.
 */
const RING_ANTEIL = 1 / 3;

/**
 * Wie tief die Ringe in der Mitte durchhaengen, als Anteil der halben
 * Schaftbreite.
 *
 * Ein Ring um einen Zylinder ist im Bild kein Strich, sondern eine Ellipse.
 * Die Kamera steht ueber der Bundkante - man sieht in die Oeffnung hinein -,
 * also ist von jedem Ring die vordere Haelfte zu sehen, und die haengt zur
 * Mitte hin durch. Gerade gezogen sieht der Ring aufgemalt aus.
 */
const RING_BOGEN = 0.12;

/**
 * Neigung des Schafts im Bereich des Bundes.
 *
 * Die Ringe liegen um einen Zylinder, und der steht im Foto schraeg. Waagrecht
 * gezogen sehen sie aufgeklebt aus statt umlaufend - sie muessen quer zur Achse
 * des Schafts liegen und damit leicht angeschnitten sein.
 *
 * Gemessen statt geschaetzt: fuer jede Bildzeile im Bundbereich die Mitte
 * zwischen linkem und rechtem Rand der Silhouette, daraus eine
 * Ausgleichsgerade. Das haelt auch dann, wenn ein Produktfoto ausgetauscht
 * wird und die Socke anders im Bild steht.
 *
 * Rueckgabe: m ist die Verschiebung der Mitte je Bildzeile nach unten, xc die
 * Mitte auf Hoehe yc, halbBreite die halbe Breite des Schafts. Die beiden
 * letzten braucht die Woelbung der Ringe.
 */
function schaftNeigung(
  w: number,
  h: number,
  band: { from: number; to: number },
  silhouette: Uint8Array,
): { m: number; xc: number; yc: number; halbBreite: number } {
  // Ein gutes Stueck Schaft unterhalb des Bandes mitmessen, nicht nur dessen
  // eigene Hoehe: direkt am Bund steht die Socke fast senkrecht, die Neigung
  // entwickelt sich erst darunter. Nur am Band gemessen kamen bei der
  // Casualsocke 8.7 Grad heraus statt der 17, die der Schaft tatsaechlich
  // hat - die Ringe standen dann sichtbar quer zur Ware.
  const von = Math.max(0, Math.floor((band.from - 0.03) * h));
  const bis = Math.min(h - 1, Math.ceil((band.to + 0.2) * h));
  const ys: number[] = [];
  const xs: number[] = [];
  const breiten: number[] = [];

  for (let y = von; y <= bis; y++) {
    let links = -1;
    let rechts = -1;
    for (let x = 0; x < w; x++) {
      if (silhouette[y * w + x]! > 128) {
        if (links < 0) links = x;
        rechts = x;
      }
    }
    // Zu schmale Zeilen sind Rand oder Rauschen, keine Ware.
    if (links < 0 || rechts - links < w * 0.05) continue;
    ys.push(y);
    xs.push((links + rechts) / 2);
    breiten.push((rechts - links) / 2);
  }

  const n = ys.length;
  if (n < 8) return { m: 0, xc: w / 2, yc: h / 2, halbBreite: w / 4 };

  const mitteY = ys.reduce((a, b) => a + b, 0) / n;
  const mitteX = xs.reduce((a, b) => a + b, 0) / n;
  let zaehler = 0;
  let nenner = 0;
  for (let i = 0; i < n; i++) {
    zaehler += (ys[i]! - mitteY) * (xs[i]! - mitteX);
    nenner += (ys[i]! - mitteY) ** 2;
  }
  const m = nenner === 0 ? 0 : zaehler / nenner;
  // Mehr als das waere keine Neigung mehr, sondern ein Messfehler - etwa,
  // wenn die Freistellung im Bundbereich ausgefranst ist.
  return {
    m: Math.max(-0.6, Math.min(0.6, m)),
    xc: mitteX,
    yc: mitteY,
    halbBreite: breiten.reduce((a, b) => a + b, 0) / n,
  };
}

/**
 * Die Neigung, der alles auf diesem Produkt folgt: Ringe, Logo, Schriftzug.
 *
 * Gemessen, sofern es einen Bund gibt, und bei Bedarf am Produkt
 * ueberschrieben. Null fuer Ware ohne Bund - die Muetze traegt eine flache
 * Webmarke, dort steht nichts schraeg.
 */
function neigungDerWare(
  product: Product,
  w: number,
  h: number,
  silhouette: Uint8Array,
): { m: number; xc: number; yc: number; halbBreite: number } | null {
  if (!product.band) return null;
  const gemessen = schaftNeigung(w, h, product.band, silhouette);
  if (product.bandAngle === undefined) return gemessen;
  // Grad gegen den Uhrzeigersinn in dieselbe Steigung umrechnen, die die
  // Messung liefert.
  return { ...gemessen, m: -Math.tan((product.bandAngle * Math.PI) / 180) };
}

/**
 * Weiche Maske fuer die Farbringe am Bund.
 *
 * Echte Ware wird nicht durchgefaerbt: der Schaft bleibt weiss, farbig sind nur
 * die Ringe am gestrickten Bund. Ohne die weiche Kante stuende dort eine harte
 * Treppe.
 *
 * Gerechnet wird nicht in Bildzeilen, sondern in u: der Hoehe entlang der
 * Schaftachse. Dadurch laufen die Ringe quer zum Schaft und sind schraeg
 * angeschnitten, so wie ein umlaufender Ring im Foto aussieht.
 */
function bandMask(
  product: Product,
  w: number,
  h: number,
  band: { from: number; to: number },
  silhouette: Uint8Array,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  const from = band.from * h;
  const to = band.to * h;
  const dicke = (to - from) * RING_ANTEIL;
  const ringe = [
    { von: from, bis: from + dicke },
    { von: to - dicke, bis: to },
  ];
  // Die weiche Kante richtet sich nach dem Ring, nicht nach dem ganzen Band -
  // sonst waere sie bei diesen schmalen Streifen breiter als der Streifen.
  //
  // 0.1 statt 0.18: die Kante liegt innerhalb des Rings, frisst ihn also von
  // beiden Seiten an, waehrend die Luecke dabei waechst. Bei 0.18 waren die
  // Ringe zwar rechnerisch so dick wie der Zwischenraum, sichtbar aber im
  // Verhaeltnis 24 zu 31. Weich genug bleibt es trotzdem.
  const feather = Math.max(1, dicke * 0.1);
  const { m, xc, yc, halbBreite } = neigungDerWare(product, w, h, silhouette)!;
  const bogen = (product.bandBow ?? RING_BOGEN) * halbBreite;

  for (const ring of ringe) {
    // Der Suchbereich waechst um das, was Neigung und Woelbung ueber die
    // Bildbreite ausmachen - sonst fehlte der Ring an den Raendern.
    const spielraum = Math.abs(m) * w + bogen;
    const erste = Math.max(0, Math.floor(ring.von - spielraum));
    const letzte = Math.min(h - 1, Math.ceil(ring.bis + spielraum));
    for (let y = erste; y <= letzte; y++) {
      // Die Mitte wandert mit der Hoehe, der Schaft steht schraeg.
      const mitteHier = xc + m * (y - yc);
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (silhouette[i]! === 0) continue;
        const t = Math.max(-1, Math.min(1, (x - mitteHier) / halbBreite));
        const u = y + m * (x - xc) - bogen * (1 - t * t);
        if (u < ring.von || u > ring.bis) continue;
        const rand = Math.min(u - ring.von, ring.bis - u);
        const v = Math.round(Math.min(1, rand / feather) * 255);
        if (v <= 0) continue;
        const wert = Math.min(v, silhouette[i]!);
        // Die Ringe ueberschneiden sich nicht, aber der groessere Wert zu
        // gewinnen ist die richtige Regel, falls ein Band mal so schmal ist,
        // dass beide auf dieselbe Bildzeile fallen.
        if (wert > mask[i]!) mask[i] = wert;
      }
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
  floodFillBackground(base, product.cutTolerance);
  const silhouette = extractAlpha(base);

  // 2 - Alten Schriftzug ausmessen und uebermalen. Traegt das Foto keinen,
  // entfaellt beides: zu messen gaebe es nur die Struktur der Ware.
  const labelColor = sampleLabelColor(product, base);
  // Mitte der Ware auf Hoehe von Logo und Schriftzug. Nur fuer Ware mit
  // Bund - auf dem Muetzenlabel gibt die Webmarke die Stelle vor.
  const mitteLogo = product.band
    ? mitteDerWare(silhouette, width, height, product.logo.y)
    : null;
  const mitteName = product.band
    ? mitteDerWare(silhouette, width, height, product.name.y)
    : null;

  // Dieselbe Neigung wie die Ringe, in Grad.
  const lage = neigungDerWare(product, width, height, silhouette);
  const logoNeigung = lage ? -(Math.atan(lage.m) * 180) / Math.PI : 0;

  let printBox = nameBox(product, width, height, mitteName);
  if (product.hasPrintedName !== false) {
    printBox = measureExistingPrint(product, base, labelColor);
    const patch = await labelPatch(product, base, labelColor, printBox);
    maskWith(patch, silhouette);
    compositeOver(base, patch);
  }

  // 3 - Wunschfarbe auflegen. Dunkle Ware wird nicht eingefaerbt.
  const tint = parseHexColor(color);
  const tintIsWhite = tint.r > 250 && tint.g > 250 && tint.b > 250;
  if (!product.dark && !tintIsWhite) {
    if (product.band) {
      // Nur die Ringe am Bund werden farbig, der Rest der Socke bleibt wie er ist.
      const streifen = cloneRaster(base);
      multiplyColor(streifen, tint);
      maskWith(streifen, bandMask(product, width, height, product.band, silhouette));
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
    const placed = await logoLayer(
      product,
      width,
      height,
      logo,
      logoTakesLabel ? printBox : null,
      mitteLogo,
      logoNeigung,
    );
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

  // Der Firmenname ist der Rueckfall, nicht die Ergaenzung: liegt ein Logo auf
  // der Ware, stand der Name bisher ein zweites Mal darunter.
  if (company && !hasArtwork) {
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
