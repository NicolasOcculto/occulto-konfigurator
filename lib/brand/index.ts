import 'server-only';

import { cacheGet, cacheSet } from '../cache';
import { extractBrandColors } from './colors';
import { configuredFallbacks, fallbackLogo } from './fallback';
import { LIMITS, fetchSite, normalizeDomain, safeFetch } from './fetch';
import { collectCssBackgrounds, parseDocument } from './html';
import { resolveBestLogo, resolveSingle } from './score';
import type { BrandResult, LogoCandidate } from './types';

export { normalizeDomain };
export type { BrandResult };

/** 30 Tage, wie gefordert. */
export const BRAND_CACHE_TTL = 60 * 60 * 24 * 30;
const CACHE_VERSION = 'v1';

/** Firmenname aus og:site_name oder dem Seitentitel ableiten. */
function guessCompany(siteName: string | null, title: string | null, domain: string): string {
  if (siteName) return siteName.trim();
  if (title) {
    // Titel sind meist "Marke - Claim" oder "Seite | Marke".
    const parts = title.split(/\s+[|–—-]\s+/).filter(Boolean);
    const shortest = parts.sort((a, b) => a.length - b.length)[0];
    if (shortest && shortest.length >= 2 && shortest.length <= 40) return shortest.trim();
    return title.slice(0, 40).trim();
  }
  const label = domain.split('.')[0] ?? domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Verlinkte Stylesheets nachladen - dort stehen Markenfarben und Hintergrundlogos. */
async function loadStylesheets(
  urls: string[],
  baseUrl: string,
  candidates: LogoCandidate[],
): Promise<Array<{ css: string; scale: number }>> {
  const sheets = await Promise.all(
    urls.slice(0, 3).map(async (url) => {
      try {
        const res = await safeFetch(url, { maxBytes: 900_000, accept: 'text/css' });
        if (res.status !== 200) return null;
        return { url: res.url, css: res.body.toString('utf8') };
      } catch {
        return null;
      }
    }),
  );

  const out: Array<{ css: string; scale: number }> = [];
  for (const sheet of sheets) {
    if (!sheet) continue;
    // Relative url() im Stylesheet loesen gegen dessen eigene Adresse auf, nicht gegen die Seite.
    collectCssBackgrounds(sheet.css, sheet.url || baseUrl, 5000, candidates);
    out.push({ css: sheet.css, scale: 0.8 });
  }
  return out;
}

async function extract(domain: string): Promise<BrandResult> {
  const notes: string[] = [];
  const site = await fetchSite(domain);
  const html = site.body.toString('utf8');
  const doc = parseDocument(html, site.url);

  const cssSources = [{ css: doc.inlineCss, scale: 1 }];
  cssSources.push(...(await loadStylesheets(doc.stylesheets, site.url, doc.candidates)));

  // Das klassische Favicon als letzter Kandidat, falls das Markup keins nennt.
  if (!doc.candidates.some((c) => c.source.startsWith('link:'))) {
    doc.candidates.push({
      url: new URL('/favicon.ico', site.url).toString(),
      source: 'favicon.ico',
      documentIndex: 9999,
      inHeader: true,
    });
  }

  const colors = extractBrandColors(cssSources);
  if (doc.themeColor) {
    // theme-color ist eine bewusste Angabe der Seite und zaehlt entsprechend schwer.
    const extra = extractBrandColors([{ css: `--theme-color: ${doc.themeColor};`, scale: 14 }]);
    for (const c of extra) {
      if (!colors.some((existing) => existing.hex === c.hex)) colors.unshift(c);
    }
  }

  const logo = await resolveBestLogo(doc.candidates);
  const company = guessCompany(doc.siteName, doc.title, domain);

  if (logo && logo.score >= 60) {
    return {
      domain,
      siteUrl: site.url,
      title: doc.title,
      company,
      logo,
      colors: colors.slice(0, 6),
      strategy: 'extracted',
      cached: false,
      notes,
    };
  }

  // Eigene Erkennung hat nichts Brauchbares gefunden: Rueckfallebene versuchen.
  const available = configuredFallbacks();
  if (available.length === 0) {
    notes.push('Keine Rueckfallebene konfiguriert (LOGO_DEV_TOKEN / BRANDFETCH_API_KEY fehlen).');
  } else {
    const fallback = await fallbackLogo(domain);
    if (fallback) {
      const merged = [...colors];
      for (const c of fallback.colors) {
        if (!merged.some((existing) => existing.hex === c.hex)) merged.push(c);
      }
      merged.sort((a, b) => b.weight - a.weight);
      return {
        domain,
        siteUrl: site.url,
        title: doc.title,
        company,
        logo: fallback.logo,
        colors: merged.slice(0, 6),
        strategy: fallback.strategy,
        cached: false,
        notes,
      };
    }
    notes.push('Rueckfallebene lieferte kein Logo.');
  }

  return {
    domain,
    siteUrl: site.url,
    title: doc.title,
    company,
    logo,
    colors: colors.slice(0, 6),
    strategy: logo ? 'extracted' : 'none',
    cached: false,
    notes,
  };
}

/** Wenn die Website selbst nicht erreichbar ist, bleibt nur die Rueckfallebene. */
async function fallbackOnly(domain: string, reason: string): Promise<BrandResult> {
  const notes = [`Website nicht auswertbar: ${reason}`];
  const fallback = await fallbackLogo(domain);
  const company = guessCompany(null, null, domain);

  if (!fallback) {
    if (configuredFallbacks().length === 0) {
      notes.push('Keine Rueckfallebene konfiguriert (LOGO_DEV_TOKEN / BRANDFETCH_API_KEY fehlen).');
    }
    return {
      domain,
      siteUrl: null,
      title: null,
      company,
      logo: null,
      colors: [],
      strategy: 'none',
      cached: false,
      notes,
    };
  }

  return {
    domain,
    siteUrl: null,
    title: null,
    company,
    logo: fallback.logo,
    colors: fallback.colors.slice(0, 6),
    strategy: fallback.strategy,
    cached: false,
    notes,
  };
}

/**
 * Markendaten zu einer Domain, 30 Tage zwischengespeichert.
 * Ergebnisse ohne Logo werden nur kurz gehalten, damit ein spaeter nachgeruesteter
 * API-Schluessel oder ein Relaunch der Website nicht einen Monat lang blockiert wird.
 */
export async function getBrand(domain: string): Promise<BrandResult> {
  const key = `brand:${CACHE_VERSION}:${domain}`;
  const cached = await cacheGet<BrandResult>(key);
  if (cached) return { ...cached, cached: true };

  let result: BrandResult;
  try {
    result = await extract(domain);
  } catch (err) {
    result = await fallbackOnly(domain, err instanceof Error ? err.message : 'unbekannter Fehler');
  }

  await cacheSet(key, result, result.logo ? BRAND_CACHE_TTL : 60 * 60);
  return result;
}

export { LIMITS, resolveSingle };
