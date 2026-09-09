import { cacheIncrement, hasSharedStore } from './cache';

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Sekunden bis zum Zuruecksetzen des Fensters - fuer den Retry-After-Header. */
  retryAfter: number;
};

/**
 * Feste Zeitfenster pro IP. Ohne Redis zaehlt jede Serverless-Instanz fuer sich,
 * das Limit greift dann also nur weicher als konfiguriert.
 */
export async function rateLimit(
  bucket: string,
  ip: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const { count, resetAt } = await cacheIncrement(`rl:${bucket}:${ip}:${window}`, windowSeconds);
  return {
    ok: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfter: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  };
}

/**
 * Client-IP aus den Proxy-Headern. Auf Vercel ist x-forwarded-for gesetzt und der
 * erste Eintrag stammt vom Edge-Netz, ist also nicht frei faelschbar.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || '127.0.0.1';
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(result.retryAfter),
  };
  if (!result.ok) headers['Retry-After'] = String(result.retryAfter);
  if (!hasSharedStore) headers['RateLimit-Policy'] = 'instance-local';
  return headers;
}
