/**
 * Schreibt die Anfrage-Mail als Datei, damit man sie ohne Versand ansehen kann.
 * Aufruf: node scripts/mailvorschau.mjs
 *
 * Der Versand braucht einen Schluessel bei Resend. Bis der da ist, laesst sich
 * so trotzdem pruefen, was in der Mail steht und wie sie aussieht.
 */
import { writeFile } from 'node:fs/promises';
import { register } from 'node:module';

register('data:text/javascript,' +
  encodeURIComponent(`
    export async function resolve(s, c, next) {
      if (s.startsWith('@/')) return next('../' + s.slice(2) + (s.endsWith('.ts') ? '' : '.ts'), c);
      return next(s, c);
    }
  `), import.meta.url);

const { betreff, htmlMail, textMail } = await import('../lib/anfrage-mail.ts');

const beispiel = {
  firma: 'Muster & Partner GmbH',
  person: 'Alex Berger',
  mail: 'alex.berger@muster-partner.de',
  telefon: '+49 89 123456',
  produkt: 'Tennissocke',
  menge: 750,
  mengeText: '750 Paar',
  logoName: 'muster-partner-logo.png',
  nachricht: 'Für unser Sommerfest im Juli. Vereinsfarben blau/weiß, gern mit\nLogo auf dem Schaft.',
  ausKonfigurator: true,
  herkunft: {
    erst: { quelle: '', medium: '', kampagne: '', inhalt: '', klick: '', verweis: 'www.google.com', seite: '/', tag: '2026-09-28' },
    letzt: { quelle: 'meta', medium: 'paid_social', kampagne: 'herbst-2026', inhalt: 'video-2', klick: 'fbclid', verweis: '', seite: '/pages/personalisierte-socken-mit-logo', tag: '2026-10-02' },
  },
};

await writeFile('mailvorschau.html', htmlMail(beispiel), 'utf8');
console.log('Betreff:', betreff(beispiel));
console.log('');
console.log(textMail(beispiel));
console.log('');
console.log('HTML-Fassung: mailvorschau.html');
