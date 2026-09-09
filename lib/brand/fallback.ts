import 'server-only';

import { LIMITS } from './fetch';
import { resolveSingle } from './score';
import type { BrandColor, ResolvedLogo } from './types';

/**
 * Rueckfallebenen fuer die Logo-Erkennung.
 *
 * Die Schluessel werden ausschliesslich hier, auf dem Server, aus process.env
 * gelesen. Das Modul importiert `server-only`: landet es versehentlich in einem
 * Client-Bundle, schlaegt schon der Build fehl statt erst die Sicherheit.
 */

export type FallbackResult = {
  logo: ResolvedLogo;
  colors: BrandColor[];
  strategy: 'logo.dev' | 'brandfetch';
};

export function configuredFallbacks(): Array<'logo.dev' | 'brandfetch'> {
  const available: Array<'logo.dev' | 'brandfetch'> = [];
  if (process.env.LOGO_DEV_TOKEN) available.push('logo.dev');
  if (process.env.BRANDFETCH_API_KEY) available.push('brandfetch');
  return available;
}

async function fromLogoDev(domain: string): Promise<FallbackResult | null> {
  const token = process.env.LOGO_DEV_TOKEN;
  if (!token) return null;

  const url = new URL(`https://img.logo.dev/${encodeURIComponent(domain)}`);
  url.searchParams.set('token', token);
  url.searchParams.set('size', '512');
  url.searchParams.set('format', 'png');
  url.searchParams.set('retina', 'true');
  // Ohne diesen Schalter liefert der Dienst einen generierten Buchstaben statt eines Fehlers.
  url.searchParams.set('fallback', '404');

  const logo = await resolveSingle(url.toString(), 'logo.dev');
  if (!logo) return null;
  // Die URL traegt den Schluessel - sie darf nicht an den Client gehen.
  return { logo: { ...logo, url: `logo.dev:${domain}` }, colors: [], strategy: 'logo.dev' };
}

type BrandfetchResponse = {
  name?: string;
  logos?: Array<{
    type?: string;
    theme?: string;
    formats?: Array<{ src?: string; format?: string; width?: number; height?: number }>;
  }>;
  colors?: Array<{ hex?: string; type?: string }>;
};

async function fromBrandfetch(domain: string): Promise<FallbackResult | null> {
  const key = process.env.BRANDFETCH_API_KEY;
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.timeoutMs);
  let payload: BrandfetchResponse;
  try {
    const res = await fetch(`https://api.brandfetch.io/v2/brands/${encodeURIComponent(domain)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    payload = (await res.json()) as BrandfetchResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  // Vollstaendiges Logo vor Bildmarke, helle Fassung vor dunkler, SVG vor Raster.
  const typeRank = (t?: string) => (t === 'logo' ? 0 : t === 'symbol' ? 1 : 2);
  const entries = (payload.logos ?? [])
    .flatMap((logo) =>
      (logo.formats ?? []).map((format) => ({
        src: format.src,
        isSvg: format.format === 'svg',
        area: (format.width ?? 0) * (format.height ?? 0),
        rank: typeRank(logo.type) + (logo.theme === 'dark' ? 0.5 : 0),
      })),
    )
    .filter((e): e is { src: string; isSvg: boolean; area: number; rank: number } =>
      Boolean(e.src),
    )
    .sort((a, b) => a.rank - b.rank || Number(b.isSvg) - Number(a.isSvg) || b.area - a.area);

  const colors: BrandColor[] = (payload.colors ?? [])
    .filter((c) => typeof c.hex === 'string' && /^#[0-9a-f]{6}$/i.test(c.hex))
    .map((c, i) => ({ hex: c.hex!.toUpperCase(), weight: c.type === 'brand' ? 100 - i : 50 - i }));

  for (const entry of entries.slice(0, 3)) {
    const logo = await resolveSingle(entry.src, 'brandfetch');
    if (logo) return { logo, colors, strategy: 'brandfetch' };
  }
  return null;
}

/** Probiert die konfigurierten Dienste der Reihe nach durch. */
export async function fallbackLogo(domain: string): Promise<FallbackResult | null> {
  return (await fromLogoDev(domain)) ?? (await fromBrandfetch(domain));
}
