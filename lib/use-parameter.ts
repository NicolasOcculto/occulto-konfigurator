'use client';

import { useEffect, useState } from 'react';

/**
 * Parameter, die die Landingpage an den iframe haengt - im Browser gelesen.
 *
 * Warum nicht auf dem Server: Liest eine Seite ihre searchParams, rendert
 * Next sie bei jedem Aufruf neu. Bei Netlify hiess das eine Serverfunktion
 * pro Besucher, kalt bis zu vier Sekunden - so lange stand auf der
 * Landingpage eine weisse Flaeche. Ohne searchParams wird die Seite beim Bau
 * fertig erzeugt und kommt aus dem Cache.
 *
 * Die Parameter steuern nur Links (Produktseite, Datenschutz). Dass sie erst
 * nach dem ersten Zeichnen greifen, merkt niemand.
 */
export function useParameter(name: string, pruefen: (wert: string) => boolean, start: string): string {
  const [wert, setWert] = useState(start);
  useEffect(() => {
    const roh = new URLSearchParams(window.location.search).get(name);
    if (roh && pruefen(roh)) setWert(roh);
  }, [name, pruefen]);
  return wert;
}
