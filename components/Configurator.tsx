'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

export default function Configurator({ products }: { products: ProductCard[] }) {
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
        if (found[0]) setTint(found[0]);
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

  return (
    <section className="b2b-konfig" id="b2b-konfigurator">
      <div className="b2b-konfig__raster">
        <div className="b2b-konfig__links">
          <h1 className="b2b-konfig__titel">Dein Logo &ndash; Unser Design</h1>
          <p className="b2b-konfig__text">
            Gib für Inspiration die URL deiner Website ein. Änderungen passen wir gern unverbindlich
            und kostenlos an.
          </p>

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
              <h2 className="b2b-konfig__farbtitel">Produktfarbe</h2>
              <div className="b2b-konfig__tupfer">
                {palette.map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    aria-label={`Produktfarbe ${color}`}
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
                Dunkle Ware wird nicht eingefärbt — dort steht dein Logo weiß auf Schwarz.
              </p>
            </div>
          )}

          <button
            type="button"
            className="b2b-konfig__cta"
            disabled={!hasResult}
            onClick={() => say('Nur Beispiel — das Anfrageformular kommt als Nächstes.')}
          >
            Jetzt anfragen
          </button>
          <p className="b2b-konfig__klein">
            Unverbindlich · Designvorschlag kostenlos{lieferzeit && ` · Lieferzeit ${lieferzeit}`}
          </p>
        </div>

        <div
          className={rendering ? 'b2b-konfig__kacheln ist-beschaeftigt' : 'b2b-konfig__kacheln'}
        >
          {products.map((product) => (
            <figure className="b2b-konfig__kachel" key={product.key}>
              <div className="b2b-konfig__bild">
                {/* Produktfotos und Mockups kommen fertig skaliert; der Optimizer wuerde
                    data:-URIs ohnehin nicht anfassen. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previews[product.key] ?? product.image}
                  alt={
                    previews[product.key]
                      ? `${product.label} mit deinem Logo`
                      : `${product.label}, Musterbild`
                  }
                  width={product.w}
                  height={product.h}
                />
              </div>
              <figcaption>
                <p className="b2b-konfig__bildtitel">{product.label}</p>
                <p className="b2b-konfig__bildtext">{product.material}</p>
                <p className="b2b-konfig__bildpreis">
                  {formatPrice(product.priceFrom)} · ab {product.minQuantity} {product.unit} pro
                  Größe
                </p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
