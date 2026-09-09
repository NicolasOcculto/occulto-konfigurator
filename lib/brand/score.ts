import sharp from 'sharp';
import { LIMITS, safeFetch } from './fetch';
import type { CandidateSource, LogoCandidate, ResolvedLogo } from './types';

/**
 * Grundvertrauen je Fundstelle. Ein eingebettetes SVG im Kopfbereich ist fast
 * immer das Logo; ein Favicon ist zwar sicher die Marke, aber zu klein fuer Stick.
 */
const SOURCE_WEIGHT: Record<CandidateSource, number> = {
  'svg:inline': 100,
  'img:header': 92,
  'json-ld': 78,
  'css:background': 70,
  'link:apple-touch-icon': 62,
  'og:image': 46,
  'link:icon': 40,
  'twitter:image': 34,
  'img:page': 30,
  'link:mask-icon': 28,
  'favicon.ico': 18,
  'logo.dev': 100,
  brandfetch: 100,
};

const LOGO_WORDS = /logo|wordmark|signet|brandmark|lockup/i;

/** Vorsortierung allein aus dem Markup, bevor irgendetwas geladen wird. */
function preScore(c: LogoCandidate): number {
  let score = SOURCE_WEIGHT[c.source] ?? 20;
  if (c.hint && LOGO_WORDS.test(c.hint)) score += 30;
  if (c.inHeader) score += 12;
  // Frueh im Dokument heisst in der Regel Kopfbereich.
  score += Math.max(0, 14 - c.documentIndex / 20);
  const declared = Math.min(c.declaredWidth ?? 0, c.declaredHeight ?? 0);
  if (declared >= 64) score += 8;
  if (declared > 0 && declared < 24) score -= 20;
  return score;
}

type Probe = {
  width: number;
  height: number;
  format: string;
  hasAlpha: boolean;
  /** Bildentropie: flache Grafiken liegen tief, Fotos hoch. */
  entropy: number;
  buffer: Buffer;
};

async function probe(buffer: Buffer): Promise<Probe | null> {
  try {
    const image = sharp(buffer, { limitInputPixels: 40_000_000 });
    const meta = await image.metadata();
    if (!meta.width || !meta.height || !meta.format) return null;

    // SVG meldet manchmal winzige Standardmasse; die viewBox zaehlt, nicht die Pixel.
    const width = meta.format === 'svg' ? Math.max(meta.width, 256) : meta.width;
    const height =
      meta.format === 'svg' ? Math.round((width * meta.height) / meta.width) : meta.height;

    let entropy = 5;
    try {
      const stats = await image.stats();
      entropy = stats.entropy;
    } catch {
      // stats() scheitert bei manchen Formaten - dann bleibt der neutrale Mittelwert.
    }

    return {
      width,
      height,
      format: meta.format,
      hasAlpha: Boolean(meta.hasAlpha),
      entropy,
      buffer,
    };
  } catch {
    return null;
  }
}

/**
 * Endgueltige Bewertung, jetzt mit den echten Bildmassen.
 *
 * Groesse: unter 48 px ist ein Bild fuer eine Stickdatei unbrauchbar, ueber
 * ~600 px bringt mehr keinen Vorteil mehr.
 * Seitenverhaeltnis: Logos sind quadratisch bis breit; sehr hohe Bilder sind
 * Produktfotos, sehr breite sind Banner.
 */
function finalScore(c: LogoCandidate, p: Probe): number {
  let score = preScore(c);

  const shortSide = Math.min(p.width, p.height);
  const longSide = Math.max(p.width, p.height);
  const aspect = longSide / Math.max(1, shortSide);

  if (shortSide < 24) score -= 60;
  else if (shortSide < 48) score -= 25;
  else score += Math.min(30, (Math.min(shortSide, 600) - 48) / 18);

  if (p.width >= p.height) {
    // Breite Lockups sind der Normalfall.
    if (aspect <= 1.2) score += 6;
    else if (aspect <= 5) score += 12;
    else if (aspect <= 8) score -= 5;
    else score -= 35;
  } else {
    // Hochformat spricht gegen ein Logo.
    score -= aspect > 1.6 ? 30 : 8;
  }

  // Social-Card-Format: gross und etwa 1,91:1 - das ist ein Teaserbild, kein Logo.
  const area = p.width * p.height;
  if (area > 400_000 && aspect > 1.6 && aspect < 2.2) score -= 30;

  // Transparenz ist das staerkste einzelne Indiz fuer eine freigestellte Marke.
  if (p.hasAlpha) score += 28;
  if (p.format === 'svg') score += 20;

  // Flache Farbflaechen statt Fotomotiv.
  if (p.entropy < 3) score += 18;
  else if (p.entropy > 6.5) score -= 25;

  return score;
}

/** Doppelte URLs entfernen, dabei die bestbewertete Fundstelle behalten. */
function dedupe(candidates: LogoCandidate[]): LogoCandidate[] {
  const best = new Map<string, LogoCandidate>();
  for (const c of candidates) {
    const existing = best.get(c.url);
    if (!existing || preScore(c) > preScore(existing)) best.set(c.url, c);
  }
  return [...best.values()];
}

async function loadCandidate(c: LogoCandidate): Promise<Buffer | null> {
  if (c.url.startsWith('data:')) {
    const comma = c.url.indexOf(',');
    if (comma < 0) return null;
    const meta = c.url.slice(5, comma);
    const payload = c.url.slice(comma + 1);
    return meta.includes(';base64')
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
  }
  try {
    const res = await safeFetch(c.url, { maxBytes: LIMITS.assetBytes, accept: 'image/*' });
    if (res.status !== 200 || res.body.length === 0) return null;
    return res.body;
  } catch {
    return null;
  }
}

/** Normalisiert das Bild fuer die Antwort: SVG bleibt SVG, Raster wird PNG mit max. 512 px. */
async function toDataUri(p: Probe): Promise<string> {
  if (p.format === 'svg') {
    return `data:image/svg+xml;base64,${p.buffer.toString('base64')}`;
  }
  const png = await sharp(p.buffer)
    .resize({
      width: Math.min(p.width, 512),
      height: Math.min(p.height, 512),
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/**
 * Laedt die aussichtsreichsten Kandidaten, misst sie und liefert den besten zurueck.
 * Es werden hoechstens `limit` Bilder tatsaechlich geholt - alles andere waere
 * fuer eine Serverless-Funktion zu langsam.
 */
export async function resolveBestLogo(
  candidates: LogoCandidate[],
  limit = 6,
): Promise<ResolvedLogo | null> {
  const shortlist = dedupe(candidates)
    .sort((a, b) => preScore(b) - preScore(a))
    .slice(0, limit);
  if (shortlist.length === 0) return null;

  const probed = await Promise.all(
    shortlist.map(async (c) => {
      const buffer = await loadCandidate(c);
      if (!buffer) return null;
      const p = await probe(buffer);
      return p ? { candidate: c, probe: p } : null;
    }),
  );

  const scored = probed
    .filter((x): x is { candidate: LogoCandidate; probe: Probe } => x !== null)
    .map((x) => ({ ...x, score: finalScore(x.candidate, x.probe) }))
    .sort((a, b) => b.score - a.score);

  const winner = scored[0];
  if (!winner) return null;

  return {
    url: winner.candidate.url.startsWith('data:') ? 'inline-svg' : winner.candidate.url,
    source: winner.candidate.source,
    width: winner.probe.width,
    height: winner.probe.height,
    format: winner.probe.format,
    dataUri: await toDataUri(winner.probe),
    score: Math.round(winner.score),
  };
}

/** Einzelnes Bild einer Rueckfallebene pruefen und in dieselbe Form bringen. */
export async function resolveSingle(
  url: string,
  source: CandidateSource,
): Promise<ResolvedLogo | null> {
  const buffer = await loadCandidate({
    url,
    source,
    documentIndex: 0,
    inHeader: true,
  });
  if (!buffer) return null;
  const p = await probe(buffer);
  if (!p) return null;
  // Zu kleine Rueckfallbilder helfen nicht weiter.
  if (Math.min(p.width, p.height) < 32) return null;
  return {
    url,
    source,
    width: p.width,
    height: p.height,
    format: p.format,
    dataUri: await toDataUri(p),
    score: Math.round(finalScore({ url, source, documentIndex: 0, inHeader: true }, p)),
  };
}
