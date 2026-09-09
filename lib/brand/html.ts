import type { LogoCandidate } from './types';

/** Attribute eines Tags in ein Objekt mit Kleinbuchstaben-Schluesseln lesen. */
function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const value = m[2] ?? '';
    const unquoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value;
    attrs[m[1]!.toLowerCase()] = decodeEntities(unquoted);
  }
  return attrs;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x2f;/gi, '/')
    .replace(/&nbsp;/g, ' ');
}

function absolute(url: string, base: string): string | null {
  const value = url.trim();
  if (!value) return null;
  if (value.startsWith('data:')) return value.length > 4_000_000 ? null : value;
  try {
    const resolved = new URL(value, base);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

/** Groesste Auswahl aus einem srcset - dort steht meist die hoechste Aufloesung. */
function pickFromSrcset(srcset: string): { url: string; width?: number } | null {
  const entries = srcset
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, descriptor] = part.split(/\s+/, 2);
      const width = descriptor?.endsWith('w') ? Number(descriptor.slice(0, -1)) : undefined;
      return { url: url ?? '', width: Number.isFinite(width) ? width : undefined };
    })
    .filter((e) => e.url);
  if (entries.length === 0) return null;
  entries.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return entries[0]!;
}

const LOGO_WORDS = /logo|brand|wordmark|marke|signet|emblem|lockup/i;
const HEADERISH = /header|masthead|topbar|navbar|nav|brand|logo/i;

function hintOf(attrs: Record<string, string>, url: string): string | undefined {
  const parts = [attrs.alt, attrs.class, attrs.id, attrs.title, attrs['aria-label'], url]
    .filter(Boolean)
    .join(' ');
  return parts || undefined;
}

function numeric(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "180x180" oder "any" aus dem sizes-Attribut eines link-Tags. */
function parseSizes(sizes: string | undefined): number | undefined {
  if (!sizes) return undefined;
  if (/any/i.test(sizes)) return 512; // skalierbares Icon, wie ein grosses behandeln
  const found = [...sizes.matchAll(/(\d+)\s*[x×]\s*(\d+)/gi)].map((m) => Number(m[1]));
  return found.length ? Math.max(...found) : undefined;
}

export type ParsedDocument = {
  candidates: LogoCandidate[];
  /** CSS aus style-Bloecken und style-Attributen. */
  inlineCss: string;
  /** Absolute URLs verlinkter Stylesheets, in Dokumentreihenfolge. */
  stylesheets: string[];
  title: string | null;
  siteName: string | null;
  themeColor: string | null;
};

/**
 * Laeuft einmal durch das Dokument und sammelt dabei Logo-Kandidaten, CSS und
 * Metadaten ein. Bewusst ein Tag-Scanner statt eines vollen DOM-Parsers: die
 * gesuchten Angaben stehen alle in Attributen, und so bleibt die Route ohne
 * zusaetzliche Abhaengigkeit.
 */
export function parseDocument(html: string, baseUrl: string): ParsedDocument {
  const candidates: LogoCandidate[] = [];
  const stylesheets: string[] = [];
  const cssParts: string[] = [];
  let title: string | null = null;
  let siteName: string | null = null;
  let themeColor: string | null = null;

  // Ein <base href> verschiebt die Aufloesung aller relativen URLs.
  const baseTag = html.match(/<base\b[^>]*>/i);
  if (baseTag) {
    const href = parseAttrs(baseTag[0]).href;
    const resolved = href ? absolute(href, baseUrl) : null;
    if (resolved) baseUrl = resolved;
  }

  const headEnd = html.search(/<\/head\s*>/i);
  const headLength = headEnd > 0 ? headEnd : Math.min(html.length, 4000);
  /** Alles im ersten Fuenftel des Bodys zaehlt als "oben auf der Seite". */
  const topOfPage = headLength + (html.length - headLength) * 0.2;

  let containerDepth = 0; // > 0 = innerhalb header/nav
  let index = 0;

  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(html))) {
    const closing = match[1] === '/';
    const tag = match[2]!.toLowerCase();
    const rawAttrs = match[3] ?? '';
    const position = match.index;
    index++;

    if (tag === 'header' || tag === 'nav') {
      if (closing) containerDepth = Math.max(0, containerDepth - 1);
      else if (!rawAttrs.trimEnd().endsWith('/')) containerDepth++;
      continue;
    }
    if (closing) continue;

    const attrs = parseAttrs(rawAttrs);
    const classish = `${attrs.class ?? ''} ${attrs.id ?? ''}`;
    const inHeader = containerDepth > 0 || HEADERISH.test(classish) || position < topOfPage;

    // style-Attribute mitnehmen: dort stecken Hintergrundbilder und Markenfarben.
    if (attrs.style) cssParts.push(attrs.style);

    switch (tag) {
      case 'title': {
        const end = html.indexOf('<', tagRe.lastIndex);
        if (end > 0 && title === null) {
          title = decodeEntities(html.slice(tagRe.lastIndex, end)).trim() || null;
        }
        break;
      }

      case 'meta': {
        const key = (attrs.property || attrs.name || '').toLowerCase();
        const content = attrs.content ?? '';
        if (!content) break;
        if (key === 'og:site_name') {
          siteName = content.trim();
        } else if (key === 'theme-color') {
          themeColor = content.trim();
        } else if (key === 'og:image' || key === 'og:image:secure_url' || key === 'og:image:url') {
          const url = absolute(content, baseUrl);
          if (url) {
            candidates.push({
              url,
              source: 'og:image',
              documentIndex: index,
              hint: content,
              inHeader: true,
            });
          }
        } else if (key === 'twitter:image' || key === 'twitter:image:src') {
          const url = absolute(content, baseUrl);
          if (url) {
            candidates.push({
              url,
              source: 'twitter:image',
              documentIndex: index,
              hint: content,
              inHeader: true,
            });
          }
        }
        break;
      }

      case 'link': {
        const rel = (attrs.rel ?? '').toLowerCase();
        const href = attrs.href ? absolute(attrs.href, baseUrl) : null;
        if (!href) break;

        if (rel.includes('stylesheet')) {
          if (stylesheets.length < 4) stylesheets.push(href);
          break;
        }
        const declared = parseSizes(attrs.sizes);
        if (rel.includes('apple-touch-icon')) {
          candidates.push({
            url: href,
            source: 'link:apple-touch-icon',
            documentIndex: index,
            declaredWidth: declared ?? 180,
            declaredHeight: declared ?? 180,
            hint: attrs.href,
            inHeader: true,
          });
        } else if (rel.includes('mask-icon')) {
          candidates.push({
            url: href,
            source: 'link:mask-icon',
            documentIndex: index,
            hint: attrs.href,
            inHeader: true,
          });
        } else if (rel.includes('icon')) {
          candidates.push({
            url: href,
            source: 'link:icon',
            documentIndex: index,
            declaredWidth: declared,
            declaredHeight: declared,
            hint: attrs.href,
            inHeader: true,
          });
        }
        break;
      }

      case 'img': {
        const fromSrcset = attrs.srcset ? pickFromSrcset(attrs.srcset) : null;
        const raw = fromSrcset?.url ?? attrs.src ?? attrs['data-src'] ?? '';
        const url = raw ? absolute(raw, baseUrl) : null;
        if (!url) break;
        const hint = hintOf(attrs, raw);
        const looksLikeLogo = hint ? LOGO_WORDS.test(hint) : false;
        // Bilder tief in der Seite ohne Logo-Hinweis sind fast immer Inhalt, kein Logo.
        if (!inHeader && !looksLikeLogo) break;
        candidates.push({
          url,
          source: inHeader ? 'img:header' : 'img:page',
          documentIndex: index,
          declaredWidth: fromSrcset?.width ?? numeric(attrs.width),
          declaredHeight: numeric(attrs.height),
          hint,
          inHeader,
        });
        break;
      }

      case 'svg': {
        const end = findClosing(html, tagRe.lastIndex, 'svg');
        if (end < 0) break;
        const inner = html.slice(match.index, end);
        tagRe.lastIndex = end;
        // Winzige Icons (Menue, Pfeile) und riesige Inline-Grafiken aussortieren.
        if (inner.length < 120 || inner.length > 120_000) break;
        const hint = hintOf(attrs, '');
        if (!inHeader && !(hint && LOGO_WORDS.test(hint))) break;
        const box = viewBoxSize(attrs.viewbox);
        candidates.push({
          url: svgToDataUri(inner),
          source: 'svg:inline',
          documentIndex: index,
          declaredWidth: numeric(attrs.width) ?? box?.w,
          declaredHeight: numeric(attrs.height) ?? box?.h,
          hint,
          inHeader,
        });
        break;
      }

      case 'style': {
        const end = findClosing(html, tagRe.lastIndex, 'style');
        if (end < 0) break;
        const css = html.slice(tagRe.lastIndex, Math.max(tagRe.lastIndex, end - 8));
        tagRe.lastIndex = end;
        cssParts.push(css);
        collectCssBackgrounds(css, baseUrl, index, candidates);
        break;
      }

      case 'script': {
        const end = findClosing(html, tagRe.lastIndex, 'script');
        if (end < 0) break;
        const contentStart = tagRe.lastIndex;
        tagRe.lastIndex = end;
        if (!/ld\+json/i.test(attrs.type ?? '')) break;
        const raw = html.slice(contentStart, Math.max(contentStart, end - 9));
        for (const found of jsonLdLogos(raw)) {
          const url = absolute(found, baseUrl);
          if (url) {
            candidates.push({
              url,
              source: 'json-ld',
              documentIndex: index,
              hint: 'json-ld logo',
              inHeader: true,
            });
          }
        }
        break;
      }
    }
  }

  return {
    candidates,
    inlineCss: cssParts.join('\n'),
    stylesheets,
    title,
    siteName,
    themeColor,
  };
}

/**
 * logo-Angaben aus einem JSON-LD-Block. schema.org erlaubt dort einen String, ein
 * ImageObject oder ein Array davon, und die Bloecke sind oft in @graph verschachtelt -
 * deshalb wird der ganze Baum durchlaufen statt nur die oberste Ebene gelesen.
 */
function jsonLdLogos(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return [];
  }

  const out: string[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 6 || out.length >= 4) return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    const record = node as Record<string, unknown>;
    for (const key of ['logo', 'image']) {
      const value = record[key];
      if (typeof value === 'string') out.push(value);
      else if (value && typeof value === 'object') {
        const url = (value as Record<string, unknown>).url;
        if (typeof url === 'string') out.push(url);
        else walk(value, depth + 1);
      }
    }
    for (const value of Object.values(record)) walk(value, depth + 1);
  };

  walk(parsed, 0);
  return out.slice(0, 4);
}

/** Index hinter dem passenden Schluss-Tag, verschachtelte gleiche Tags mitgezaehlt. */
function findClosing(html: string, from: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}\\b`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) {
      const close = html.indexOf('>', re.lastIndex);
      return close < 0 ? -1 : close + 1;
    }
  }
  return -1;
}

function viewBoxSize(viewBox: string | undefined): { w: number; h: number } | undefined {
  if (!viewBox) return undefined;
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [, , w, h] = parts as [number, number, number, number];
  return w > 0 && h > 0 ? { w, h } : undefined;
}

function svgToDataUri(svg: string): string {
  let markup = svg.trim();
  // Ohne xmlns rendert der SVG-Decoder die Datei nicht.
  if (!/xmlns\s*=/.test(markup)) {
    markup = markup.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return `data:image/svg+xml;base64,${Buffer.from(markup, 'utf8').toString('base64')}`;
}

/** url(...) aus background/background-image-Deklarationen ziehen. */
export function collectCssBackgrounds(
  css: string,
  baseUrl: string,
  indexBase: number,
  out: LogoCandidate[],
): void {
  const re = /background(?:-image)?\s*:[^;{}]*?url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(css)) && n < 40) {
    const url = absolute(m[1] ?? '', baseUrl);
    if (!url) continue;
    // Der Kontext vor der Deklaration verraet meist den Selektor.
    const context = css.slice(Math.max(0, m.index - 160), m.index);
    const selectorish = context.slice(context.lastIndexOf('}') + 1);
    const hint = `${selectorish} ${m[1]}`;
    if (!LOGO_WORDS.test(hint) && !HEADERISH.test(hint)) continue;
    out.push({
      url,
      source: 'css:background',
      documentIndex: indexBase + n,
      hint,
      inHeader: HEADERISH.test(hint),
    });
    n++;
  }
}
