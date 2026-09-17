/**
 * Ereignisse an die einbettende Seite melden.
 *
 * Die App misst nichts selbst und laedt kein Messwerkzeug. Sie schickt nur
 * den Namen des Ereignisses und ein paar Kennwerte an das Elternfenster;
 * die Landingpage reicht sie an GA4 weiter.
 *
 * Warum nicht direkt GA4 in der App: Konfigurator und Formular liegen als
 * iframes auf einer anderen Domain. Ein eigenes GA4 dort waere eine zweite
 * Sitzung, mit eigener Quelle und eigenem Besucher - der Trichter waere
 * genau an der Stelle zerschnitten, an der man ihn braucht.
 *
 * Es werden ausdruecklich keine Nutzerinhalte uebertragen: kein Logo, kein
 * Firmenname, keine Adresse. Nur was passiert ist und mit welchem Produkt.
 */
export function spur(name: string, daten: Record<string, string | number> = {}): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  try {
    window.parent.postMessage({ typ: 'occulto-spur', name: name, daten: daten }, '*');
  } catch {
    /* Messung darf nie etwas kaputtmachen. */
  }
}

/**
 * Wie spur(), aber hoechstens einmal je Sitzung.
 *
 * Fuer Kennzahlen wie "Konfigurator genutzt" oder "Formular angefangen":
 * dort zaehlt, wie viele Leute es angefasst haben, nicht wie oft jemand
 * geklickt hat. Ohne die Bremse wuerde ein einzelner Besucher, der fuenf
 * Farben durchprobiert, die Zahl verfuenffachen.
 *
 * sessionStorage statt eines Merkers im Bauteil: der Konfigurator wird beim
 * Aufklappen neu aufgebaut, ein Merker im Zustand waere dann wieder leer.
 */
export function spurEinmal(name: string, daten: Record<string, string | number> = {}): void {
  if (typeof window === 'undefined') return;
  try {
    const schluessel = 'occulto-spur-' + name;
    if (sessionStorage.getItem(schluessel)) return;
    sessionStorage.setItem(schluessel, '1');
  } catch {
    /* Privater Modus: dann lieber mehrfach melden als gar nicht. */
  }
  spur(name, daten);
}
