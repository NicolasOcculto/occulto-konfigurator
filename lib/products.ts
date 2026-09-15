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
  /**
   * Mittelpunkt und Groesse des Kundenlogos, in Anteilen der Bildmasse.
   *
   * x dient nur als Rueckfall: liegt ein Bund vor, wird die Mitte der Ware
   * gemessen. dx verschiebt sie danach - die Silhouettenmitte ist nicht die
   * Mitte der sichtbaren Vorderseite, wenn die Socke gedreht steht.
   */
  logo: { x: number; y: number; s: number; dx?: number };
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
  /**
   * Neigung der Ringe in Grad, gegen den Uhrzeigersinn. Ohne Angabe wird sie
   * an der Silhouette gemessen; Logo und Schriftzug folgen ihr.
   *
   * Noetig, wenn die Aufnahme staerker gedreht ist, als die Mittellinie des
   * Schafts verraet - bei der Stoppersocke sieht man mehr von der Seite.
   */
  bandAngle?: number;
  /**
   * Wie tief die Ringe in der Mitte durchhaengen, als Anteil der halben
   * Schaftbreite. Ohne Angabe der Standardwert.
   */
  bandBow?: number;
  /**
   * Wie hell ein Bildpunkt sein darf, um noch als Ware zu gelten - als
   * Abstand zu Weiss. Ohne Angabe gilt der grosszuegige Standardwert.
   *
   * Zurzeit nutzt das kein Produkt: die Sockenfotos bringen ihren Alphakanal
   * mit, und ein Foto mit Freistellung wird gar nicht erst nach Helligkeit
   * beschnitten. Gebraucht wird der Wert erst wieder, wenn eine Aufnahme ohne
   * Freistellung dazukommt und die Ware fast so hell ist wie der Hintergrund.
   */
  cutTolerance?: number;
  /**
   * Traegt das Foto einen eingewebten Schriftzug, der uebermalt werden muss?
   * Ohne Angabe ja.
   *
   * Bei false wird nicht gemessen und nicht uebermalt: der neue Schriftzug
   * bekommt die Groesse aus name.len. Sonst haelt die Messung die Rippen der
   * Ware fuer Druck und zieht ihn ueber den Rand der Socke hinaus.
   */
  hasPrintedName?: boolean;
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

/**
 * Reihenfolge nach Nachfrage, das Haeufigste zuerst.
 *
 * Die Anteile fuer Ringe, Logo und Schriftzug sind an den Fotos vom
 * 15.09.2026 ausgemessen, nicht geschaetzt: Silhouette je Bildzeile, daraus
 * Bundkante und Mittellinie des Schafts. Wird ein Foto getauscht, muessen sie
 * neu gemessen werden - die Socke steht dann anders im Bild.
 */
export const PRODUCTS: Product[] = [
  {
    key: 'tennis',
    label: 'Tennissocken',
    file: 'tennis.webp',
    w: 675,
    h: 900,
    dark: false,
    hasPrintedName: false,
    logo: { x: 0.56, y: 0.345, s: 0.19, dx: 0.01 },
    band: { from: 0.205, to: 0.275 },
    name: { x: 0.6, y: 0.435, a: -18, len: 0.15, th: 0.024 },
    shopHandle: 'tennissocken',
    priceFrom: 2.1,
    minQuantity: 100,
    unit: 'Paar',
    leadTime: LIEFERZEIT,
    material: '80 % Baumwolle, 17 % Polyamid, 3 % Elasthan, frottierte Sohle',
  },
  {
    key: 'casual',
    label: 'Casual Socken',
    file: 'casual.webp',
    w: 693,
    h: 900,
    dark: false,
    hasPrintedName: false,
    logo: { x: 0.505, y: 0.365, s: 0.15, dx: 0.008 },
    band: { from: 0.245, to: 0.315 },
    name: { x: 0.545, y: 0.455, a: -17, len: 0.15, th: 0.024 },
    shopHandle: 'sneakersocken',
    priceFrom: null,
    minQuantity: 100,
    unit: 'Paar',
    leadTime: LIEFERZEIT,
    material: '80 % Baumwolle, 17 % Polyamid, 3 % Elasthan',
  },
  {
    key: 'muetze',
    label: 'Mützen & Textilien',
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
 * Bewusst nicht dieselbe Liste wie oben: der Konfigurator zeigt die Vorlagen,
 * fuer die es ein brauchbares Mockup gibt. Im Formular geht es dagegen um die
 * Kategorien, die Occulto anbietet - deshalb steht "Stopper & Weitere" hier,
 * obwohl der Konfigurator sie nicht mehr zeigt. Reihenfolge nach Nachfrage,
 * das Haeufigste zuerst.
 */
export const ANFRAGE_KATEGORIEN = [
  {
    key: 'tennis',
    label: 'Tennissocken',
    unterzeile: 'Klassisch und vielseitig',
    vorschau: '/products/vorschau/tennis.webp',
  },
  {
    key: 'casual',
    label: 'Casual Socken',
    unterzeile: 'Der Klassiker',
    vorschau: '/products/vorschau/casual.webp',
  },
  {
    key: 'spezial',
    label: 'Stopper & Weitere',
    unterzeile: 'Stopper, Ski, Rad',
    vorschau: '/products/vorschau/stopper.webp',
  },
  {
    key: 'textil',
    label: 'Mützen & Textilien',
    unterzeile: 'Mützen, Shirts, Hoodies',
    vorschau: '/products/vorschau/muetze.webp',
  },
] as const;

export type AnfrageKategorie = (typeof ANFRAGE_KATEGORIEN)[number];

/** Was der Konfigurator zeigt, auf die Kategorie des Formulars uebersetzt. */
const KATEGORIE_JE_VORLAGE: Record<string, string> = {
  tennis: 'tennis',
  casual: 'casual',
  // Fuer "Stopper & Weitere" gibt es hier nichts zu uebersetzen: die
  // Kategorie steht im Formular, im Konfigurator nicht mehr.
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
