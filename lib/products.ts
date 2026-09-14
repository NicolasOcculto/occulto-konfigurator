/**
 * Produktkatalog des Konfigurators.
 *
 * Geometrie (logo/name) ist in Anteilen der Bildbreite bzw. -hoehe angegeben,
 * damit sie unabhaengig von der Aufloesung des Produktfotos bleibt.
 *
 * Preise stammen aus OCCULTO_PREISLISTE_Socken.pdf (Kundenpreise 2026, kein
 * Grosshandel), Mindestmenge und Lieferzeit aus den Angaben im Shop.
 *
 * Achtung bei der Mindestmenge: 100 gilt **pro Groesse**. Wer drei Groessen
 * bestellt, braucht 300 Paar. Das muss die Mengenabfrage im Formular
 * abbilden, sonst entstehen Anfragen, die abgelehnt werden muessen.
 */

export type Product = {
  key: string;
  label: string;
  /** Produktfoto unter /public/products */
  file: string;
  w: number;
  h: number;
  /** Dunkle Ware: Logo wird als weisse Silhouette gesetzt, Textur per Soft-Light. */
  dark: boolean;
  /** Platzierung des Logos: Mittelpunkt (x,y) und Breite (s), jeweils relativ. */
  logo: { x: number; y: number; s: number };
  /**
   * Das Logo sitzt auf der eingewebten Marke statt frei auf der Ware. Dann gibt
   * der ausgemessene Aufdruck Ort und Groesse vor, das Motiv steht dunkel auf
   * hellem Grund, und der Firmenname entfaellt - beides passt nicht in ein Label.
   * Gilt nur fuer ungedrehte Labels (name.a === 0).
   */
  logoOnLabel?: boolean;
  /**
   * Farbband am Bund, in Anteilen der Bildhoehe. Nur dort greift die Wunschfarbe.
   * Ohne Angabe wird das ganze Produkt eingefaerbt.
   *
   * Werte gemessen am Silhouettenprofil der Produktfotos, nicht geschaetzt.
   * Der Streifen setzt bewusst unterhalb der Bundkante an: ueber und unter ihm
   * bleibt Ware in Grundfarbe stehen, sonst wirkt er wie eine abgeschnittene Kappe.
   */
  band?: { from: number; to: number };
  /** Eingewebter Schriftzug: Mittelpunkt, Drehung in Grad, Laenge und Strichstaerke. */
  name: { x: number; y: number; a: number; len: number; th: number };
  /**
   * Handle der Infoseite im Shop. Die vier Vorlagen des Konfigurators sind
   * nicht deckungsgleich mit den sieben Artikeln im Shop: die Skisocke ist
   * dort eine Spezialsocke. Deshalb steht der Handle hier und wird nicht aus
   * dem Schluessel abgeleitet.
   */
  shopHandle: string;
  /** Ab-Preis pro Stueck. null bedeutet "auf Anfrage". */
  priceFrom: number | null;
  /** Mindestmenge pro Groesse, nicht pro Bestellung. */
  minQuantity: number;
  unit: string;
  leadTime: string;
  material: string;
};

/** Einheitlich fuer alle Produkte, aus den Angaben im Shop. */
const LIEFERZEIT = '6–8 Wochen';

export const PRODUCTS: Product[] = [
  {
    key: 'skisocke',
    label: 'Skisocke',
    file: 'skisocke.webp',
    w: 675,
    h: 900,
    dark: false,
    logo: { x: 0.545, y: 0.33, s: 0.17 },
    band: { from: 0.115, to: 0.172 },
    name: { x: 0.499, y: 0.806, a: -47, len: 0.107, th: 0.021 },
    shopHandle: 'spezialsockem',
    priceFrom: 1.69,
    minQuantity: 100,
    unit: 'Paar',
    leadTime: LIEFERZEIT,
    material: '80 % Baumwolle, 17 % Polyamid, 3 % Elasthan',
  },
  {
    key: 'sneaker',
    label: 'Sneakersocke',
    file: 'sneaker.webp',
    w: 675,
    h: 900,
    dark: false,
    logo: { x: 0.6, y: 0.45, s: 0.17 },
    band: { from: 0.337, to: 0.374 },
    name: { x: 0.535, y: 0.735, a: -47, len: 0.15, th: 0.024 },
    shopHandle: 'sneakersocken',
    priceFrom: null,
    minQuantity: 100,
    unit: 'Paar',
    leadTime: LIEFERZEIT,
    material: '80 % Baumwolle, 17 % Polyamid, 3 % Elasthan',
  },
  {
    key: 'tennis',
    label: 'Tennissocke',
    file: 'tennis.webp',
    w: 675,
    h: 900,
    dark: false,
    logo: { x: 0.61, y: 0.38, s: 0.19 },
    band: { from: 0.170, to: 0.222 },
    name: { x: 0.535, y: 0.735, a: -47, len: 0.15, th: 0.024 },
    shopHandle: 'tennissocken',
    priceFrom: 2.1,
    minQuantity: 100,
    unit: 'Paar',
    leadTime: LIEFERZEIT,
    material: '80 % Baumwolle, 17 % Polyamid, 3 % Elasthan, frottierte Sohle',
  },
  {
    key: 'muetze',
    label: 'Mütze',
    file: 'muetze.webp',
    w: 692,
    h: 900,
    dark: true,
    logo: { x: 0.518, y: 0.689, s: 0.15 },
    logoOnLabel: true,
    name: { x: 0.518, y: 0.689, a: 0, len: 0.13, th: 0.02 },
    shopHandle: 'mutzen',
    priceFrom: 6.5,
    minQuantity: 100,
    unit: 'Stück',
    leadTime: LIEFERZEIT,
    material: 'Strickmütze, eingewebtes Label oder Stick',
  },
];

export const PRODUCT_BY_KEY = new Map(PRODUCTS.map((p) => [p.key, p]));

/** Fuer den Client: nur die Felder, die die Produktkarte braucht. */
export const PRODUCT_CARDS = PRODUCTS.map((p) => ({
  key: p.key,
  label: p.label,
  image: `/products/${p.file}`,
  // Auf die Ware zugeschnitten, fuer kleine Auswahlkacheln. Erzeugt von
  // scripts/vorschaubilder.mjs - im Original belegt die Socke je nach Motiv
  // nur 41 bis 59 Prozent der Bildbreite und verschwindet in der Kachel.
  preview: `/products/vorschau/${p.file.replace(/\.[^.]+$/, '.webp')}`,
  w: p.w,
  h: p.h,
  dark: p.dark,
  shopHandle: p.shopHandle,
  priceFrom: p.priceFrom,
  minQuantity: p.minQuantity,
  unit: p.unit,
  leadTime: p.leadTime,
  material: p.material,
}));

export type ProductCard = (typeof PRODUCT_CARDS)[number];

/**
 * Auswahl im Anfrageformular.
 *
 * Bewusst nicht dieselbe Liste wie oben: der Konfigurator zeigt die vier
 * Vorlagen, fuer die es Mockups gibt. Im Formular geht es dagegen um die
 * Kategorien, die Occulto anbietet - eine Skisocke ist eine Spezialsocke, eine
 * Muetze faellt unter weitere Textilien. Reihenfolge nach Nachfrage, das
 * Haeufigste zuerst.
 */
export const ANFRAGE_KATEGORIEN = [
  { key: 'tennis', label: 'Tennissocken', vorschau: '/products/vorschau/tennis.webp' },
  { key: 'sneaker', label: 'Sneakersocken', vorschau: '/products/vorschau/sneaker.webp' },
  { key: 'spezial', label: 'Spezialsocken', vorschau: '/products/vorschau/skisocke.webp' },
  { key: 'textil', label: 'Weitere Textilien', vorschau: '/products/vorschau/muetze.webp' },
] as const;

export type AnfrageKategorie = (typeof ANFRAGE_KATEGORIEN)[number];

/** Was der Konfigurator zeigt, auf die Kategorie des Formulars uebersetzt. */
const KATEGORIE_JE_VORLAGE: Record<string, string> = {
  tennis: 'tennis',
  sneaker: 'sneaker',
  skisocke: 'spezial',
  muetze: 'textil',
};

export function kategorieAus(vorlage: string | null): string | null {
  if (!vorlage) return null;
  return KATEGORIE_JE_VORLAGE[vorlage] ?? null;
}

/** Beschriftung fuer die Mail. Liefert null bei unbekanntem Schluessel. */
export function kategorieLabel(key: string): string | null {
  return ANFRAGE_KATEGORIEN.find((k) => k.key === key)?.label ?? null;
}
