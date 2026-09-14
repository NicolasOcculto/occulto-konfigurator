import Configurator from '@/components/Configurator';
import { PRODUCT_CARDS } from '@/lib/products';

/**
 * `?eingebettet=1` blendet Ueberschrift, Einleitung und Aussenabstand aus.
 *
 * Im iframe stellt die Landingpage beides selbst: die Ueberschrift gehoert in
 * das Dokument der Seite, sonst taucht sie weder in der Gliederung noch bei
 * Google auf. Der iframe traegt nur den interaktiven Teil.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const eingebettet = params.eingebettet === '1';

  // Die Landingpage haengt ihre eigene Adresse an den iframe. Nur so kann der
  // Knopf "Mehr erfahren" auf die Produktseite desselben Shops zeigen - ein
  // relativer Pfad wuerde im iframe gegen die Adresse der App aufgeloest.
  const shop = typeof params.shop === 'string' ? params.shop : '';

  return <Configurator products={PRODUCT_CARDS} eingebettet={eingebettet} shop={shop} />;
}
