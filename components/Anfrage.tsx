'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { nachfragen, type Marke } from '@/lib/markenkanal';
import { kategorieAus, type AnfrageKategorie } from '@/lib/products';

const MAX_LOGO_BYTES = 5_000_000;
const ERLAUBTE_TYPEN = ['image/png', 'image/jpeg', 'image/svg+xml'];

/**
 * Gesamtmenge, nicht Menge pro Groesse. Frei einstellbar statt in Rastpunkten -
 * echte Anfragen liegen selten genau auf einer runden Zahl. Zu kleine Mengen
 * blockieren nicht, sie werden im Gespraech hochgehandelt.
 */
const MENGE_MIN = 100;
const MENGE_MAX = 2000;
const MENGE_SCHRITT = 50;
const MENGE_START = 500;
/** Nur Beschriftung unter dem Regler, keine Rastpunkte. */
const MENGE_MARKEN = [100, 500, 1000, 1500, 2000] as const;

const UNENTSCHIEDEN = 'unklar';

/** Kurz unter den Ziffern, damit man weiss wo man steht. */
const SCHRITTMARKEN = ['Produkt', 'Design & Menge', 'Kontakt'] as const;
/** Die eigentliche Frage des Schritts, als Ueberschrift darunter. */
const SCHRITTFRAGEN = ['Um welches Produkt geht es?', 'Design & Stückzahl', 'Kontakt Daten'] as const;

/**
 * Die Leiste unter dem Formular.
 *
 * Wortlaut bewusst wie auf der Landingpage: Produktion in Portugal und der
 * Tuerkei, Design in Rosenheim, OEKO-TEX Standard 100. Hier soll nichts
 * behauptet werden, was dort nicht steht - eine Herkunftsangabe, die sich
 * zwischen zwei Seiten widerspricht, ist schlimmer als gar keine.
 *
 * Die Pfade sind einfache Umrisse, damit kein Symbolpaket noetig ist.
 */
const BELEGE = [
  {
    text: 'Design aus Rosenheim',
    // Stift
    pfade: ['M3 21l4-1 11-11a2.1 2.1 0 0 0-3-3L4 17l-1 4Z', 'M14.5 6.5l3 3'],
  },
  {
    text: 'Produktion in Portugal und der Türkei',
    // Ortsmarke
    pfade: ['M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z', 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'],
  },
  {
    text: 'OEKO-TEX Standard 100',
    // Schild mit Haken
    pfade: ['M12 3 4 6.5v5c0 4.4 3.4 8.2 8 9 4.6-.8 8-4.6 8-9v-5L12 3Z', 'M9 12l2.2 2.2L15.5 10'],
  },
] as const;

type Schritt = 1 | 2 | 3;

import { spur, spurEinmal } from '@/lib/spur';

/** Nachricht an die einbettende Seite. Kein Nutzerinhalt, nur Steuerdaten. */
function melde(was: 'hoehe' | 'gesendet' | 'frage-marke', hoehe?: number) {
  if (typeof window === 'undefined' || window.parent === window) return;
  window.parent.postMessage({ typ: 'occulto-anfrage', was, hoehe }, '*');
}

function mengeText(wert: number): string {
  const zahl = wert.toLocaleString('de-DE');
  return wert >= MENGE_MAX ? `${zahl}+` : zahl;
}

export default function Anfrage({
  kategorien,
  eingebettet = false,
  fallbackMail,
  datenschutz,
}: {
  kategorien: readonly AnfrageKategorie[];
  eingebettet?: boolean;
  fallbackMail: string;
  datenschutz: string;
}) {
  const [schritt, setSchritt] = useState<Schritt>(1);
  // Weiter als hierher war der Besucher noch nie - vorwaerts springen darf er
  // deshalb nur bis hier, sonst uebergeht er die Pruefungen dazwischen.
  const [weiteste, setWeiteste] = useState<Schritt>(1);

  const [produkt, setProdukt] = useState<string>('');

  const [logo, setLogo] = useState<string | null>(null);
  const [logoName, setLogoName] = useState<string | null>(null);
  const [ohneLogo, setOhneLogo] = useState(false);
  const [menge, setMenge] = useState(MENGE_START);

  const [firma, setFirma] = useState('');
  const [person, setPerson] = useState('');
  const [mail, setMail] = useState('');
  const [telefon, setTelefon] = useState('');
  const [nachricht, setNachricht] = useState('');
  const [einwilligung, setEinwilligung] = useState(false);

  const [ausKonfigurator, setAusKonfigurator] = useState(false);
  const [fehler, setFehler] = useState('');
  // Der Rueckfallweg per Mail hilft nur, wenn das Absenden scheitert - bei einem
  // leeren Pflichtfeld waere er unsinnig.
  const [versandFehler, setVersandFehler] = useState(false);
  // In welchem Schritt die Pruefung gescheitert ist. Erst danach wird rot
  // markiert - vorher waere die halbe Maske rot, bevor jemand tippen konnte.
  const [bemaengelt, setBemaengelt] = useState<Schritt | null>(null);
  const [sendet, setSendet] = useState(false);
  const [gesendet, setGesendet] = useState(false);

  const datei = useRef<HTMLInputElement>(null);
  const kopf = useRef<HTMLDivElement>(null);

  /* ---------- Uebernahme aus dem Konfigurator ---------- */

  const uebernehmen = useCallback((marke: Marke) => {
    // Nur fuellen, was leer ist: selbst Eingetragenes wird nicht ueberschrieben.
    if (marke.firma) setFirma((alt) => alt || marke.firma);
    if (marke.logo) {
      setLogo((alt) => alt ?? marke.logo);
      setLogoName((alt) => alt ?? 'Logo aus dem Konfigurator');
    }
    // Der Konfigurator nennt seine Render-Vorlage, das Formular fuehrt
    // Kategorien - eine Skisocke gehoert zu den Spezialsocken.
    const kategorie = kategorieAus(marke.produkt);
    if (kategorie) setProdukt((alt) => alt || kategorie);
    if (marke.firma || marke.logo) setAusKonfigurator(true);
  }, []);

  useEffect(() => nachfragen(uebernehmen), [uebernehmen]);

  /* ---------- Hoehe melden ---------- */

  useEffect(() => {
    if (!eingebettet) return;
    const ziel = document.documentElement;
    const senden = () => melde('hoehe', Math.ceil(ziel.getBoundingClientRect().height));
    senden();
    const beobachter = new ResizeObserver(senden);
    beobachter.observe(ziel);
    return () => beobachter.disconnect();
  }, [eingebettet]);

  /* ---------- Logo ---------- */

  const meldung = useCallback((text: string, ausVersand = false) => {
    setFehler(text);
    setVersandFehler(text !== '' && ausVersand);
  }, []);

  const nimmDatei = useCallback((f: File | undefined | null) => {
    if (!f) return;
    if (!ERLAUBTE_TYPEN.includes(f.type)) {
      meldung('Bitte PNG, JPG oder SVG.');
      return;
    }
    if (f.size > MAX_LOGO_BYTES) {
      meldung('Die Datei ist zu groß (maximal 5 MB).');
      return;
    }
    const leser = new FileReader();
    leser.onload = () => {
      setLogo(String(leser.result));
      setLogoName(f.name);
      setOhneLogo(false);
      meldung('');
    };
    leser.onerror = () => meldung('Die Datei ließ sich nicht lesen.');
    leser.readAsDataURL(f);
  }, [meldung]);

  /* ---------- Schritte ---------- */

  const schrittOk: Record<Schritt, boolean> = {
    1: produkt !== '',
    2: ohneLogo || logo !== null,
    3: firma.trim() !== '' && person.trim() !== '' && mail.trim() !== '' && einwilligung,
  };

  function weiter() {
    if (!schrittOk[schritt]) {
      setBemaengelt(schritt);
      meldung(
        schritt === 1
          ? 'Bitte wähl ein Produkt oder „Weiß ich noch nicht“.'
          : 'Bitte lade ein Logo hoch oder wähl „Nein, noch nicht“.',
      );
      return;
    }
    setBemaengelt(null);
    meldung('');
    const naechster = (schritt === 3 ? 3 : schritt + 1) as Schritt;
    setSchritt(naechster);
    setWeiteste((w) => (naechster > w ? naechster : w));
    // String, nicht Zahl: GA4 kann nur Text als Dimension aufschluesseln.
    // Als Zahl waere daraus ein Messwert geworden, der die Schrittnummern
    // aufsummiert - eine Zahl ohne jede Bedeutung.
    spur('b2b_anfrage_schritt', { schritt: String(naechster) });
    kopf.current?.scrollIntoView({ block: 'nearest' });
  }

  function zurueck() {
    meldung('');
    setSchritt((s) => (s === 1 ? 1 : ((s - 1) as Schritt)));
  }

  function springe(ziel: Schritt) {
    if (ziel > weiteste) return;
    meldung('');
    setSchritt(ziel);
  }

  async function senden(event: React.FormEvent) {
    event.preventDefault();
    if (sendet) return;
    if (!schrittOk[3]) {
      setBemaengelt(3);
      meldung('Bitte fülle die rot markierten Felder aus.');
      return;
    }

    setSendet(true);
    meldung('');
    try {
      const antwort = await fetch('/api/anfrage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produkt,
          menge,
          logo: ohneLogo ? null : logo,
          logoName: ohneLogo ? null : logoName,
          firma,
          person,
          mail,
          telefon,
          nachricht,
          ausKonfigurator,
        }),
      });
      const daten = (await antwort.json()) as { error?: string };
      if (!antwort.ok) throw new Error(daten.error ?? 'Die Anfrage kam nicht durch.');

      setGesendet(true);
      spur('b2b_anfrage_abgeschickt', { produkt: produkt || 'ohne' });
      // Eingebettet leitet die Seite weiter, nicht der Rahmen: b2b_anfrage_success
      // haengt am Seitenaufruf der Danke-Seite.
      melde('gesendet');
    } catch (err) {
      spur('b2b_anfrage_fehler');
      meldung(err instanceof Error ? err.message : 'Die Anfrage kam nicht durch.', true);
    } finally {
      setSendet(false);
    }
  }

  const Ueberschrift = eingebettet ? 'h2' : 'h1';

  // Alle drei Schritte stehen immer im Baum, uebereinander im selben
  // Rasterfeld. Dadurch ist der Container so hoch wie der hoechste von ihnen -
  // bei jeder Breite, ohne gemessene Festwerte. Die inaktiven sind unsichtbar
  // und damit auch aus Tabreihenfolge und Vorlesereihenfolge draussen.
  /** Rote Umrandung fuer ein leeres Pflichtfeld, sobald geprueft wurde. */
  const feld = (gefuellt: boolean) =>
    bemaengelt === 3 && !gefuellt ? 'b2b-form__feld ist-fehlerhaft' : 'b2b-form__feld';

  /** Schritt 2: Ablageflaeche und Haekchen sind die beiden moeglichen Wege. */
  const logoFehlt = bemaengelt === 2 && !ohneLogo && logo === null;

  const stufe = (n: Schritt) =>
    n === schritt ? 'b2b-form__stufeninhalt' : 'b2b-form__stufeninhalt ist-verborgen';

  if (gesendet) {
    return (
      <section className={eingebettet ? 'b2b-form ist-eingebettet' : 'b2b-form'} id="b2b-anfrage">
        <div className="b2b-form__fertig">
          <Ueberschrift className="b2b-form__titel">Danke, deine Anfrage ist da.</Ueberschrift>
          <p className="b2b-form__lead">
            Innerhalb eines Werktags meldet sich jemand aus dem Team — mit Vorschlag, Preis
            und Zeitplan.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={eingebettet ? 'b2b-form ist-eingebettet' : 'b2b-form'} id="b2b-anfrage">
      <div className="b2b-form__karte">
        {fehler && (
          <div className="b2b-form__hinweisfeld" role="alert">
            <span className="b2b-form__hinweiszeichen" aria-hidden="true">
              !
            </span>
            <p>
              {fehler}
              {versandFehler && (
                <>
                  {' '}
                  <a href={`mailto:${fallbackMail}`}>Schreib uns direkt: {fallbackMail}</a>
                </>
              )}
            </p>
            <button
              type="button"
              className="b2b-form__hinweiszu"
              onClick={() => meldung('')}
              aria-label="Hinweis schließen"
            >
              &times;
            </button>
          </div>
        )}
      <div ref={kopf}>
        {/* Titel links, Logo rechts. Das Formular steht als iframe in der
           Landingpage - ohne Zeichen ist nicht zu erkennen, dass es zu
           Occulto gehoert. */}
        <div className="b2b-form__marke">
          <Ueberschrift className="b2b-form__titel">Anfrage</Ueberschrift>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="b2b-form__zeichen"
            src="/occulto-logo.png"
            alt="Occulto"
            width={600}
            height={133}
          />
        </div>

        {/* Fortschritt: drei Kreise auf einer durchgehenden Linie. Die Linie
            liegt hinter den Kreisen, der zurueckgelegte Teil ist kraeftiger. */}
        <ol className="b2b-form__leiter" aria-label="Fortschritt">
          {SCHRITTMARKEN.map((name, i) => {
            const nummer = (i + 1) as Schritt;
            const zustand =
              nummer < schritt ? ' ist-fertig' : nummer === schritt ? ' ist-aktiv' : '';
            const erreichbar = nummer <= weiteste;
            return (
              <li key={name} className={`b2b-form__stufe${zustand}`}>
                <button
                  type="button"
                  className="b2b-form__kreis"
                  onClick={() => springe(nummer)}
                  disabled={!erreichbar}
                  aria-current={nummer === schritt ? 'step' : undefined}
                  aria-label={
                    erreichbar
                      ? `Zu Schritt ${nummer}: ${name}`
                      : `Schritt ${nummer}: ${name}, noch nicht erreichbar`
                  }
                >
                  {nummer}
                </button>
                <span className="b2b-form__stufenname">{name}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="b2b-form__kopfzeile">
        <h3 className="b2b-form__frage">{SCHRITTFRAGEN[schritt - 1]}</h3>
      </div>

      {ausKonfigurator && (
        <p className="b2b-form__uebernommen">
          Aus dem Konfigurator übernommen{firma && `: ${firma}`}
          {logo && ', mit deinem Logo'}. Alles änderbar.
        </p>
      )}

      <form onSubmit={senden} noValidate>
        <div className="b2b-form__inhalt">
        {/* ---------- Schritt 1 ---------- */}
        <div className={stufe(1)}>
          <p className="b2b-form__hinweis">
            Noch unentschieden? Wir beraten dich zum passenden Produkt.
          </p>
          <div className="b2b-form__kacheln">
            {kategorien.map((p) => (
              <button
                key={p.key}
                type="button"
                className={produkt === p.key ? 'b2b-form__kachel ist-gewaehlt' : 'b2b-form__kachel'}
                aria-pressed={produkt === p.key}
                onClick={() => {
                  spurEinmal('b2b_anfrage_gestartet');
                  setProdukt(p.key);
                  meldung('');
                }}
              >
                <span className="b2b-form__kachelbild">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.vorschau} alt="" width={480} height={480} />
                  <span className="b2b-form__punkt" aria-hidden="true" />
                </span>
                <span className="b2b-form__kachelfuss">
                  <span className="b2b-form__kachelname">{p.label}</span>
                  <span className="b2b-form__kachelunter">{p.unterzeile}</span>
                </span>
              </button>
            ))}
            <button
              type="button"
              className={
                produkt === UNENTSCHIEDEN
                  ? 'b2b-form__kachel ist-offen ist-gewaehlt'
                  : 'b2b-form__kachel ist-offen'
              }
              aria-pressed={produkt === UNENTSCHIEDEN}
              onClick={() => {
                spurEinmal('b2b_anfrage_gestartet');
                setProdukt(UNENTSCHIEDEN);
                meldung('');
              }}
            >
              <span className="b2b-form__kachelbild">
                <span className="b2b-form__fragezeichen" aria-hidden="true">
                  +
                </span>
                <span className="b2b-form__punkt" aria-hidden="true" />
              </span>
              <span className="b2b-form__kachelfuss">
                <span className="b2b-form__kachelname">Weiß ich noch nicht</span>
                <span className="b2b-form__kachelunter">Gerne beraten wir dich</span>
              </span>
            </button>
          </div>
        </div>

        {/* ---------- Schritt 2 ---------- */}
        <div className={stufe(2)}>
          <div className="b2b-form__zwei">
            <div>
              <p className="b2b-form__unterfrage">Hast du schon ein Design oder Logo?</p>

              {logo && !ohneLogo ? (
                <div className="b2b-form__logo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logo} alt="Dein Logo" />
                  <div>
                    <strong>{logoName}</strong>
                    <button type="button" onClick={() => datei.current?.click()}>
                      Anderes wählen
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className={logoFehlt ? 'b2b-form__ablage ist-fehlerhaft' : 'b2b-form__ablage'}
                  onClick={() => datei.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    nimmDatei(e.dataTransfer.files[0]);
                  }}
                >
                  <svg
                    width="26"
                    height="26"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="M17 8l-5-5-5 5" />
                    <path d="M12 3v13" />
                  </svg>
                  <span className="b2b-form__ablagetitel">Drag &amp; Drop</span>
                  <span className="b2b-form__ablagehinweis">
                    Hierher ziehen oder klicken &middot; PNG, JPG, SVG bis 5 MB
                  </span>
                </button>
              )}

              <input
                ref={datei}
                type="file"
                accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                hidden
                onChange={(e) => nimmDatei(e.target.files?.[0])}
              />

              <label
                className={logoFehlt ? 'b2b-form__kasten ist-fehlerhaft' : 'b2b-form__kasten'}
              >
                <input
                  type="checkbox"
                  checked={ohneLogo}
                  onChange={(e) => {
                    setOhneLogo(e.target.checked);
                    meldung('');
                  }}
                />
                <span>Nein, noch nicht — wir entwerfen etwas für dich.</span>
              </label>
            </div>

            <div>
              <p className="b2b-form__unterfrage">Gib die voraussichtliche Stückzahl an</p>
              <p className="b2b-form__mengenwert">
                {mengeText(menge)} <span>Paar</span>
              </p>
              <input
                type="range"
                min={MENGE_MIN}
                max={MENGE_MAX}
                step={MENGE_SCHRITT}
                value={menge}
                onChange={(e) => setMenge(Number(e.target.value))}
                aria-label="Voraussichtliche Gesamtmenge"
                aria-valuetext={`${mengeText(menge)} Paar`}
                className="b2b-form__regler"
              />
              <div className="b2b-form__skala" aria-hidden="true">
                {MENGE_MARKEN.map((m) => (
                  <span key={m}>{mengeText(m)}</span>
                ))}
              </div>
              <p className="b2b-form__notiz">
                <strong>Ab 100 Paar je Größe.</strong> Die Zahl oben ist die Gesamtmenge über
                alle Größen — passt sie nicht, finden wir im Gespräch einen Weg.
              </p>
            </div>
          </div>
        </div>

        {/* ---------- Schritt 3 ---------- */}
        <div className={stufe(3)}>
          <div className="b2b-form__felder">
            <div className="b2b-form__reihe">
              <label className={feld(firma.trim() !== '')}>
                <span>Firma/Organisation/Event*</span>
                <input
                  value={firma}
                  onChange={(e) => setFirma(e.target.value)}
                  autoComplete="organization"
                  required
                />
              </label>
              <label className={feld(person.trim() !== '')}>
                <span>Ansprechpartner*</span>
                <input
                  value={person}
                  onChange={(e) => setPerson(e.target.value)}
                  autoComplete="name"
                  required
                />
              </label>
            </div>

            <div className="b2b-form__reihe">
              <label className={feld(mail.trim() !== '')}>
                <span>Email*</span>
                <input
                  type="email"
                  value={mail}
                  onChange={(e) => setMail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </label>
              <label className="b2b-form__feld">
                <span>Telefonnummer</span>
                <input
                  type="tel"
                  value={telefon}
                  onChange={(e) => setTelefon(e.target.value)}
                  autoComplete="tel"
                />
              </label>
            </div>

            {/* Frueher "Nachricht". Wer hier etwas schreibt, hat fast immer
                einen Wunsch zum Design - die Beschriftung sagt das jetzt,
                statt ein leeres Feld hinzustellen. */}
            <label className="b2b-form__feld">
              <span>Änderungswünsche & Anmerkungen (optional)</span>
              <textarea
                rows={3}
                value={nachricht}
                placeholder="Farbwünsche, Motiv-Ideen, Termine – alles, was wir wissen sollten."
                onChange={(e) => setNachricht(e.target.value)}
              />
            </label>

            <label
              className={
                bemaengelt === 3 && !einwilligung
                  ? 'b2b-form__kasten ist-fehlerhaft'
                  : 'b2b-form__kasten'
              }
            >
              <input
                type="checkbox"
                checked={einwilligung}
                onChange={(e) => setEinwilligung(e.target.checked)}
                required
              />
              <span>
                Ich stimme der Verarbeitung meiner Angaben zu (
                <a href={datenschutz} target="_blank" rel="noreferrer">
                  Datenschutz
                </a>
                ). *
              </span>
            </label>
          </div>
        </div>
        </div>

        {/* Der letzte Satz vor dem Absenden. Die Unverbindlichkeit ist das
            Wichtigste an diesem Formular und stand bisher nur klein unter
            den Belegen. */}
        {schritt === 3 && (
          <p className="b2b-form__zusage">
            Unverbindlich und kostenlos – ihr bekommt einen Designvorschlag, keine Rechnung.
          </p>
        )}

        <div className="b2b-form__leiste">
          {schritt > 1 ? (
            <button type="button" className="b2b-form__knopf" onClick={zurueck}>
              zurück
            </button>
          ) : (
            <span />
          )}
          {schritt < 3 ? (
            <button type="button" className="b2b-form__knopf ist-stark" onClick={weiter}>
              Weiter
            </button>
          ) : (
            <button type="submit" className="b2b-form__knopf ist-stark" disabled={sendet}>
              {sendet ? 'Wird gesendet …' : 'Unverbindlich anfragen'}
            </button>
          )}
        </div>
      </form>

        {/* Drei Angaben, die im Gespraech ohnehin kommen. Wortlaut wie auf
            der Landingpage - hier soll nichts behauptet werden, was dort
            nicht steht. */}
        <ul className="b2b-form__siegel">
          {BELEGE.map((b) => (
            <li key={b.text}>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                {b.pfade.map((p) => (
                  <path key={p} d={p} />
                ))}
              </svg>
              {b.text}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
