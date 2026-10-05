/** Pruefregeln fuer die Parameter, die die Landingpage an den iframe haengt. */

/**
 * Nur eigene Adressen zulassen: der Parameter kommt von der einbettenden
 * Seite, und wer die ist, bestimmt nicht die App. Ein fremdes Ziel hinter
 * dem Wort Datenschutz waere genau die Art Link, die niemand prueft.
 */
export function istDatenschutz(wert: string): boolean {
  return /^https:\/\/([a-z0-9-]+\.)*occulto\.de\/[\w/-]*$/i.test(wert);
}

/** Der Shop, auf dessen Produktseiten "Mehr erfahren" zeigt - auch die lokale Vorschau. */
export function istShop(wert: string): boolean {
  return /^https?:\/\/(([a-z0-9-]+\.)*occulto\.de|occultostore\.myshopify\.com|127\.0\.0\.1|localhost)(:\d+)?$/i.test(wert);
}
