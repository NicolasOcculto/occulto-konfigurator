/**
 * Woher eine Anfrage kommt - Meta-Anzeige, Google, direkt.
 *
 * Gesammelt wird auf der Landingpage (snippets/b2b-klickspur.liquid im
 * Theme): nur sie sieht UTM-Parameter und Referrer, der iframe bekommt davon
 * nichts mit. Die Seite gibt den Stand auf Nachfrage an das Formular, das
 * Formular schickt ihn mit der Anfrage, und hier wird daraus eine Zeile in
 * der Mail.
 *
 * Zwei Besuche, weil beide etwas anderes sagen: der erste zeigt, wodurch
 * jemand auf Occulto aufmerksam wurde, der letzte, was ihn zur Anfrage
 * gebracht hat. Ein direkter Besuch ueberschreibt den letzten nicht - wer die
 * Anzeige sieht und zwei Tage spaeter die Adresse eintippt, kam trotzdem
 * ueber die Anzeige.
 */

export type Besuch = {
  quelle: string;
  medium: string;
  kampagne: string;
  inhalt: string;
  /** Klick-Kennung, die Meta oder Google anhaengt: 'fbclid', 'gclid' oder ''. */
  klick: string;
  /** Host der verweisenden Seite, leer bei direktem Aufruf. */
  verweis: string;
  seite: string;
  /** Tag des Besuchs, JJJJ-MM-TT. */
  tag: string;
};

export type Herkunft = { erst: Besuch | null; letzt: Besuch | null };

const FELDER = ['quelle', 'medium', 'kampagne', 'inhalt', 'klick', 'verweis', 'seite', 'tag'] as const;

/**
 * Prueft, was von der Seite kommt. Die Werte stammen aus der Adresszeile des
 * Besuchers - jeder kann dort hineinschreiben, was er will. Deshalb nur kurze
 * Zeichenketten ohne Steuerzeichen.
 */
function pruefeBesuch(wert: unknown): Besuch | null {
  if (!wert || typeof wert !== 'object' || Array.isArray(wert)) return null;
  const roh = wert as Record<string, unknown>;
  const b = {} as Besuch;
  for (const feld of FELDER) {
    const w = roh[feld];
    b[feld] = typeof w === 'string' ? w.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) : '';
  }
  // Die Seite setzt das Datum immer. Fehlt es, ist das kein Besuch, sondern
  // Unsinn - und ein leerer Besuch hiesse sonst "Direkt".
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.tag)) return null;
  if (b.klick !== 'fbclid' && b.klick !== 'gclid') b.klick = '';
  return b;
}

export function pruefeHerkunft(wert: unknown): Herkunft | null {
  if (!wert || typeof wert !== 'object') return null;
  const roh = wert as Record<string, unknown>;
  const erst = pruefeBesuch(roh.erst);
  const letzt = pruefeBesuch(roh.letzt);
  if (!erst && !letzt) return null;
  return { erst, letzt };
}

// Meta setzt mit {{site_source_name}} fb, ig, an oder msg ein.
const META = /^(meta|facebook|fb|instagram|ig|an|msg|messenger)$/;
const META_SEITE = /(^|\.)(facebook|instagram|fb|messenger)\.(com|me)$/;
const BEZAHLT = /paid|cpc|ppc|cpm|^ads?$|anzeige/;
const SUCHE = /(^|\.)(google|bing|duckduckgo|ecosia|yahoo|startpage|qwant)\./;

/**
 * Der Kanal in wenigen Worten - so steht er im Betreff und in der Mail.
 *
 * Verlaesslich ist nur, was die Anzeige selbst in die Adresse schreibt
 * (UTM-Parameter). Die fbclid haengt Meta an jeden Klick, auch an einen auf
 * einen gewoehnlichen Beitrag - ohne UTM ist deshalb nur "Facebook/Instagram"
 * sicher, nicht "Anzeige".
 */
export function kanal(b: Besuch | null): string {
  if (!b) return 'unbekannt';
  const quelle = b.quelle.toLowerCase();
  const medium = b.medium.toLowerCase();

  if (META.test(quelle)) return BEZAHLT.test(medium) || !medium ? 'Meta-Anzeige' : 'Meta organisch';
  if (b.klick === 'gclid' || (quelle === 'google' && BEZAHLT.test(medium))) return 'Google-Anzeige';
  if (quelle) return 'Kampagne';
  if (b.klick === 'fbclid' || META_SEITE.test(b.verweis)) return 'Facebook/Instagram';
  if (SUCHE.test(b.verweis)) return 'Suche organisch';
  if (b.verweis) return 'Verweis';
  return 'Direkt';
}

/** Die Einzelheiten hinter dem Kanal, z. B. "meta / paid_social · herbst · video-2". */
export function einzelheiten(b: Besuch): string {
  const teile: string[] = [];
  if (b.quelle) teile.push(b.medium ? `${b.quelle} / ${b.medium}` : b.quelle);
  if (b.kampagne) teile.push(`Kampagne ${b.kampagne}`);
  if (b.inhalt) teile.push(`Anzeige ${b.inhalt}`);
  if (!b.quelle && b.verweis) teile.push(b.verweis);
  if (b.klick) teile.push(b.klick);
  return teile.join(' · ');
}

function datum(tag: string): string {
  const [j, m, t] = tag.split('-');
  return t ? `${t}.${m}.${j}` : '';
}

/** Ein Besuch als ganze Zeile: "Meta-Anzeige (meta / paid_social · Kampagne herbst), 28.09.2026". */
export function besuchText(b: Besuch | null): string {
  if (!b) return 'unbekannt';
  const mehr = einzelheiten(b);
  const wann = datum(b.tag);
  return `${kanal(b)}${mehr ? ` (${mehr})` : ''}${wann ? `, ${wann}` : ''}`;
}

/** Der Besuch, der zaehlt: der letzte mit Herkunft, sonst der erste. */
export function massgeblich(h: Herkunft | null): Besuch | null {
  return h ? h.letzt ?? h.erst : null;
}

function gleich(a: Besuch | null, b: Besuch | null): boolean {
  return !!a && !!b && FELDER.every((f) => a[f] === b[f]);
}

/** Der erste Besuch - nur wenn er etwas anderes sagt als der massgebliche. */
export function einstieg(h: Herkunft | null): Besuch | null {
  if (!h || !h.erst || gleich(h.erst, massgeblich(h))) return null;
  return h.erst;
}

/**
 * Das Formular fragt die einbettende Seite nach der Herkunft.
 *
 * Nur Antworten aus dem Elternfenster zaehlen. Ohne Einbettung - die
 * eigenstaendige Seite fuer die Produktseiten - gibt es niemanden zu fragen,
 * und die Mail sagt dann ehrlich "unbekannt".
 */
export function herkunftErfragen(uebernehmen: (h: Herkunft) => void): () => void {
  if (typeof window === 'undefined' || window.parent === window) return () => {};

  const horcher = (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const d = event.data as { typ?: string; herkunft?: unknown } | null;
    if (!d || d.typ !== 'occulto-herkunft') return;
    const h = pruefeHerkunft(d.herkunft);
    if (h) uebernehmen(h);
  };

  window.addEventListener('message', horcher);
  window.parent.postMessage({ typ: 'occulto-anfrage', was: 'frage-herkunft' }, '*');
  return () => window.removeEventListener('message', horcher);
}
