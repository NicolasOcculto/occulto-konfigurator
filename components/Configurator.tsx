'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { aufNachfrageAntworten, melden, type Marke } from '@/lib/markenkanal';
import type { ProductCard } from '@/lib/products';

/** Standardpalette, solange die Website keine eigenen Markenfarben hergibt. */
const BASE_COLORS = [
  '#FFFFFF',
  '#141414',
  '#1C2E52',
  '#9E1B1B',
  '#14523B',
  '#8A8D91',
  '#D8C7A4',
  '#E0A81F',
];

const MAX_LOGO_BYTES = 4_000_000;

type BrandResponse = {
  company: string | null;
  logo: { dataUri: string; source: string; width: number; height: number } | null;
  colors: Array<{ hex: string }>;
  strategy: string;
  cached: boolean;
  notes: string[];
  error?: string;
};

type RenderResponse = {
  results: Array<{ key: string; image: string }>;
  error?: string;
};

function formatPrice(value: number | null): string {
  // null heisst: Preis steht noch nicht fest, wird im Angebot gerechnet.
  if (value === null) return 'Preis auf Anfrage';
  const betrag = value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  return `ab ${betrag}`;
}

/** Nachricht an die einbettende Seite. Kein Nutzerinhalt, nur Steuerdaten. */
function melde(was: 'hoehe' | 'anfrage', hoehe?: number) {
  if (typeof window === 'undefined' || window.parent === window) return;
  // Zielorigin '*': gesendet wird ausschliesslich die Hoehe bzw. ein Klick-Signal.
  // Die Gegenseite prueft ihrerseits den Absender, bevor sie reagiert.
  window.parent.postMessage({ typ: 'occulto-konfigurator', was, hoehe }, '*');
}

export default function Configurator({
  products,
  eingebettet = false,
  shop = '',
}: {
  products: ProductCard[];
  eingebettet?: boolean;
  /** Adresse des Shops, von der einbettenden Seite durchgereicht. */
  shop?: string;
}) {
  const [domain, setDomain] = useState('');
  const [company, setCompany] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [logoLabel, setLogoLabel] = useState<string | null>(null);
  const [palette, setPalette] = useState<string[]>(BASE_COLORS);
  const [tint, setTint] = useState('#FFFFFF');
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [isError, setIsError] = useState(false);
  const [looking, setLooking] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Grosse Ansicht: die Tennissocke steht vorn, die uebrigen daneben zum Durchklicken.
  const [aktiv, setAktiv] = useState(
    () => products.find((p) => p.key === 'tennis')?.key ?? products[0]?.key ?? '',
  );
  const [lupe, setLupe] = useState(false);
  // Zoompunkt in Prozent der Buehne. transform-origin rechnet auf die Randbox,
  // deshalb stimmt der Punkt auch bei object-fit: contain.
  const [lupenPunkt, setLupenPunkt] = useState({ x: 50, y: 50 });

  const fileInput = useRef<HTMLInputElement>(null);
  const renderAbort = useRef<AbortController | null>(null);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((message: string, error = false) => {
    setStatus(message);
    setIsError(error);
  }, []);

  /* ---------- Rendern ---------- */

  const runRender = useCallback(
    async (logoUri: string | null, color: string, name: string) => {
      if (!logoUri && !name) {
        setPreviews({});
        return;
      }

      renderAbort.current?.abort();
      const controller = new AbortController();
      renderAbort.current = controller;
      setRendering(true);

      try {
        const res = await fetch('/api/render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ logo: logoUri, color, company: name || undefined }),
          signal: controller.signal,
        });
        const data = (await res.json()) as RenderResponse;
        if (!res.ok) throw new Error(data.error ?? 'Die Vorschau kam nicht zurueck.');

        const next: Record<string, string> = {};
        for (const item of data.results) next[item.key] = item.image;
        setPreviews(next);
      } catch (err) {
        if (controller.signal.aborted) return;
        say(err instanceof Error ? err.message : 'Die Vorschau kam nicht zurueck.', true);
      } finally {
        if (!controller.signal.aborted) setRendering(false);
      }
    },
    [say],
  );

  // Farbwaehler feuert bei jedem Zug: kurz sammeln, damit nicht jede Zwischenfarbe rendert.
  useEffect(() => {
    if (!logo && !company) return;
    if (renderTimer.current) clearTimeout(renderTimer.current);
    renderTimer.current = setTimeout(() => {
      void runRender(logo, tint, company);
    }, 220);
    return () => {
      if (renderTimer.current) clearTimeout(renderTimer.current);
    };
  }, [logo, tint, company, runRender]);

  useEffect(() => () => renderAbort.current?.abort(), []);

  // Was hier erkannt wurde, soll das Anfrageformular weiter unten nicht noch
  // einmal abfragen. Beide Richtungen sind noetig: das Formular laedt spaeter
  // und fragt nach, aber genauso oft steht es schon, wenn hier erst die Domain
  // eingegeben wird - dann muss der Stand von sich aus hinueber.
  const marke = (): Marke | null => {
    if (!company && !logo) return null;
    return { firma: company, logo, produkt: aktiv || null };
  };

  const markeRef = useRef(marke);
  markeRef.current = marke;
  useEffect(() => aufNachfrageAntworten(() => markeRef.current()), []);
  useEffect(() => {
    melden(marke());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, logo, aktiv]);

  // Im iframe kennt die Landingpage die noetige Hoehe nicht. Statt einer festen
  // Zahl meldet die App sie bei jeder Aenderung - sonst scrollt der Rahmen intern.
  useEffect(() => {
    if (!eingebettet) return;
    const ziel = document.documentElement;
    const senden = () => melde('hoehe', Math.ceil(ziel.getBoundingClientRect().height));
    senden();
    const beobachter = new ResizeObserver(senden);
    beobachter.observe(ziel);
    return () => beobachter.disconnect();
  }, [eingebettet]);

  /* ---------- Markenerkennung ---------- */

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    const value = domain.trim();
    if (!value || looking) return;

    setLooking(true);
    say('Website wird gelesen …');

    try {
      const res = await fetch('/api/brand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: value }),
      });
      const data = (await res.json()) as BrandResponse;
      if (!res.ok) throw new Error(data.error ?? 'Die Domain liess sich nicht auswerten.');

      if (data.company) setCompany(data.company);

      const found = data.colors.map((c) => c.hex).filter(Boolean);
      const merged = [...new Set([...found, ...BASE_COLORS])].slice(0, 12);
      setPalette(merged);

      if (data.logo) {
        setLogo(data.logo.dataUri);
        setLogoLabel(`${data.logo.width} × ${data.logo.height} px · ${data.logo.source}`);
        // Die Markenfarben stehen in der Palette bereit, ausgewaehlt wird aber
        // nichts: Weiss ist die Standardfarbe und bleibt es, bis jemand klickt.
        say(
          data.strategy === 'extracted'
            ? 'Logo von deiner Website übernommen.'
            : `Logo über ${data.strategy} gefunden.`,
        );
      } else {
        say('Kein Logo gefunden. Zieh es einfach in das Feld daneben.', true);
      }
    } catch (err) {
      say(err instanceof Error ? err.message : 'Die Domain liess sich nicht auswerten.', true);
    } finally {
      setLooking(false);
    }
  }

  /* ---------- Logo von Hand ---------- */

  const acceptFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        say('Das ist keine Bilddatei.', true);
        return;
      }
      if (file.size > MAX_LOGO_BYTES) {
        say('Die Datei ist zu groß (maximal 4 MB).', true);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setLogo(String(reader.result));
        setLogoLabel(file.name);
        say('');
      };
      reader.onerror = () => say('Die Datei liess sich nicht lesen.', true);
      reader.readAsDataURL(file);
    },
    [say],
  );

  // Logo aus der Zwischenablage einfuegen.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const item = [...(event.clipboardData?.items ?? [])].find((i) =>
        i.type.startsWith('image/'),
      );
      if (item) acceptFile(item.getAsFile());
    }
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [acceptFile]);

  const hasResult = logo !== null || company !== '';
  const lieferzeit = products[0]?.leadTime ?? '';
  const gezeigt = products.find((p) => p.key === aktiv) ?? products[0];
  const Ueberschrift = eingebettet ? 'h2' : 'h1';

  /** Cursorposition in Prozent der Buehne. */
  function punkt(event: React.MouseEvent<HTMLElement>) {
    const r = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((event.clientX - r.left) / r.width) * 100)),
      y: Math.min(100, Math.max(0, ((event.clientY - r.top) / r.height) * 100)),
    };
  }

  return (
    <section
      className={eingebettet ? 'b2b-konfig ist-eingebettet' : 'b2b-konfig'}
      id="b2b-konfigurator"
    >
      <div className="b2b-konfig__raster">
        <div className="b2b-konfig__links">
          {/* Eingebettet ist die Seite schon mit einer h1 versorgt, hier gehoert
              dann eine h2 hin. */}
          <p className="b2b-konfig__label">Konfigurator</p>
          {/* Zwei Zeilen mit unterschiedlichem Gewicht: die erste ist die
              Ansage, die zweite die Antwort darauf. Sie sagt bewusst, dass das
              Design von uns kommt - was der Konfigurator zeigt, ist ein
              Automat und soll nicht fuer den Entwurf gehalten werden. */}
          <Ueberschrift className="b2b-konfig__titel">
            Das echte Design
            <span>kommt von uns.</span>
          </Ueberschrift>
          <div className="b2b-konfig__einleitung">
            <p className="b2b-konfig__text">
              Unsere Grafikabteilung entwirft für euch ein Design – kostenlos und
              unverbindlich. Von der schlichten Logosocke bis zum aufwendigen Muster:
              wir können alles.
            </p>
            <p className="b2b-konfig__text">
              Und wenn ihr ungeduldig seid und schon mal sehen wollt, wie euer Logo auf
              einer Socke aussieht – probiert den Konfigurator.
            </p>
          </div>

          <div className="b2b-konfig__eingabe">
            <form className="b2b-konfig__feld" onSubmit={lookup}>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="Deine URL"
                autoComplete="off"
                spellCheck={false}
                aria-label="Adresse deiner Website"
              />
              <button
                type="submit"
                className="b2b-konfig__pfeil"
                disabled={looking || domain.trim() === ''}
                aria-label="Logo von der Website holen"
              >
                {looking ? (
                  <span className="b2b-konfig__spinner" aria-hidden="true" />
                ) : (
                  <span aria-hidden="true">&rsaquo;</span>
                )}
              </button>
            </form>

            <button
              type="button"
              className={`b2b-konfig__drop${dragging ? ' ist-ueber' : ''}${logo ? ' hat-logo' : ''}`}
              title="PNG mit transparentem Hintergrund passt am besten"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                acceptFile(e.dataTransfer.files[0]);
              }}
            >
              <svg
                width="18"
                height="18"
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
              {/* Der Dateiname steht schon in der Trefferzeile darunter — hier
                  waere er nur doppelt und wuerde das Feld sprengen. */}
              <span>{logo ? 'Logo ersetzen' : 'Drag & Drop'}</span>
            </button>
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => acceptFile(e.target.files?.[0])}
          />

          <p
            className={isError ? 'b2b-konfig__hinweis ist-fehler' : 'b2b-konfig__hinweis'}
            role="status"
          >
            {status}
          </p>

          {logo && (
            <div className="b2b-konfig__treffer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} alt="Erkanntes Logo" />
              <div>
                <strong>{company || 'Logo bereit'}</strong>
                <span>{logoLabel}</span>
              </div>
            </div>
          )}

          {hasResult && (
            <div className="b2b-konfig__farben">
              <h2 className="b2b-konfig__farbtitel">Akzentfarbe</h2>
              <div className="b2b-konfig__tupfer">
                {palette.map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    aria-label={`Akzentfarbe ${color}`}
                    aria-pressed={color.toUpperCase() === tint.toUpperCase()}
                    style={{ background: color }}
                    onClick={() => setTint(color)}
                  />
                ))}
                <input
                  type="color"
                  value={tint}
                  title="Eigene Farbe"
                  aria-label="Eigene Farbe"
                  onChange={(e) => setTint(e.target.value)}
                />
              </div>
              <p className="b2b-konfig__farbnote">
                Die Farbe färbt die beiden Ringe am Bund, nicht die ganze Socke. Dunkle Ware
                bleibt dunkel — dort sitzt dein Logo im eingewebten Label.
              </p>
            </div>
          )}

          <div className="b2b-konfig__knoepfe">
            <button
              type="button"
              className="b2b-konfig__cta"
              onClick={() => {
                // Eingebettet springt die Landingpage zum Anfrageblock; allein
                // stehend gibt es dort noch nichts, also nur ein Hinweis.
                if (eingebettet) melde('anfrage');
                else say('Nur Beispiel — das Anfrageformular kommt als Nächstes.');
              }}
            >
              Unverbindlich anfragen
            </button>
            {gezeigt && (
              // target="_top" statt "_blank": im iframe wuerde der Link sonst
              // die Produktseite in den Rahmen des Konfigurators laden.
              <a
                className="b2b-konfig__mehr"
                href={`${shop}/products/${gezeigt.shopHandle}?view=b2b-produkt`}
                target="_top"
                title={`Details zur ${gezeigt.label}`}
              >
                Details
              </a>
            )}
          </div>
          <p className="b2b-konfig__klein">
            Unverbindlich · Designvorschlag kostenlos{lieferzeit && ` · Lieferzeit ${lieferzeit}`}
          </p>
        </div>

        <div className="b2b-konfig__ansicht">
          <div
            className={
              rendering ? 'b2b-konfig__buehne ist-beschaeftigt' : 'b2b-konfig__buehne'
            }
          >
            {gezeigt && (
              <button
                type="button"
                className={lupe ? 'b2b-konfig__glas ist-gezoomt' : 'b2b-konfig__glas'}
                aria-label={
                  lupe ? `${gezeigt.label} wieder verkleinern` : `${gezeigt.label} vergrößern`
                }
                onClick={(e) => {
                  setLupenPunkt(punkt(e));
                  setLupe((an) => !an);
                }}
                onMouseMove={(e) => {
                  if (lupe) setLupenPunkt(punkt(e));
                }}
                onMouseLeave={() => setLupe(false)}
              >
                {/* Produktfotos und Mockups kommen fertig skaliert; der Optimizer wuerde
                    data:-URIs ohnehin nicht anfassen. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previews[gezeigt.key] ?? gezeigt.image}
                  alt={
                    previews[gezeigt.key]
                      ? `${gezeigt.label} mit deinem Logo`
                      : `${gezeigt.label}, Musterbild`
                  }
                  width={gezeigt.w}
                  height={gezeigt.h}
                  style={{
                    transform: lupe ? 'scale(2.6)' : 'none',
                    transformOrigin: `${lupenPunkt.x}% ${lupenPunkt.y}%`,
                  }}
                />
                <span className="b2b-konfig__lupe" aria-hidden="true">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" />
                    <path d={lupe ? 'M8 11h6' : 'M8 11h6M11 8v6'} />
                  </svg>
                </span>
              </button>
            )}
          </div>

          <div className="b2b-konfig__wahl" role="group" aria-label="Produkt auswählen">
            {products.map((product) => (
              <button
                key={product.key}
                type="button"
                className={
                  product.key === aktiv
                    ? 'b2b-konfig__wahlknopf ist-aktiv'
                    : 'b2b-konfig__wahlknopf'
                }
                aria-pressed={product.key === aktiv}
                onClick={() => {
                  setAktiv(product.key);
                  setLupe(false);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {/* Ohne Mockup das zugeschnittene Vorschaubild: im Original
                    belegt die Socke nur einen Bruchteil der Breite und ist in
                    dieser Groesse nicht zu erkennen. */}
                <span className="b2b-konfig__wahlbild">
                  <img
                    src={previews[product.key] ?? product.preview}
                    alt=""
                    width={product.w}
                    height={product.h}
                  />
                </span>
                <span className="b2b-konfig__wahlname">{product.label}</span>
              </button>
            ))}
          </div>

          {/* Sobald ein Bild gerechnet wurde, steht der Vorbehalt dabei.
              Vorher nicht: das Musterfoto behauptet nichts. */}
          {gezeigt && previews[gezeigt.key] && (
            <p className="b2b-konfig__vorbehalt">
              Das ist eine automatische Vorschau, kein fertiges Design – unverbindlich und
              nur zur Inspiration. Euer echtes Design macht unsere Grafikabteilung, und die
              macht es deutlich besser.
            </p>
          )}

          {gezeigt && (
            <div className="b2b-konfig__untertitel">
              {/* Der Preis steht neben dem Namen: er ist das zweite, wonach
                  gefragt wird, und ging in der Zeile darunter unter. Die
                  Mindestmenge bleibt dort - sie ist eine Bedingung, keine
                  Ueberschrift. */}
              <p className="b2b-konfig__bildtitel">
                {gezeigt.label} <span>{formatPrice(gezeigt.priceFrom)}</span>
              </p>
              <p className="b2b-konfig__bildtext">{gezeigt.material}</p>
              <p className="b2b-konfig__bildpreis">
                ab {gezeigt.minQuantity} {gezeigt.unit} pro Größe
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
