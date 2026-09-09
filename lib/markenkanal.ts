/**
 * Verbindung zwischen Konfigurator und Anfrageformular.
 *
 * Beide haengen als eigene iframes in derselben Landingpage, sind also getrennte
 * Dokumente ohne gemeinsamen React-Zustand. Sie liegen aber auf derselben
 * Herkunft, und dafuer gibt es BroadcastChannel.
 *
 * Warum Frage und Antwort statt einfach senden: Das Formular steht weiter unten
 * auf der Seite und laedt spaeter (loading="lazy"). Ein einmal gesendetes
 * Ereignis waere da laengst verpufft. Also fragt das Formular beim Aufwachen
 * nach, und der Konfigurator antwortet - falls er ueberhaupt etwas weiss.
 * Weiss er nichts, kommt keine Antwort und das Formular bleibt leer.
 *
 * Bewusst kein sessionStorage: das Logo ist eine data:-URI von bis zu 4 MB und
 * sprengt die Ablage. Ueber den Kanal geht es ohne Groessengrenze.
 */

const KANAL = 'occulto-marke';

export type Marke = {
  firma: string;
  /** data:-URI des Logos, oder null wenn nur der Firmenname bekannt ist. */
  logo: string | null;
  /** Schluessel des zuletzt angesehenen Produkts. */
  produkt: string | null;
};

type Nachricht = { was: 'frage' } | { was: 'antwort'; marke: Marke };

function kanal(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(KANAL);
}

/**
 * Der Konfigurator meldet sich an und beantwortet Nachfragen des Formulars.
 * `lesen` liefert den aktuellen Stand - als Funktion, damit die Antwort nicht
 * auf einem alten Zustand aus der Zeit der Anmeldung sitzenbleibt.
 */
export function anbieten(lesen: () => Marke | null): () => void {
  const c = kanal();
  if (!c) return () => {};

  c.onmessage = (event: MessageEvent<Nachricht>) => {
    if (event.data?.was !== 'frage') return;
    const marke = lesen();
    if (marke) c.postMessage({ was: 'antwort', marke } satisfies Nachricht);
  };

  return () => c.close();
}

/** Das Formular fragt einmal nach und nimmt entgegen, was zurueckkommt. */
export function nachfragen(uebernehmen: (marke: Marke) => void): () => void {
  const c = kanal();
  if (!c) return () => {};

  c.onmessage = (event: MessageEvent<Nachricht>) => {
    if (event.data?.was === 'antwort') uebernehmen(event.data.marke);
  };
  c.postMessage({ was: 'frage' } satisfies Nachricht);

  return () => c.close();
}
