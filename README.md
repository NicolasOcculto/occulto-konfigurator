# Occulto Merch-Konfigurator

> Betrieb, Konten und Wartung: siehe `UEBERGABE.md` und `ANLEITUNG-ONLINE.md`
> im Theme-Repository.

Next.js 16 (App Router), betrieben bei Netlify. Der Besucher gibt eine Firmendomain ein, der Server
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

Abweichungen vom Shop-Block:

- Statt vier gleich grosser Kacheln steht ein grosses Bild in der Mitte, daneben alle
  vier Vorlagen zum Durchklicken. Klick auf das grosse Bild vergroessert um den
  Zeigerpunkt herum. Der Zoom laeuft ueber `transform` mit `transform-origin` auf der
  Zeigerposition: so bleibt der Punkt unter dem Cursor stehen, und zwar auch bei
  `object-fit: contain`, wo eine Rechnung mit `background-position` erst die Randbox
  des Bildes ermitteln muesste. Ausgeloest per Klick, nicht nur per Hover — sonst
  gaebe es auf dem Telefon keine Lupe.
- Die Bildflaechen sind quadratisch und hellgrau hinterlegt. Weisse Ware auf reinem
  Weiss hat keine Kante mehr.
- Die Bilder verlinken (noch) nicht auf die Produktseiten. Im eingebetteten Zustand
  muesste der Link aus dem iframe ausbrechen.

## Einbettung in die Landingpage

`?eingebettet=1` nimmt Aussenabstand und Breitenbegrenzung weg und macht aus der h1
eine h2. Die Ueberschrift bringt die App mit, obwohl sie im iframe weder in der
Gliederung der Seite noch bei Google auftaucht: nur so stehen Text und Produktbild im
selben Raster und lassen sich auf einer Hoehe zentrieren.

Zwei Nachrichten gehen per `postMessage` an die einbettende Seite, beide ohne
Nutzerinhalt:

| `was` | Zweck |
| --- | --- |
| `hoehe` | Aktuelle Dokumenthoehe, per ResizeObserver. Der Rahmen waechst mit, statt intern zu scrollen. |
| `anfrage` | Klick auf „Jetzt anfragen". Die Seite springt zu `#b2b-anfrage`. |

Gesendet wird an `'*'`; die Gegenseite prueft `event.origin`, bevor sie reagiert.
Der Gegenpart steht im Theme in `templates/page.b2b-2026.json`, Section `konfigurator`.
**Die Adresse steht dort an zwei Stellen** — im `src` des iframes und in `HERKUNFT`
im Skript. Nach dem Deployment beide aendern, sonst bleibt die Hoehe auf dem Startwert
und der Knopf tut nichts.

Der Sprung laeuft ueber `location.hash`, nicht ueber `scrollIntoView` mit
`behavior: 'smooth'`: das Theme setzt `body { overflow: hidden }`, sanftes Scrollen
bleibt dort wirkungslos — nachgemessen landete es bei 0 statt bei 2230.

## Anfrageformular

`/anfrage`, drei Schritte: Produkt (mit „Weiß ich noch nicht"), Design und Menge,
Kontaktdaten. `?eingebettet=1` verhält sich wie beim Konfigurator.

**Übernahme aus dem Konfigurator.** Beide hängen als eigene iframes in derselben
Seite, sind also getrennte Dokumente ohne gemeinsamen React-Zustand — aber auf
derselben Herkunft. `lib/markenkanal.ts` verbindet sie über einen
`BroadcastChannel`.

Nicht einfach senden, sondern fragen und antworten: Das Formular steht weiter
unten und lädt später (`loading="lazy"`). Ein einmal gesendetes Ereignis wäre da
längst verpufft. Also fragt das Formular beim Aufwachen nach, und der
Konfigurator antwortet — falls er überhaupt etwas weiß. Weiß er nichts, kommt
keine Antwort und das Formular bleibt leer.

Übernommen werden Firma, Logo und das zuletzt angesehene Produkt, und nur in
Felder, die noch leer sind. Kein `sessionStorage`: das Logo ist eine `data:`-URI
von bis zu 4 MB und sprengt die Ablage.

Browser partitionieren `BroadcastChannel` nach der Seite ganz oben. Zwei iframes
derselben Landingpage teilen sich also den Kanal, ein separater Tab mit der App
nicht — genau richtig.

### `/api/anfrage`

`POST` mit Produkt, Menge, Logo als `data:`-URI, Kontaktdaten. Serverseitig
geprüft: Pflichtfelder, Mailformat, bekannter Produktschlüssel, erlaubte
Stückzahl, Logotyp (PNG, JPG, SVG) und Größe bis 5 MB. Steuerzeichen fliegen aus
allen Feldern, Nutzertext wird für die HTML-Mail maskiert.

Versand über Resend, Logo als Anhang, Betreff mit Firmenname, `reply_to` auf die
Adresse des Absenders. Rate-Limit: 10 Anfragen pro IP und Stunde.

**Ohne `RESEND_API_KEY` antwortet die Route mit 503**, und das Formular zeigt die
Mailadresse als Rückfallweg. Absichtlich: lieber ehrlich scheitern, als so zu
tun, als sei die Anfrage unterwegs.

### Erfolg

Die App meldet `{typ:'occulto-anfrage', was:'gesendet'}`, und die **Seite**
navigiert auf `/pages/b2b-anfrage-gesendet` — nicht der iframe. `b2b_anfrage_success`
hängt am Seitenaufruf der Danke-Seite; navigiert nur der Rahmen, feuert nichts.

## Produktkatalog

`lib/products.ts`. Preise stammen aus `OCCULTO_PREISLISTE_Socken.pdf` (Kundenpreise
2026, kein Großhandel), Mindestmenge und Lieferzeit aus den Angaben im Shop.

**Die Mindestmenge von 100 gilt pro Größe, nicht pro Bestellung.** Wer drei Größen
bestellt, braucht 300 Paar. Die Mengenabfrage im Anfrageformular muss das abbilden.

`priceFrom: null` bedeutet „auf Anfrage" — aktuell bei der Sneakersocke.

Neue Produkte brauchen ein Foto unter `public/products/` sowie die relative Geometrie
für Logo-Platzierung und Schriftzug. Optional dazu:

- `band`: Von-bis in Anteilen der Bildhoehe. Nur dieser Streifen am Bund nimmt die
  Wunschfarbe an, der Rest bleibt in der Grundfarbe — so wie bei echter Ware. Ohne
  Angabe wird das ganze Produkt eingefaerbt. Die Werte am Silhouettenprofil des Fotos
  messen, nicht schaetzen.
- `logoOnLabel`: Das Logo sitzt auf der eingewebten Marke statt frei auf der Ware.
  Ort und Groesse kommen dann aus dem ausgemessenen Aufdruck, das Motiv steht dunkel
  auf hellem Grund, und der Firmenname entfaellt — beides passt nicht in ein Label.
  Gilt nur fuer ungedrehte Labels (`name.a === 0`).

### Offene Zuordnung

Der Konfigurator kennt vier Vorlagen, die Preisliste vier Kategorien. Zwei
Zuordnungen sind gesetzt, aber nicht bestätigt:

| Vorlage | angesetzt | Grundlage |
| --- | --- | --- |
| Skisocke | 1,69 € (Casual) | Zuordnung aus `UMBAU-PLAN.md` |
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
