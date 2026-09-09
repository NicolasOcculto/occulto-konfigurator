/**
 * Produktkatalog des Konfigurators.
 *
 * Geometrie (logo/name) ist in Anteilen der Bildbreite bzw. -hoehe angegeben,
 * damit sie unabhaengig von der Aufloesung des Produktfotos bleibt.
 *
 * Preise, Mindestmengen und Lieferzeiten sind Platzhalter aus dem Prototyp und
 * gehoeren vor dem Livegang gegen die echten Konditionen getauscht.
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
  priceFrom: number;
  minQuantity: number;
  unit: string;
  leadTime: string;
  material: string;
};

export const PRODUCTS: Product[] = [
  {
    key: 'kniestrumpf',
    label: 'Kniestrumpf',
    file: 'kniestrumpf.webp',
    w: 675,
    h: 900,
    dark: false,
    logo: { x: 0.545, y: 0.22, s: 0.2 },
    name: { x: 0.499, y: 0.806, a: -47, len: 0.107, th: 0.021 },
    priceFrom: 6.9,
    minQuantity: 100,
    unit: 'Paar',
    leadTime: '4–5 Wochen',
    material: 'Gekaemmte Baumwolle, eingestrickt',
  },
  {
    key: 'sneaker',
    label: 'Sneakersocke',
    file: 'sneaker.webp',
    w: 675,
    h: 900,
    dark: false,
    logo: { x: 0.56, y: 0.42, s: 0.17 },
    name: { x: 0.535, y: 0.735, a: -47, len: 0.15, th: 0.024 },
    priceFrom: 5.4,
    minQuantity: 100,
    unit: 'Paar',
    leadTime: '4–5 Wochen',
    material: 'Gekaemmte Baumwolle, eingestrickt',
  },
  {
    key: 'tennis',
    label: 'Tennissocke',
    file: 'tennis.webp',
    w: 675,
    h: 900,
    dark: false,
    logo: { x: 0.56, y: 0.27, s: 0.19 },
    name: { x: 0.535, y: 0.735, a: -47, len: 0.15, th: 0.024 },
    priceFrom: 5.9,
    minQuantity: 100,
    unit: 'Paar',
    leadTime: '4–5 Wochen',
    material: 'Frottee-Sohle, eingestrickt',
  },
  {
    key: 'muetze',
    label: 'Muetze',
    file: 'muetze.webp',
    w: 692,
    h: 900,
    dark: true,
    logo: { x: 0.5, y: 0.33, s: 0.26 },
    name: { x: 0.518, y: 0.689, a: 0, len: 0.13, th: 0.02 },
    priceFrom: 12.5,
    minQuantity: 50,
    unit: 'Stueck',
    leadTime: '5–6 Wochen',
    material: 'Merinomischung, gewebtes Label',
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
