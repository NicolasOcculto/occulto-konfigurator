import Anfrage from '@/components/Anfrage';
import { ANFRAGE_KATEGORIEN } from '@/lib/products';
import { ANFRAGE_METADATA, DATENSCHUTZ_FALLBACK, FALLBACK_MAIL } from '@/lib/anfrage-seite';

export const metadata = ANFRAGE_METADATA;

/**
 * Das Formular im iframe der Landingpage. Liest keine searchParams und wird
 * deshalb beim Bau fertig erzeugt - siehe lib/einbettung.ts. Den Link zur
 * Datenschutzerklaerung holt sich das Formular im Browser aus der Adresse.
 */
export default function AnfrageEingebettet() {
  return (
    <Anfrage
      kategorien={ANFRAGE_KATEGORIEN}
      eingebettet
      fallbackMail={FALLBACK_MAIL}
      datenschutz={DATENSCHUTZ_FALLBACK}
    />
  );
}
