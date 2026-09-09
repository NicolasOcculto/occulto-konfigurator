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
  /** Eingewebter Schriftzug: Mittelpunkt, Drehung in Grad, Laenge und Strichstaerke. */
  name: { x: number; y: number; a: number; len: number; th: number };
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
    logo: { x: 0.545, y: 0.22, s: 0.2 },
    name: { x: 0.499, y: 0.806, a: -47, len: 0.107, th: 0.021 },
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
    logo: { x: 0.6, y: 0.42, s: 0.17 },
    name: { x: 0.535, y: 0.735, a: -47, len: 0.15, th: 0.024 },
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
    logo: { x: 0.6, y: 0.27, s: 0.19 },
    name: { x: 0.535, y: 0.735, a: -47, len: 0.15, th: 0.024 },
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
    logo: { x: 0.5, y: 0.33, s: 0.26 },
    name: { x: 0.518, y: 0.689, a: 0, len: 0.13, th: 0.02 },
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
  w: p.w,
  h: p.h,
  dark: p.dark,
  priceFrom: p.priceFrom,
  minQuantity: p.minQuantity,
  unit: p.unit,
  leadTime: p.leadTime,
  material: p.material,
}));

export type ProductCard = (typeof PRODUCT_CARDS)[number];
