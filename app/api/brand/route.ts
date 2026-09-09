import { NextResponse } from 'next/server';
import { getBrand, normalizeDomain } from '@/lib/brand';
import { clientIp, rateLimit, rateLimitHeaders } from '@/lib/rate-limit';

// sharp und die DNS-Pruefung brauchen die Node-Laufzeit; Edge reicht hier nicht.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const LIMIT_PER_HOUR = 40;
const WINDOW_SECONDS = 60 * 60;

async function readDomain(request: Request): Promise<string | null> {
  if (request.method === 'GET') {
    return new URL(request.url).searchParams.get('domain');
  }
  try {
    const body = (await request.json()) as { domain?: unknown };
    return typeof body.domain === 'string' ? body.domain : null;
  } catch {
    return null;
  }
}

async function handle(request: Request): Promise<NextResponse> {
  const limit = await rateLimit('brand', clientIp(request.headers), LIMIT_PER_HOUR, WINDOW_SECONDS);
  const headers = rateLimitHeaders(limit);

  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Zu viele Anfragen. Bitte kurz warten.' },
      { status: 429, headers },
    );
  }

  const raw = await readDomain(request);
  if (!raw) {
    return NextResponse.json({ error: 'Bitte eine Domain angeben.' }, { status: 400, headers });
  }

  const domain = normalizeDomain(raw);
  if (!domain) {
    return NextResponse.json(
      { error: 'Das sieht nicht nach einer Domain aus. Beispiel: firma.de' },
      { status: 400, headers },
    );
  }

  try {
    const brand = await getBrand(domain);
    return NextResponse.json(brand, {
      headers: {
        ...headers,
        // Der Cache liegt serverseitig; der Browser soll nicht zusaetzlich festhalten.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[api/brand]', domain, err);
    return NextResponse.json(
      { error: 'Die Website liess sich nicht auswerten. Lade dein Logo einfach hoch.' },
      { status: 502, headers },
    );
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
