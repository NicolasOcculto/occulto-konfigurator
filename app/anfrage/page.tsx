import Anfrage from '@/components/Anfrage';
import { ANFRAGE_KATEGORIEN } from '@/lib/products';
import { istDatenschutz } from '@/lib/einbettung';
import { ANFRAGE_METADATA, DATENSCHUTZ_FALLBACK, FALLBACK_MAIL } from '@/lib/anfrage-seite';

export const metadata = ANFRAGE_METADATA;

/**
 * Die eigenstaendige Seite fuer die CTAs der Produktseiten.
 *
 * `?eingebettet=1` gilt hier weiter, damit eine Landingpage mit der alten
 * Adresse im iframe nicht bricht. Neu eingebettet wird unter
 * /anfrage/eingebettet - die Seite ist vorab gebaut und kommt aus dem Cache.
 */
export default async function AnfrageSeite({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const roh = typeof params.datenschutz === 'string' ? params.datenschutz : '';

  return (
    <Anfrage
      kategorien={ANFRAGE_KATEGORIEN}
      eingebettet={params.eingebettet === '1'}
      fallbackMail={FALLBACK_MAIL}
      datenschutz={istDatenschutz(roh) ? roh : DATENSCHUTZ_FALLBACK}
    />
  );
}
