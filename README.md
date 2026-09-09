# Occulto Merch-Konfigurator

Next.js 16 (App Router) für Vercel. Der Besucher gibt eine Firmendomain ein, der Server
holt Logo und Markenfarben von der Website und rendert damit Produktmockups mit sharp.

## Start

```bash
npm install
npm run dev
```

Ohne API-Schlüssel läuft alles bis auf die Rückfallebene der Logo-Erkennung.

## Umgebungsvariablen

Siehe `.env.example`. Alle Schlüssel werden **ausschließlich serverseitig** aus
`process.env` gelesen — kein `NEXT_PUBLIC_`-Präfix, also nichts davon im Browser-Bundle.
`lib/brand/fallback.ts` importiert zusätzlich `server-only`: landet das Modul versehentlich
in einem Client-Bundle, schlägt schon der Build fehl.

| Variable | Zweck |
| --- | --- |
| `LOGO_DEV_TOKEN` | Rückfallebene 1, wenn die eigene Extraktion nichts Brauchbares findet |
| `BRANDFETCH_API_KEY` | Rückfallebene 2, liefert zusätzlich Markenfarben |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Geteilter Cache und Rate-Limit über alle Instanzen |

## `/api/brand`

`POST { "domain": "firma.de" }` (auch `GET ?domain=`).

1. Domain normalisieren, Website abrufen — mit Timeout, Größenlimit, eigener
   Redirect-Kette und DNS-Prüfung gegen private Adressbereiche (SSRF-Schutz).
2. Logo-Kandidaten in Dokumentreihenfolge sammeln: `og:image`, `twitter:image`,
   `link rel=icon` / `apple-touch-icon` / `mask-icon`, JSON-LD `logo`, Inline-SVG und
   `<img>` im Kopfbereich, `url()` aus CSS-Hintergründen (Inline, `<style>`, bis zu drei
   verlinkte Stylesheets), zuletzt `/favicon.ico`.
3. Markenfarben aus dem CSS: Hex/rgb/hsl mit Gewichtung nach Fundstelle
   (`--brand`/`--primary` zählen am schwersten), Graustufen und Fast-Weiß/Schwarz raus,
   ähnliche Töne zu Clustern verschmolzen.
4. Die aussichtsreichsten sechs Kandidaten werden geladen und mit sharp vermessen.
   Bewertung nach Größe, Seitenverhältnis, Position im Dokument, Quelle, Transparenz
   und Bildentropie (flache Grafik statt Foto). Social-Card-Format wird abgewertet.
5. Reicht das beste Ergebnis nicht (Score < 60), greift Logo.dev bzw. Brandfetch.
6. Ergebnis 30 Tage im Cache; Treffer ohne Logo nur eine Stunde, damit ein später
   nachgerüsteter Schlüssel nicht einen Monat blockiert wird.

Rate-Limit: 40 Anfragen pro IP und Stunde.

## `/api/render`

`POST { logo, color, company?, products?, width? }` — `logo` ist eine `data:`-URI
(max. 4 MB). Antwort: WebP-Mockups als `data:`-URIs.

Pipeline je Produkt (`lib/render/mockup.ts`):

1. Produktfoto laden, Hintergrund per Flood-Fill von den Rändern freistellen.
   Bringt das Foto schon einen transparenten Hintergrund mit, läuft die Füllung nur
   durch die transparenten Flächen — sonst würde weiße Ware selbst weggeschnitten.
2. Vorhandenen Aufdruck ausmessen und übermalen: erst die helle Trägerfläche
   eingrenzen, dann darin die dunklen Pixel suchen, mit der abgetasteten
   Materialfarbe füllen und weichzeichnen.
3. Bei heller Ware die Wunschfarbe per Multiply auflegen und die Alphamaske
   wieder aufsetzen. Dunkle Ware wird nicht eingefärbt.
4. Logo und Firmenname als eine Ebene aufbauen und auf die Silhouette beschneiden.
   Auf dunklem Grund steht das Logo als weiße Silhouette.
5. Die Materialstruktur durch diese Ebene zurückholen — bei heller Ware per Multiply
   mit 50 % Deckkraft, bei dunkler per Soft-Light mit 30 %. Erst das lässt das Motiv
   eingestrickt statt aufgeklebt wirken.

Rate-Limit: 120 Anfragen pro IP und Stunde. Alle vier Produkte zusammen rendern
lokal in rund 300 ms.

## Design

Die Oberflaeche uebernimmt den Konfigurator-Block der B2B-Landingpage — bis hin zu den
Klassennamen (`b2b-konfig__*`), damit App und Theme-Section nicht auseinanderlaufen.

Die Werte in `app/globals.css` sind **gemessen**, nicht geschaetzt: ausgelesen an
`.color-scheme` und `:root` der laufenden Theme-Vorschau
(`/pages/personalisierte-socken-mit-logo?view=b2b-2026`). Farben stehen dort als
Kanaltripel (`28 28 28`) und werden als `rgb(var(--x))` benutzt — wer sie als
`var(--x, #fff)` schreibt, bekommt Transparenz. Wer etwas aendert, misst vorher neu.

Die Schrift ist basic-sans aus dem Typekit-Kit `wdu6knh`, dasselbe Kit, das der Shop
laedt (`app/layout.tsx`). **Adobe gibt Kits nur auf freigeschalteten Domains aus:** die
Vercel-Adresse muss in Adobe Fonts ergaenzt werden, sonst greift der Fallback-Stack.

Zwei bewusste Abweichungen vom Shop-Block:

- Die Kacheln sind quadratisch statt 4:3. Im Shop stehen dort beschnittene Fotos, hier
  freigestellte Hochformate — bei 4:3 mit `contain` schrumpft der Socken auf gut die
  halbe Kachelbreite.
- Die Kacheln verlinken (noch) nicht auf die Produktseiten. Im eingebetteten Zustand
  muesste der Link aus dem iframe ausbrechen; das gehoert zu Phase 5.

## Produktkatalog

`lib/products.ts`. Preise stammen aus `OCCULTO_PREISLISTE_Socken.pdf` (Kundenpreise
2026, kein Großhandel), Mindestmenge und Lieferzeit aus den Angaben im Shop.

**Die Mindestmenge von 100 gilt pro Größe, nicht pro Bestellung.** Wer drei Größen
bestellt, braucht 300 Paar. Die Mengenabfrage im Anfrageformular muss das abbilden.

`priceFrom: null` bedeutet „auf Anfrage" — aktuell bei der Sneakersocke.

Neue Produkte brauchen ein Foto unter `public/products/` sowie die relative Geometrie
für Logo-Platzierung und Schriftzug.

### Offene Zuordnung

Der Konfigurator kennt vier Vorlagen, die Preisliste vier Kategorien. Zwei
Zuordnungen sind gesetzt, aber nicht bestätigt:

| Vorlage | angesetzt | Grundlage |
| --- | --- | --- |
| Kniestrumpf | 1,69 € (Casual) | Zuordnung aus `UMBAU-PLAN.md` |
| Sneakersocke | auf Anfrage | Angabe des Shop-Produkts `sneakersocken` |

Der Umbauplan ordnet beide „Casual Socken" zu, das Shop-Produkt Sneakersocken sagt
dagegen „auf Anfrage". Bitte einmal klären.

## Hinweise zum Deployment

- `sharp` steht in `serverExternalPackages`, damit das native Modul nicht gebündelt wird.
- Die Produktfotos werden über `outputFileTracingIncludes` ins Funktionspaket gezogen,
  weil `/api/render` sie vom Dateisystem liest.
- Ohne Upstash laufen Cache und Rate-Limit prozesslokal: funktionsfähig, aber pro
  Instanz gezählt und ohne Bestand über Kaltstarts hinweg.
- Der eingewebte Firmenname wird als SVG-Text gerendert. Fehlt auf dem Host eine
  passende Schrift, bleibt das Mockup ohne Schriftzug — das Logo kommt trotzdem.
