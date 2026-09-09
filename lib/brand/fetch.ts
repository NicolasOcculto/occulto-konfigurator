import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const USER_AGENT =
  'Mozilla/5.0 (compatible; OccultoKonfigurator/1.0; +https://occulto.de) AppleWebKit/537.36';

export const LIMITS = {
  htmlBytes: 1_500_000,
  assetBytes: 3_000_000,
  timeoutMs: 8_000,
  redirects: 5,
} as const;

/** Normalisiert Eingaben wie "https://Beispiel.de/team?x=1" oder "beispiel.de" auf "beispiel.de". */
export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  let host = trimmed;
  // Protokoll und alles ab dem ersten Pfadtrenner abschneiden.
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.replace(/^[^@/]*@/, '');
  host = host.split(/[/?#]/)[0] ?? '';
  host = host.replace(/:\d+$/, '');
  host = host.replace(/\.$/, '');

  if (!host || host.length > 253) return null;
  if (isIP(host)) return null; // IPs sind keine Marken und laden zu SSRF ein.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return null;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return null;
  }
  return host;
}

/** Private, lokale und Link-Local-Bereiche - dorthin darf der Server nicht greifen. */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
    const [a, b] = p as [number, number, number, number];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // Multicast und reserviert
    return false;
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v6 === '::' || v6 === '::1') return true;
  if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('Zieladresse liegt im privaten Netz.');
    return;
  }
  const records = await lookup(hostname, { all: true });
  if (records.length === 0) throw new Error('Domain laesst sich nicht aufloesen.');
  for (const record of records) {
    if (isPrivateAddress(record.address)) throw new Error('Zieladresse liegt im privaten Netz.');
  }
}

export type FetchedBody = {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
};

/**
 * Holt eine URL mit eigener Weiterleitungskette, damit jedes Ziel erneut gegen
 * private Adressbereiche geprueft wird, und bricht bei Zeit- oder Groessenueberschreitung ab.
 */
export async function safeFetch(
  target: string,
  opts: { maxBytes: number; accept?: string; timeoutMs?: number } = { maxBytes: LIMITS.assetBytes },
): Promise<FetchedBody> {
  let current = target;

  for (let hop = 0; hop <= LIMITS.redirects; hop++) {
    const url = new URL(current);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Nur http und https sind erlaubt.');
    }
    await assertPublicHost(url.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? LIMITS.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: opts.accept ?? '*/*',
          'Accept-Language': 'de,en;q=0.8',
        },
        cache: 'no-store',
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`Weiterleitung ohne Ziel (${res.status}).`);
      current = new URL(location, url).toString();
      continue;
    }

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > opts.maxBytes) throw new Error('Antwort ist zu gross.');

    const body = await readCapped(res, opts.maxBytes);
    return {
      url: url.toString(),
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      body,
    };
  }

  throw new Error('Zu viele Weiterleitungen.');
}

/** Liest den Body stueckweise und bricht ab, sobald das Limit ueberschritten wird. */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('Antwort ist zu gross.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/** Ruft erst https auf und probiert bei Netzfehlern die www-Variante. */
export async function fetchSite(domain: string): Promise<FetchedBody> {
  const attempts = [`https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`];
  let lastError: unknown = null;

  for (const attempt of attempts) {
    try {
      const res = await safeFetch(attempt, {
        maxBytes: LIMITS.htmlBytes,
        accept: 'text/html,application/xhtml+xml',
      });
      if (res.status >= 200 && res.status < 300) return res;
      lastError = new Error(`Website antwortete mit ${res.status}.`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Website nicht erreichbar.');
}
