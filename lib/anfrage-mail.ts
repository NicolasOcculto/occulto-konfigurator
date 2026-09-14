/**
 * Baut die Mail, die bei einer Anfrage rausgeht.
 *
 * Eigene Datei, damit sich der Inhalt ohne Versand erzeugen und ansehen laesst -
 * `node scripts/mailvorschau.mjs` schreibt eine Datei, die man im Browser
 * oeffnen kann. Sonst sieht man die Mail erst, wenn sie wirklich verschickt
 * wird, und das braucht einen Schluessel.
 *
 * Mailprogramme koennen wenig CSS: keine Klassen, keine externen Stile, keine
 * Rasterlayouts. Deshalb eine Tabelle mit Stilen direkt an den Zellen.
 */

export type Anfrage = {
  firma: string;
  person: string;
  mail: string;
  telefon: string;
  produkt: string;
  menge: number;
  mengeText: string;
  logoName: string | null;
  nachricht: string;
  ausKonfigurator: boolean;
};

/** Zeichen, die in HTML eine Bedeutung haetten. Die Mail baut HTML aus Nutzertext. */
export function h(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SCHRIFT = "font-family:Helvetica,Arial,sans-serif";
const RAND = '1px solid #e4e4e1';

function zeile(name: string, wert: string, hervor = false): string {
  const inhalt = wert.trim() === '' ? '<span style="color:#9b9b96">&mdash;</span>' : h(wert);
  return (
    `<tr>` +
    `<th align="left" style="${SCHRIFT};font-size:13px;font-weight:600;color:#6b6b66;` +
    `padding:10px 20px 10px 0;vertical-align:top;white-space:nowrap;border-bottom:${RAND}">` +
    `${h(name)}</th>` +
    `<td style="${SCHRIFT};font-size:15px;color:#1c1c1c;padding:10px 0;vertical-align:top;` +
    `border-bottom:${RAND}${hervor ? ';font-weight:700' : ''}">${inhalt}</td>` +
    `</tr>`
  );
}

/** Betreff: Firma zuerst, damit die Liste im Postfach lesbar bleibt. */
export function betreff(a: Anfrage): string {
  return `B2B-Anfrage: ${a.firma} — ${a.produkt}, ${a.mengeText}`;
}

export function htmlMail(a: Anfrage): string {
  const zeilen = [
    zeile('Firma', a.firma, true),
    zeile('Ansprechpartner', a.person),
    zeile('E-Mail', a.mail),
    zeile('Telefon', a.telefon),
    zeile('Produkt', a.produkt, true),
    zeile('Menge gesamt', a.mengeText, true),
    zeile('Logo', a.logoName ? `als Anhang: ${a.logoName}` : 'noch keins'),
    zeile('Aus dem Konfigurator', a.ausKonfigurator ? 'ja' : 'nein'),
    zeile('Nachricht', a.nachricht),
  ].join('');

  // Die Antwortadresse steht zusaetzlich im Text: manche Postfaecher zeigen
  // reply_to nicht an, und dann sucht man die Adresse des Absenders.
  return (
    `<div style="${SCHRIFT};background:#f4f3f1;padding:24px">` +
    `<div style="max-width:620px;margin:0 auto;background:#ffffff;border:${RAND};border-radius:10px;padding:28px 30px">` +
    `<p style="${SCHRIFT};font-size:12px;letter-spacing:.08em;text-transform:uppercase;` +
    `color:#6b6b66;margin:0 0 6px">Occulto B2B</p>` +
    `<h1 style="${SCHRIFT};font-size:21px;margin:0 0 4px;color:#1c1c1c">Neue Anfrage von ${h(a.firma)}</h1>` +
    `<p style="${SCHRIFT};font-size:14px;color:#6b6b66;margin:0 0 22px">` +
    `Antworten geht direkt auf diese Mail &ndash; sie landet bei ${h(a.mail)}.</p>` +
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">${zeilen}</table>` +
    `</div></div>`
  );
}

/** Rein textliche Fassung fuer Programme, die kein HTML anzeigen. */
export function textMail(a: Anfrage): string {
  return [
    `Neue B2B-Anfrage von ${a.firma}`,
    '',
    `Ansprechpartner: ${a.person}`,
    `E-Mail:          ${a.mail}`,
    `Telefon:         ${a.telefon || '—'}`,
    `Produkt:         ${a.produkt}`,
    `Menge gesamt:    ${a.mengeText}`,
    `Logo:            ${a.logoName ? `als Anhang: ${a.logoName}` : 'noch keins'}`,
    `Konfigurator:    ${a.ausKonfigurator ? 'ja' : 'nein'}`,
    '',
    'Nachricht:',
    a.nachricht || '—',
  ].join('\n');
}
