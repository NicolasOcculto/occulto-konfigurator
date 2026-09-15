import Anfrage from '@/components/Anfrage';
import { ANFRAGE_KATEGORIEN } from '@/lib/products';

/** Rueckfallweg, wenn der Versand scheitert. Gleiche Adresse wie der Empfaenger. */
const FALLBACK_MAIL = process.env.ANFRAGE_EMPFAENGER || 'support@occulto.de';

/**
 * Die Datenschutzerklaerung liegt im Shop, nicht in dieser App. Ein relativer
 * Link zeigte im iframe auf die App selbst und lief ins Leere. Die
 * einbettende Seite gibt die richtige Adresse als Parameter mit; der Wert
 * hier ist nur der Rueckfall fuer den Aufruf ohne Einbettung.
 */
const DATENSCHUTZ_FALLBACK = 'https://occulto.de/policies/privacy-policy';

export const metadata = {
  title: 'Occulto — Anfrage stellen',
  description: 'Socken mit Logo anfragen: Produkt, Design und Menge in drei Schritten.',
};

/**
 * `?eingebettet=1` wie beim Konfigurator: kein Aussenabstand, h2 statt h1.
 *
 * Zwei Einbauorte teilen sich diese Route - der Abschnitt der Landingpage und
 * die eigenstaendige Seite fuer die CTAs der Produktseiten.
 */
export default async function AnfrageSeite({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // Nur eigene Adressen zulassen: der Parameter kommt von der einbettenden
  // Seite, und wer die ist, bestimmt nicht die App. Ein fremdes Ziel hinter
  // dem Wort Datenschutz waere genau die Art Link, die niemand prueft.
  const roh = typeof params.datenschutz === 'string' ? params.datenschutz : '';
  const ERLAUBT = /^https:\/\/([a-z0-9-]+\.)*occulto\.de\/[\w/-]*$/i;
  const datenschutz = ERLAUBT.test(roh) ? roh : DATENSCHUTZ_FALLBACK;

  return (
    <Anfrage
      kategorien={ANFRAGE_KATEGORIEN}
      eingebettet={params.eingebettet === '1'}
      fallbackMail={FALLBACK_MAIL}
      datenschutz={datenschutz}
    />
  );
}
