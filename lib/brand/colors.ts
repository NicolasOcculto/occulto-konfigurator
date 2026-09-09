import type { BrandColor } from './types';

type RGB = { r: number; g: number; b: number };

export function toHex({ r, g, b }: RGB): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

export function parseHex(hex: string): RGB | null {
  const value = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]+$/i.test(value)) return null;
  if (value.length === 3 || value.length === 4) {
    const [r, g, b] = value.slice(0, 3).split('') as [string, string, string];
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
  }
  if (value.length === 6 || value.length === 8) {
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }
  return null;
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const lig = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  const sextant = Math.floor(hue / 60) % 6;
  const table: Array<[number, number, number]> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = table[sextant] as [number, number, number];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** Relative Helligkeit 0..1 nach der ueblichen Luma-Gewichtung. */
export function luminance({ r, g, b }: RGB): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function saturation({ r, g, b }: RGB): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

/**
 * Taugt die Farbe als Produktfarbe? Fast-Weiss, fast-Schwarz und blasse Graustufen
 * kommen auf jeder Website vor und sagen nichts ueber die Marke aus.
 */
function isBrandworthy(rgb: RGB): boolean {
  const lum = luminance(rgb);
  const sat = saturation(rgb);
  if (lum > 0.93) return false;
  if (lum < 0.06) return false;
  if (sat < 0.18) return false;
  return true;
}

/** Farbabstand als einfacher gewichteter euklidischer Abstand im RGB-Raum. */
function distance(a: RGB, b: RGB): number {
  const rMean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
}

type Hit = { rgb: RGB; weight: number };

/** Deklarationen, die eher die Marke tragen als beliebige Rahmen oder Schatten. */
function weightForContext(context: string): number {
  const c = context.toLowerCase();
  if (/--(?:brand|primary|accent|main|theme|color-primary)/.test(c)) return 12;
  if (/^\s*--/.test(c)) return 5;
  if (/background(?:-color)?\s*:/.test(c)) return 3;
  if (/\b(?:fill|stroke)\s*:/.test(c)) return 2.5;
  if (/\bcolor\s*:/.test(c)) return 2;
  if (/border|outline|shadow/.test(c)) return 0.5;
  return 1;
}

function collectHits(css: string, hits: Hit[], scale = 1): void {
  const re =
    /#[0-9a-f]{3,8}\b|rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)|hsla?\(\s*([-\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?)\s*)?\)/gi;

  let m: RegExpExecArray | null;
  let seen = 0;
  while ((m = re.exec(css)) && seen < 4000) {
    seen++;
    let rgb: RGB | null = null;
    let alpha = 1;

    if (m[0].startsWith('#')) {
      rgb = parseHex(m[0]);
    } else if (m[1] !== undefined) {
      const channel = (v: string) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
      rgb = { r: channel(m[1]), g: channel(m[2]!), b: channel(m[3]!) };
      if (m[4]) alpha = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    } else if (m[5] !== undefined) {
      rgb = hslToRgb(parseFloat(m[5]), parseFloat(m[6]!) / 100, parseFloat(m[7]!) / 100);
      if (m[8]) alpha = m[8].endsWith('%') ? parseFloat(m[8]) / 100 : parseFloat(m[8]);
    }

    if (!rgb || Number.isNaN(rgb.r) || Number.isNaN(rgb.g) || Number.isNaN(rgb.b)) continue;
    if (alpha < 0.5) continue; // halbtransparente Farben sind Schleier, keine Markenfarben
    if (!isBrandworthy(rgb)) continue;

    // Der Text unmittelbar davor enthaelt die Eigenschaft, zu der die Farbe gehoert.
    const start = css.lastIndexOf(';', m.index);
    const braceStart = css.lastIndexOf('{', m.index);
    const contextStart = Math.max(start, braceStart, m.index - 80);
    hits.push({ rgb, weight: weightForContext(css.slice(contextStart, m.index)) * scale });
  }
}

/**
 * Fasst die Fundstellen zu wenigen Markenfarben zusammen. Nahe beieinander liegende
 * Toene werden zu einem gewichteten Mittel verschmolzen, damit nicht funf Abstufungen
 * desselben Blaus die Auswahl fuellen.
 */
export function extractBrandColors(sources: Array<{ css: string; scale?: number }>): BrandColor[] {
  const hits: Hit[] = [];
  for (const source of sources) collectHits(source.css, hits, source.scale ?? 1);
  if (hits.length === 0) return [];

  const clusters: Array<{ rgb: RGB; weight: number; sum: RGB }> = [];
  const MERGE_DISTANCE = 60;

  for (const hit of hits) {
    let target = clusters.find((c) => distance(c.rgb, hit.rgb) < MERGE_DISTANCE);
    if (!target) {
      target = { rgb: hit.rgb, weight: 0, sum: { r: 0, g: 0, b: 0 } };
      clusters.push(target);
    }
    target.weight += hit.weight;
    target.sum.r += hit.rgb.r * hit.weight;
    target.sum.g += hit.rgb.g * hit.weight;
    target.sum.b += hit.rgb.b * hit.weight;
    target.rgb = {
      r: target.sum.r / target.weight,
      g: target.sum.g / target.weight,
      b: target.sum.b / target.weight,
    };
  }

  return clusters
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6)
    .map((c) => ({ hex: toHex(c.rgb), weight: Math.round(c.weight * 10) / 10 }));
}
