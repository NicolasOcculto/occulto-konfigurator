/**
 * Wer die Anfragen bekommt.
 *
 * ANFRAGE_EMPFAENGER darf mehrere Adressen enthalten, durch Komma getrennt -
 * dann geht jede Anfrage an alle. Das ist die einfachste Versicherung gegen ein
 * Postfach, das irgendwann niemand mehr liest: steht eine zweite Adresse drin,
 * kommen die Anfragen weiter an, wenn die erste stillgelegt wird.
 *
 * Der Rueckfall ist bewusst keine persoenliche Adresse. Verschwindet das
 * Postfach eines Mitarbeiters, verschwinden sonst die Anfragen mit - und zwar
 * lautlos, weil der Besucher trotzdem die Danke-Seite sieht. Siehe UEBERGABE.md.
 */
const RUECKFALL = 'support@occulto.de';

export function empfaengerAus(wert: string | undefined): string[] {
  const liste = (wert ?? '')
    .split(',')
    .map((adresse) => adresse.trim())
    .filter((adresse) => adresse.includes('@') && adresse.length > 3);

  return liste.length > 0 ? liste : [RUECKFALL];
}
