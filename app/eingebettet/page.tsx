import Configurator from '@/components/Configurator';
import { PRODUCT_CARDS } from '@/lib/products';

/**
 * Der Konfigurator im iframe der Landingpage. Liest keine searchParams und
 * wird deshalb beim Bau fertig erzeugt - siehe lib/einbettung.ts. Die
 * Shop-Adresse fuer "Mehr erfahren" holt er sich im Browser.
 */
export default function KonfiguratorEingebettet() {
  return <Configurator products={PRODUCT_CARDS} eingebettet />;
}
