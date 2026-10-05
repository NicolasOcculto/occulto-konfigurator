import { empfaengerAus } from '@/lib/empfaenger';

/**
 * Was die beiden Formularseiten teilen - die eigenstaendige unter /anfrage
 * und die eingebettete unter /anfrage/eingebettet.
 */

// Scheitert der Versand, bietet das Formular diese Adresse als Weg an.
// ANFRAGE_EMPFAENGER kann mehrere enthalten - in einem mailto-Link steht die
// erste, alles andere waere fuer den Besucher nur verwirrend.
export const FALLBACK_MAIL = empfaengerAus(process.env.ANFRAGE_EMPFAENGER)[0];

/**
 * Die Datenschutzerklaerung liegt im Shop, nicht in dieser App. Ein relativer
 * Link zeigte im iframe auf die App selbst und lief ins Leere. Die
 * einbettende Seite gibt die richtige Adresse als Parameter mit; der Wert
 * hier ist nur der Rueckfall.
 */
export const DATENSCHUTZ_FALLBACK = 'https://occulto.de/policies/privacy-policy';

export const ANFRAGE_METADATA = {
  title: 'Occulto — Anfrage stellen',
  description: 'Socken mit Logo anfragen: Produkt, Design und Menge in drei Schritten.',
};
