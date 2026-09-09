'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { nachfragen, type Marke } from '@/lib/markenkanal';
import type { ProductCard } from '@/lib/products';

const MAX_LOGO_BYTES = 5_000_000;
const ERLAUBTE_TYPEN = ['image/png', 'image/jpeg', 'image/svg+xml'];

/** Gesamtmenge, nicht Menge pro Groesse. Zu kleine Mengen werden nicht blockiert. */
const MENGEN = [100, 250, 500, 1000, 2000] as const;

const UNENTSCHIEDEN = 'unklar';

/** Kurz unter den Ziffern, damit man weiss wo man steht. */
const SCHRITTMARKEN = ['Produkt', 'Design & Menge', 'Kontakt'] as const;
/** Die eigentliche Frage des Schritts, als Ueberschrift darunter. */
const SCHRITTFRAGEN = ['Um welche Socke gehts?', 'Design & Stückzahl', 'Kontakt Daten'] as const;

type Schritt = 1 | 2 | 3;

/** Nachricht an die einbettende Seite. Kein Nutzerinhalt, nur Steuerdaten. */
function melde(was: 'hoehe' | 'gesendet' | 'frage-marke', hoehe?: number) {
  if (typeof window === 'undefined' || window.parent === window) return;
  window.parent.postMessage({ typ: 'occulto-anfrage', was, hoehe }, '*');
}

function mengeText(menge: number): string {
  return menge >= 2000 ? `${menge}+` : String(menge);
}

export default function Anfrage({
  products,
  eingebettet = false,
  fallbackMail,
}: {
  products: ProductCard[];
  eingebettet?: boolean;
  fallbackMail: string;
}) {
  const [schritt, setSchritt] = useState<Schritt>(1);

  const [produkt, setProdukt] = useState<string>('');

  const [logo, setLogo] = useState<string | null>(null);
  const [logoName, setLogoName] = useState<string | null>(null);
  const [ohneLogo, setOhneLogo] = useState(false);
  const [mengeIndex, setMengeIndex] = useState(1);

  const [firma, setFirma] = useState('');
  const [person, setPerson] = useState('');
  const [mail, setMail] = useState('');
  const [telefon, setTelefon] = useState('');
  const [nachricht, setNachricht] = useState('');
  const [einwilligung, setEinwilligung] = useState(false);

  const [ausKonfigurator, setAusKonfigurator] = useState(false);
  const [fehler, setFehler] = useState('');
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
    if (marke.produkt) setProdukt((alt) => alt || marke.produkt!);
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

  const nimmDatei = useCallback((f: File | undefined | null) => {
    if (!f) return;
    if (!ERLAUBTE_TYPEN.includes(f.type)) {
      setFehler('Bitte PNG, JPG oder SVG.');
      return;
    }
    if (f.size > MAX_LOGO_BYTES) {
      setFehler('Die Datei ist zu groß (maximal 5 MB).');
      return;
    }
    const leser = new FileReader();
    leser.onload = () => {
      setLogo(String(leser.result));
      setLogoName(f.name);
      setOhneLogo(false);
      setFehler('');
    };
    leser.onerror = () => setFehler('Die Datei ließ sich nicht lesen.');
    leser.readAsDataURL(f);
  }, []);

  /* ---------- Schritte ---------- */

  const schrittOk: Record<Schritt, boolean> = {
    1: produkt !== '',
    2: ohneLogo || logo !== null,
    3: firma.trim() !== '' && person.trim() !== '' && mail.trim() !== '' && einwilligung,
  };

  function weiter() {
    if (!schrittOk[schritt]) {
      setFehler(
        schritt === 1
          ? 'Bitte wähl ein Produkt oder „Weiß ich noch nicht“.'
          : 'Bitte lade ein Logo hoch oder wähl „Nein, noch nicht“.',
      );
      return;
    }
    setFehler('');
    setSchritt((s) => (s === 3 ? 3 : ((s + 1) as Schritt)));
    kopf.current?.scrollIntoView({ block: 'nearest' });
  }

  function zurueck() {
    setFehler('');
    setSchritt((s) => (s === 1 ? 1 : ((s - 1) as Schritt)));
  }

  async function senden(event: React.FormEvent) {
    event.preventDefault();
    if (sendet) return;
    if (!schrittOk[3]) {
      setFehler('Bitte fülle Firma, Ansprechpartner und E-Mail aus und stimme dem Datenschutz zu.');
      return;
    }

    setSendet(true);
    setFehler('');
    try {
      const antwort = await fetch('/api/anfrage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produkt,
          menge: MENGEN[mengeIndex],
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
      // Eingebettet leitet die Seite weiter, nicht der Rahmen: b2b_anfrage_success
      // haengt am Seitenaufruf der Danke-Seite.
      melde('gesendet');
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Die Anfrage kam nicht durch.');
    } finally {
      setSendet(false);
    }
  }

  const Ueberschrift = eingebettet ? 'h2' : 'h1';

  if (gesendet) {
    return (
      <section className={eingebettet ? 'b2b-form ist-eingebettet' : 'b2b-form'} id="b2b-anfrage">
        <div className="b2b-form__fertig">
          <Ueberschrift className="b2b-form__titel">Danke, deine Anfrage ist da.</Ueberschrift>
          <p className="b2b-form__lead">
            Wir melden uns innerhalb eines Werktags mit einem Vorschlag bei dir.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={eingebettet ? 'b2b-form ist-eingebettet' : 'b2b-form'} id="b2b-anfrage">
      <div ref={kopf}>
        <Ueberschrift className="b2b-form__titel">Anfrage</Ueberschrift>

        {/* Fortschritt: drei Kreise auf einer durchgehenden Linie. Die Linie
            liegt hinter den Kreisen, der zurueckgelegte Teil ist kraeftiger. */}
        <ol className="b2b-form__leiter" aria-label="Fortschritt">
          {SCHRITTMARKEN.map((name, i) => {
            const nummer = (i + 1) as Schritt;
            const zustand =
              nummer < schritt ? ' ist-fertig' : nummer === schritt ? ' ist-aktiv' : '';
            return (
              <li key={name} className={`b2b-form__stufe${zustand}`}>
                <span
                  className="b2b-form__kreis"
                  aria-current={nummer === schritt ? 'step' : undefined}
                >
                  {nummer}
                </span>
                <span className="b2b-form__stufenname">{name}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <h3 className="b2b-form__frage">{SCHRITTFRAGEN[schritt - 1]}</h3>

      {ausKonfigurator && (
        <p className="b2b-form__uebernommen">
          Aus dem Konfigurator übernommen{firma && `: ${firma}`}
          {logo && ', mit deinem Logo'}. Alles änderbar.
        </p>
      )}

      <form onSubmit={senden} noValidate>
        {/* ---------- Schritt 1 ---------- */}
        {schritt === 1 && (
          <div className="b2b-form__kacheln">
            {products.map((p) => (
              <button
                key={p.key}
                type="button"
                className={produkt === p.key ? 'b2b-form__kachel ist-gewaehlt' : 'b2b-form__kachel'}
                aria-pressed={produkt === p.key}
                onClick={() => {
                  setProdukt(p.key);
                  setFehler('');
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt="" width={480} height={480} />
                <span className="b2b-form__kachelname">{p.label}</span>
                <span className="b2b-form__punkt" aria-hidden="true" />
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
                setProdukt(UNENTSCHIEDEN);
                setFehler('');
              }}
            >
              <span className="b2b-form__fragezeichen" aria-hidden="true">
                ?
              </span>
              <span className="b2b-form__kachelname">Weiß ich noch nicht</span>
              <span className="b2b-form__punkt" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* ---------- Schritt 2 ---------- */}
        {schritt === 2 && (
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
                  className="b2b-form__ablage"
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
                  <span className="b2b-form__ablagehinweis">PNG, JPG oder SVG, bis 5 MB</span>
                </button>
              )}

              <input
                ref={datei}
                type="file"
                accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                hidden
                onChange={(e) => nimmDatei(e.target.files?.[0])}
              />

              <label className="b2b-form__kasten">
                <input
                  type="checkbox"
                  checked={ohneLogo}
                  onChange={(e) => {
                    setOhneLogo(e.target.checked);
                    setFehler('');
                  }}
                />
                <span>Nein, noch nicht — wir entwerfen etwas für dich.</span>
              </label>
            </div>

            <div>
              <p className="b2b-form__unterfrage">
                Gib die voraussichtliche Stückzahl an (100 – 2000+)
              </p>
              <input
                type="range"
                min={0}
                max={MENGEN.length - 1}
                step={1}
                value={mengeIndex}
                onChange={(e) => setMengeIndex(Number(e.target.value))}
                aria-label="Voraussichtliche Gesamtmenge"
                aria-valuetext={`${mengeText(MENGEN[mengeIndex]!)} Stück`}
                className="b2b-form__regler"
              />
              <div className="b2b-form__skala" aria-hidden="true">
                {MENGEN.map((m, i) => (
                  <span key={m} className={i === mengeIndex ? 'ist-aktiv' : undefined}>
                    {mengeText(m)}
                  </span>
                ))}
              </div>
              <p className="b2b-form__notiz">
                Gesamtmenge über alle Größen. Produziert wird ab 100 Paar <strong>je Größe</strong>{' '}
                — passt das nicht, finden wir im Gespräch einen Weg.
              </p>
            </div>
          </div>
        )}

        {/* ---------- Schritt 3 ---------- */}
        {schritt === 3 && (
          <div className="b2b-form__felder">
            <div className="b2b-form__reihe">
              <label className="b2b-form__feld">
                <span>Firma/Organisation/Event*</span>
                <input
                  value={firma}
                  onChange={(e) => setFirma(e.target.value)}
                  autoComplete="organization"
                  required
                />
              </label>
              <label className="b2b-form__feld">
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
              <label className="b2b-form__feld">
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

            <label className="b2b-form__feld">
              <span>Nachricht (Optional)</span>
              <textarea
                rows={3}
                value={nachricht}
                onChange={(e) => setNachricht(e.target.value)}
              />
            </label>

            <label className="b2b-form__kasten">
              <input
                type="checkbox"
                checked={einwilligung}
                onChange={(e) => setEinwilligung(e.target.checked)}
                required
              />
              <span>
                Ich bin einverstanden, dass meine Angaben zur Bearbeitung der Anfrage gespeichert
                werden. Mehr in der{' '}
                <a href="/policies/privacy-policy" target="_blank" rel="noreferrer">
                  Datenschutzerklärung
                </a>
                . *
              </span>
            </label>
          </div>
        )}

        {fehler && (
          <p className="b2b-form__fehler" role="alert">
            {fehler} <a href={`mailto:${fallbackMail}`}>Oder schreib uns direkt: {fallbackMail}</a>
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
              {sendet ? 'Wird gesendet …' : 'Anfrage senden'}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
