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
      if (s.startsWith('@/')) return next('../' + s.slice(2), c);
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
};

await writeFile('mailvorschau.html', htmlMail(beispiel), 'utf8');
console.log('Betreff:', betreff(beispiel));
console.log('');
console.log(textMail(beispiel));
console.log('');
console.log('HTML-Fassung: mailvorschau.html');
