import Anfrage from '@/components/Anfrage';
import { PRODUCT_CARDS } from '@/lib/products';

/** Rueckfallweg, wenn der Versand scheitert. Gleiche Adresse wie der Empfaenger. */
const FALLBACK_MAIL = process.env.ANFRAGE_EMPFAENGER || 'nicolas.grinninger@occulto.de';

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

  return (
    <Anfrage
      products={PRODUCT_CARDS}
      eingebettet={params.eingebettet === '1'}
      fallbackMail={FALLBACK_MAIL}
    />
  );
}
