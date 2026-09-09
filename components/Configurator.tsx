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

function formatPrice(value: number): string {
  return value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
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
            ? 'Logo von der Website uebernommen.'
            : `Logo ueber ${data.strategy} gefunden.`,
        );
      } else {
        say('Kein Logo gefunden. Zieh es einfach hierher.', true);
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
        say('Die Datei ist zu gross (maximal 4 MB).', true);
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

  return (
    <div className="wrap">
      <div className="panel">
        <h1>Sieh dein Logo auf echten Socken.</h1>
        <p className="lede">
          Firmendomain eingeben — wir holen Logo und Markenfarben von der Website und setzen sie auf
          unsere Produkte.
        </p>

        <form className="field" onSubmit={lookup}>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="firma.de"
            autoComplete="off"
            spellCheck={false}
            aria-label="Firmendomain"
          />
          <button type="submit" className="go" disabled={looking || domain.trim() === ''}>
            {looking ? 'Suche …' : 'Logo holen'}
          </button>
        </form>

        <p className={isError ? 'status err' : 'status'} role="status">
          {status}
        </p>

        <div className="divider">oder</div>

        <button
          type="button"
          className={`drop${dragging ? ' over' : ''}${logo ? ' loaded' : ''}`}
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
          <span className="drop-title">
            {logo ? (logoLabel ?? 'Logo geladen') : 'Logo hierher ziehen'}
          </span>
          <span className="drop-hint">
            {logo
              ? 'Anderes Logo ablegen, um es zu ersetzen'
              : 'oder klicken zum Auswaehlen · PNG mit transparentem Hintergrund passt am besten'}
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => acceptFile(e.target.files?.[0])}
        />

        {logo && (
          <div className="found">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt="Erkanntes Logo" />
            <div>
              <strong>{company || 'Logo bereit'}</strong>
              <span>{logoLabel}</span>
            </div>
          </div>
        )}

        {hasResult && (
          <div className="colors">
            <h2>Produktfarbe</h2>
            <div className="sw">
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
            <p className="brandhint">
              Dunkle Ware wird nicht eingefaerbt — dort steht das Logo weiss auf Schwarz.
            </p>
          </div>
        )}

        <button
          type="button"
          className="cta"
          disabled={!hasResult}
          onClick={() => say('Nur Beispiel — das Anfrageformular kommt als Naechstes.')}
        >
          Anfrage senden
        </button>
        <p className="fineprint">Unverbindlich · Designvorschlag kostenlos</p>
      </div>

      <div className={rendering ? 'grid busy' : 'grid'}>
        {products.map((product) => (
          <article className="tile" key={product.key}>
            <figure>
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
            </figure>
            <div className="meta">
              <h3>{product.label}</h3>
              <p className="material">{product.material}</p>
              <dl>
                <dt>Preis ab</dt>
                <dd className="price">{formatPrice(product.priceFrom)}</dd>
                <dt>Mindestmenge</dt>
                <dd>
                  {product.minQuantity} {product.unit}
                </dd>
                <dt>Lieferzeit</dt>
                <dd>{product.leadTime}</dd>
              </dl>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
