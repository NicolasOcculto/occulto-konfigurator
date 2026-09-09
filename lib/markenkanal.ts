/**
 * Verbindung zwischen Konfigurator und Anfrageformular.
 *
 * Beide haengen als eigene iframes in derselben Landingpage, sind also getrennte
 * Dokumente ohne gemeinsamen React-Zustand. Die Seite dazwischen leitet weiter -
 * sie vermittelt ohnehin schon Hoehe und Absenden.
 *
 * Zwei Richtungen, weil beide Reihenfolgen vorkommen:
 *
 *  - Das Formular laedt spaeter (loading="lazy") und fragt beim Aufwachen nach,
 *    was der Konfigurator schon weiss.
 *  - Der Besucher gibt seine Domain erst ein, wenn das Formular laengst geladen
 *    ist. Dann schiebt der Konfigurator die Marke von sich aus nach.
 *
 * Ohne den zweiten Weg blieb das Formular leer, sobald jemand erst scrollte und
 * dann den Konfigurator benutzte - also im Normalfall.
 *
 * Bewusst kein sessionStorage: das Logo ist eine data:-URI von bis zu 4 MB und
 * sprengt die Ablage.
 */

export type Marke = {
  firma: string;
  /** data:-URI des Logos, oder null wenn nur der Firmenname bekannt ist. */
  logo: string | null;
  /** Schluessel des zuletzt angesehenen Produkts. */
  produkt: string | null;
};

const MAX_FIRMA = 120;
const MAX_LOGO = 6_000_000;

function eingebettet(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

function anDieSeite(nachricht: unknown): void {
  if (!eingebettet()) return;
  window.parent.postMessage(nachricht, '*');
}

/**
 * Prueft, was hereinkommt.
 *
 * Die Nachricht kommt von der einbettenden Seite, und wer diese Seite ist,
 * bestimmt nicht die App. Der Inhalt landet in Formularfeldern, die der
 * Besucher sieht und aendern kann - trotzdem wird nur uebernommen, was die
 * richtige Form hat, und nur in vernuenftiger Groesse.
 */
function pruefeMarke(wert: unknown): Marke | null {
  if (!wert || typeof wert !== 'object') return null;
  const m = wert as Record<string, unknown>;

  const firma = typeof m.firma === 'string' ? m.firma.slice(0, MAX_FIRMA) : '';
  const produkt = typeof m.produkt === 'string' ? m.produkt.slice(0, 40) : null;

  let logo: string | null = null;
  if (typeof m.logo === 'string' && m.logo.startsWith('data:image/') && m.logo.length <= MAX_LOGO) {
    logo = m.logo;
  }

  if (!firma && !logo) return null;
  return { firma, logo, produkt };
}

/**
 * Der Konfigurator meldet seinen Stand.
 *
 * `marke` ist null, solange nichts erkannt wurde - dann wird auch nichts
 * gesendet und das Formular bleibt leer.
 */
export function melden(marke: Marke | null): void {
  if (!marke) return;
  anDieSeite({ typ: 'occulto-konfigurator', was: 'marke', marke });
}

/**
 * Der Konfigurator beantwortet Nachfragen des Formulars.
 * `lesen` als Funktion, damit die Antwort den aktuellen Stand nimmt und nicht
 * den aus der Zeit der Anmeldung.
 */
export function aufNachfrageAntworten(lesen: () => Marke | null): () => void {
  if (!eingebettet()) return () => {};

  const horcher = (event: MessageEvent) => {
    const d = event.data as { typ?: string; was?: string } | null;
    if (!d || d.typ !== 'occulto-anfrage' || d.was !== 'frage-marke') return;
    melden(lesen());
  };

  window.addEventListener('message', horcher);
  return () => window.removeEventListener('message', horcher);
}

/**
 * Das Formular fragt einmal nach und hoert danach weiter zu - der Konfigurator
 * kann jederzeit etwas Neues finden.
 */
export function nachfragen(uebernehmen: (marke: Marke) => void): () => void {
  if (!eingebettet()) return () => {};

  const horcher = (event: MessageEvent) => {
    const d = event.data as { typ?: string; marke?: unknown } | null;
    if (!d || d.typ !== 'occulto-marke') return;
    const marke = pruefeMarke(d.marke);
    if (marke) uebernehmen(marke);
  };

  window.addEventListener('message', horcher);
  anDieSeite({ typ: 'occulto-anfrage', was: 'frage-marke' });
  return () => window.removeEventListener('message', horcher);
}
