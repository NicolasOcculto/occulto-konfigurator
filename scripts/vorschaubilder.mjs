/**
 * Schneidet die Produktfotos auf die Ware zu und legt sie unter
 * public/products/vorschau/ ab.
 *
 * Grund: die Originale zeigen weisse Socken mit viel weissem Rand. In einer
 * kleinen Auswahlkachel bleibt davon ein blasser Strich uebrig - die Socke
 * belegt je nach Motiv nur 20 bis 40 Prozent der Bildbreite. Zugeschnitten
 * fuellt sie die Kachel.
 *
 * Aufruf: node scripts/vorschaubilder.mjs
 * Nur noetig, wenn ein Produktfoto dazukommt oder ausgetauscht wird.
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const QUELLE = 'public/products';
const ZIEL = 'public/products/vorschau';

/** Rand um die Ware, in Anteilen der gefundenen Ausdehnung. */
const LUFT = 0.06;
/** Kantenlaenge der quadratischen Vorschau. */
const KANTE = 480;

/** Bildpunkt gehoert zur Ware, wenn er weder durchsichtig noch fast weiss ist. */
function istWare(data, o) {
  if (data[o + 3] < 40) return false;
  return Math.min(data[o], data[o + 1], data[o + 2]) < 236;
}

async function zuschneiden(datei) {
  const pfad = path.join(QUELLE, datei);
  const { data, info } = await sharp(pfad).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;

  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!istWare(data, (y * w + x) * 4)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) throw new Error(`${datei}: keine Ware gefunden`);

  // Quadratisch um die Mitte der Ware, damit nichts verzerrt und die Kachel
  // ohne weitere Rechnerei quadratisch bleibt.
  const breite = maxX - minX;
  const hoehe = maxY - minY;
  const seite = Math.round(Math.max(breite, hoehe) * (1 + LUFT * 2));
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;

  // extend statt clamp: laeuft das Quadrat ueber den Bildrand, wird mit Weiss
  // aufgefuellt, statt die Ware aus der Mitte zu schieben.
  const links = Math.round(mx - seite / 2);
  const oben = Math.round(my - seite / 2);

  const rand = {
    top: Math.max(0, -oben),
    left: Math.max(0, -links),
    bottom: Math.max(0, oben + seite - h),
    right: Math.max(0, links + seite - w),
  };

  // Nicht freistellen: die Produktfotos bringen den transparenten Hintergrund
  // schon mit. Ein Flood-Fill ueber Helligkeit wuerde hier die Ware selbst
  // treffen - der Socken liegt bei 234 bis 241, also im selben Bereich wie
  // ein weisser Grund. Nachgemessen an tennis.webp und skisocke.webp.
  const gross = await sharp(pfad)
    .ensureAlpha()
    .extend({ ...rand, background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .toBuffer();

  const bild = await sharp(gross)
    .extract({
      left: links + rand.left,
      top: oben + rand.top,
      width: seite,
      height: seite,
    })
    .resize(KANTE, KANTE, { fit: 'fill' })
    .webp({ quality: 90 })
    .toBuffer();

  const name = datei.replace(/\.[^.]+$/, '.webp');
  await writeFile(path.join(ZIEL, name), bild);
  const anteil = ((breite / w) * 100).toFixed(0);
  console.log(`${datei} -> vorschau/${name}  (Ware belegte ${anteil} % der Breite)`);
}

await mkdir(ZIEL, { recursive: true });
const dateien = (await readdir(QUELLE)).filter((f) => /\.(webp|png|jpe?g)$/i.test(f));
for (const f of dateien) await zuschneiden(f);
