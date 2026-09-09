/**
 * Cache mit zwei Ebenen.
 *
 * Sind UPSTASH_REDIS_REST_URL und -TOKEN gesetzt, laeuft der Cache ueber Redis und
 * gilt damit fuer alle Serverless-Instanzen gemeinsam. Ohne diese Variablen faellt
 * er auf eine prozesslokale Map zurueck: funktioniert lokal und auf einer einzelnen
 * Instanz, ueberlebt aber keinen Kaltstart.
 *
 * Beide Ebenen werden zusammen benutzt - die Map dient auch bei aktivem Redis als
 * schneller Vorcache innerhalb einer warmen Instanz.
 */

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export const hasSharedStore = Boolean(REDIS_URL && REDIS_TOKEN);

type Entry = { value: unknown; expiresAt: number };

const memory = new Map<string, Entry>();
const MEMORY_MAX_ENTRIES = 500;

function memoryGet<T>(key: string): T | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  // Zuletzt benutzt ans Ende schieben, damit die Verdraengung LRU-artig arbeitet.
  memory.delete(key);
  memory.set(key, hit);
  return hit.value as T;
}

function memorySet(key: string, value: unknown, ttlSeconds: number): void {
  if (memory.size >= MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next();
    if (!oldest.done) memory.delete(oldest.value);
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function redis(command: unknown[]): Promise<unknown> {
  if (!hasSharedStore) return null;
  const res = await fetch(REDIS_URL!, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Redis antwortete mit ${res.status}`);
  const body = (await res.json()) as { result?: unknown };
  return body.result ?? null;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const local = memoryGet<T>(key);
  if (local !== null) return local;
  if (!hasSharedStore) return null;
  try {
    const raw = await redis(['GET', key]);
    if (typeof raw !== 'string') return null;
    return JSON.parse(raw) as T;
  } catch {
    // Ein ausgefallener Cache darf die Anfrage nicht scheitern lassen.
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  memorySet(key, value, ttlSeconds);
  if (!hasSharedStore) return;
  try {
    await redis(['SET', key, JSON.stringify(value), 'EX', String(ttlSeconds)]);
  } catch {
    // still: die lokale Ebene hat den Wert.
  }
}

/**
 * Zaehlt einen Schluessel hoch und liefert den Stand. Beim ersten Treffer wird die
 * Lebensdauer gesetzt, damit das Fenster mit dem ersten Zugriff beginnt.
 */
export async function cacheIncrement(
  key: string,
  windowSeconds: number,
): Promise<{ count: number; resetAt: number }> {
  if (hasSharedStore) {
    try {
      const count = Number(await redis(['INCR', key]));
      if (count === 1) await redis(['EXPIRE', key, String(windowSeconds)]);
      const ttl = Number(await redis(['TTL', key]));
      const resetAt = Date.now() + (ttl > 0 ? ttl : windowSeconds) * 1000;
      return { count, resetAt };
    } catch {
      // auf die lokale Zaehlung zurueckfallen
    }
  }

  const existing = memory.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    existing.value = (existing.value as number) + 1;
    return { count: existing.value as number, resetAt: existing.expiresAt };
  }
  const expiresAt = Date.now() + windowSeconds * 1000;
  memory.set(key, { value: 1, expiresAt });
  return { count: 1, resetAt: expiresAt };
}
