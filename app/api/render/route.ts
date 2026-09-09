import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { PRODUCTS, PRODUCT_BY_KEY, type Product } from '@/lib/products';
import { clientIp, rateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { renderMockup } from '@/lib/render/mockup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LIMIT_PER_HOUR = 120;
const WINDOW_SECONDS = 60 * 60;
const MAX_LOGO_BYTES = 4_000_000;

/** Produktfotos aendern sich zur Laufzeit nicht - einmal lesen genuegt je Instanz. */
const productImageCache = new Map<string, Buffer>();

async function productImage(product: Product): Promise<Buffer> {
  const cached = productImageCache.get(product.key);
  if (cached) return cached;
  const file = path.join(process.cwd(), 'public', 'products', product.file);
  const buffer = await readFile(file);
  productImageCache.set(product.key, buffer);
  return buffer;
}

/** data:-URI in Rohbytes umwandeln, mit Groessengrenze. */
function decodeDataUri(value: string): Buffer | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(value.trim());
  if (!match) return null;
  const mime = match[1] ?? '';
  if (mime && !mime.startsWith('image/')) return null;

  const buffer = match[2]
    ? Buffer.from(match[3]!, 'base64')
    : Buffer.from(decodeURIComponent(match[3]!), 'utf8');
  if (buffer.length === 0 || buffer.length > MAX_LOGO_BYTES) return null;
  return buffer;
}

const HEX = /^#?[0-9a-f]{3}$|^#?[0-9a-f]{6}$/i;

type RenderRequest = {
  logo?: unknown;
  color?: unknown;
  company?: unknown;
  products?: unknown;
  width?: unknown;
};

export async function POST(request: Request): Promise<NextResponse> {
  const limit = await rateLimit('render', clientIp(request.headers), LIMIT_PER_HOUR, WINDOW_SECONDS);
  const headers = rateLimitHeaders(limit);

  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Zu viele Anfragen. Bitte kurz warten.' },
      { status: 429, headers },
    );
  }

  let body: RenderRequest;
  try {
    body = (await request.json()) as RenderRequest;
  } catch {
    return NextResponse.json({ error: 'Ungueltiger Anfragekoerper.' }, { status: 400, headers });
  }

  const color = typeof body.color === 'string' && HEX.test(body.color) ? body.color : '#FFFFFF';
  const company =
    typeof body.company === 'string' ? body.company.slice(0, 40).trim() || undefined : undefined;

  let logo: Buffer | null = null;
  if (typeof body.logo === 'string' && body.logo.length > 0) {
    logo = decodeDataUri(body.logo);
    if (!logo) {
      return NextResponse.json(
        { error: 'Das Logo konnte nicht gelesen werden (Format oder Groesse).' },
        { status: 400, headers },
      );
    }
  }

  if (!logo && !company) {
    return NextResponse.json(
      { error: 'Ohne Logo oder Firmenname gibt es nichts zu zeigen.' },
      { status: 400, headers },
    );
  }

  const requested = Array.isArray(body.products)
    ? body.products.filter((k): k is string => typeof k === 'string')
    : null;
  const products =
    requested && requested.length > 0
      ? requested
          .map((key) => PRODUCT_BY_KEY.get(key))
          .filter((p): p is Product => p !== undefined)
      : PRODUCTS;

  if (products.length === 0) {
    return NextResponse.json({ error: 'Kein bekanntes Produkt angefragt.' }, { status: 400, headers });
  }

  const width =
    typeof body.width === 'number' && Number.isFinite(body.width)
      ? Math.min(1200, Math.max(240, Math.round(body.width)))
      : undefined;

  try {
    const results = await Promise.all(
      products.map(async (product) => {
        const image = await renderMockup({
          product,
          productImage: await productImage(product),
          logo,
          color,
          company,
          width,
        });
        return {
          key: product.key,
          label: product.label,
          image: `data:image/webp;base64,${image.toString('base64')}`,
        };
      }),
    );

    return NextResponse.json({ color, results }, { headers });
  } catch (err) {
    console.error('[api/render]', err);
    return NextResponse.json(
      { error: 'Die Vorschau liess sich nicht rendern.' },
      { status: 500, headers },
    );
  }
}
