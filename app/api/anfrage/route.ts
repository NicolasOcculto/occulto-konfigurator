import { NextResponse } from 'next/server';
import { PRODUCT_BY_KEY } from '@/lib/products';
import { clientIp, rateLimit, rateLimitHeaders } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIMIT_PER_HOUR = 10;
const WINDOW_SECONDS = 60 * 60;

const MAX_LOGO_BYTES = 5_000_000;
const ERLAUBTE_TYPEN = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);

const EMPFAENGER = process.env.ANFRAGE_EMPFAENGER || 'nicolas.grinninger@occulto.de';
// Resend verlangt einen Absender auf einer dort freigeschalteten Domain.
// onboarding@resend.dev funktioniert ohne eigene Domain, aber nur an die
// Adresse des Kontoinhabers - fuer den Echtbetrieb muss occulto.de dort stehen.
const ABSENDER = process.env.ANFRAGE_ABSENDER || 'Occulto B2B <onboarding@resend.dev>';

const MENGEN = new Set([100, 250, 500, 1000, 2000]);
const UNENTSCHIEDEN = 'unklar';

/** Zeichen, die in HTML eine Bedeutung haetten. Die Mail baut HTML aus Nutzertext. */
function h(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function text(value: unknown, maxLaenge: number): string {
  if (typeof value !== 'string') return '';
  // Steuerzeichen raus: sie gehoeren in keinem Feld hin und ermoeglichen in
  // Kopfzeilen Zeilenumbrueche, wo keine sein sollen.
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLaenge);
}

/** Absichtlich streng, aber ohne Anspruch auf Vollstaendigkeit: ein Tippfehler-Sieb. */
const MAIL_MUSTER = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

type Anhang = { filename: string; content: string; contentType: string };

/** data:-URI in einen Mailanhang umwandeln. Gibt null zurueck, wenn etwas nicht stimmt. */
function anhangAus(dataUri: string, name: string): Anhang | null {
  const treffer = /^data:([^;,]+);base64,(.+)$/s.exec(dataUri.trim());
  if (!treffer) return null;

  const typ = treffer[1]!.toLowerCase();
  if (!ERLAUBTE_TYPEN.has(typ)) return null;

  const base64 = treffer[2]!;
  // 4 Base64-Zeichen ergeben 3 Bytes; das reicht, um die Groesse zu pruefen,
  // ohne die Daten erst zu dekodieren.
  if ((base64.length * 3) / 4 > MAX_LOGO_BYTES) return null;

  const puffer = Buffer.from(base64, 'base64');
  if (puffer.length === 0 || puffer.length > MAX_LOGO_BYTES) return null;

  const endung = typ === 'image/png' ? 'png' : typ === 'image/jpeg' ? 'jpg' : 'svg';
  const sauber = name.replace(/[^\w.-]+/g, '-').slice(0, 60) || `logo.${endung}`;
  return {
    filename: /\.[a-z0-9]+$/i.test(sauber) ? sauber : `${sauber}.${endung}`,
    content: puffer.toString('base64'),
    contentType: typ,
  };
}

function zeile(name: string, wert: string): string {
  return (
    `<tr><th align="left" style="padding:6px 14px 6px 0;vertical-align:top;` +
    `border-bottom:1px solid #eee;white-space:nowrap">${h(name)}</th>` +
    `<td style="padding:6px 0;border-bottom:1px solid #eee">${h(wert) || '&mdash;'}</td></tr>`
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const limit = await rateLimit(
    'anfrage',
    clientIp(request.headers),
    LIMIT_PER_HOUR,
    WINDOW_SECONDS,
  );
  const headers = rateLimitHeaders(limit);

  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Zu viele Anfragen von hier. Bitte später noch einmal.' },
      { status: 429, headers },
    );
  }

  let roh: Record<string, unknown>;
  try {
    roh = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Die Anfrage war unlesbar.' }, { status: 400, headers });
  }

  /* ---------- Pflichtfelder ---------- */

  const firma = text(roh.firma, 120);
  const person = text(roh.person, 120);
  const mail = text(roh.mail, 160);

  if (!firma || !person || !mail) {
    return NextResponse.json(
      { error: 'Firma, Ansprechpartner und E-Mail werden gebraucht.' },
      { status: 400, headers },
    );
  }
  if (!MAIL_MUSTER.test(mail)) {
    return NextResponse.json(
      { error: 'Die E-Mail-Adresse sieht nicht richtig aus.' },
      { status: 400, headers },
    );
  }

  /* ---------- Auswahl ---------- */

  const produktSchluessel = text(roh.produkt, 40);
  const produkt =
    produktSchluessel === UNENTSCHIEDEN
      ? 'Weiß noch nicht'
      : (PRODUCT_BY_KEY.get(produktSchluessel)?.label ?? '');
  if (!produkt) {
    return NextResponse.json({ error: 'Unbekanntes Produkt.' }, { status: 400, headers });
  }

  const menge = typeof roh.menge === 'number' && MENGEN.has(roh.menge) ? roh.menge : null;
  if (menge === null) {
    return NextResponse.json({ error: 'Unbekannte Stückzahl.' }, { status: 400, headers });
  }

  /* ---------- Logo ---------- */

  let anhang: Anhang | null = null;
  if (typeof roh.logo === 'string' && roh.logo) {
    anhang = anhangAus(roh.logo, text(roh.logoName, 80));
    if (!anhang) {
      return NextResponse.json(
        { error: 'Das Logo ließ sich nicht verarbeiten. PNG, JPG oder SVG bis 5 MB.' },
        { status: 400, headers },
      );
    }
  }

  /* ---------- Mail bauen ---------- */

  const telefon = text(roh.telefon, 60);
  const nachricht = text(roh.nachricht, 4000);
  const ausKonfigurator = roh.ausKonfigurator === true;

  const tabelle =
    `<table style="border-collapse:collapse;font:14px/1.5 Helvetica,Arial,sans-serif">` +
    zeile('Firma', firma) +
    zeile('Ansprechpartner', person) +
    zeile('E-Mail', mail) +
    zeile('Telefon', telefon) +
    zeile('Produkt', produkt) +
    zeile('Menge gesamt', menge >= 2000 ? `${menge}+` : String(menge)) +
    zeile('Logo', anhang ? `als Anhang: ${anhang.filename}` : 'noch keins') +
    zeile('Aus dem Konfigurator', ausKonfigurator ? 'ja' : 'nein') +
    zeile('Nachricht', nachricht) +
    `</table>`;

  const koerper =
    `<p style="font:14px/1.5 Helvetica,Arial,sans-serif">Neue B2B-Anfrage über die Landingpage.</p>` +
    tabelle;

  const schluessel = process.env.RESEND_API_KEY;
  if (!schluessel) {
    // Lieber ehrlich scheitern als so tun, als sei die Anfrage unterwegs.
    console.error('[anfrage] RESEND_API_KEY fehlt - Anfrage wurde nicht versendet');
    return NextResponse.json(
      { error: 'Der Versand ist gerade nicht eingerichtet.' },
      { status: 503, headers },
    );
  }

  try {
    const antwort = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${schluessel}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: ABSENDER,
        to: [EMPFAENGER],
        reply_to: mail,
        subject: `B2B-Anfrage: ${firma}`,
        html: koerper,
        ...(anhang
          ? { attachments: [{ filename: anhang.filename, content: anhang.content }] }
          : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!antwort.ok) {
      const grund = await antwort.text().catch(() => '');
      console.error('[anfrage] Resend antwortete', antwort.status, grund.slice(0, 400));
      return NextResponse.json(
        { error: 'Die Anfrage kam nicht durch.' },
        { status: 502, headers },
      );
    }
  } catch (err) {
    console.error('[anfrage] Versand fehlgeschlagen', err);
    return NextResponse.json({ error: 'Die Anfrage kam nicht durch.' }, { status: 502, headers });
  }

  return NextResponse.json({ ok: true }, { headers });
}
