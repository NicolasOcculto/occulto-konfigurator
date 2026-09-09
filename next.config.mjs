/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Die runde Schaltflaeche unten links ist Nexts Entwicklungsanzeige. Im
  // eingebetteten iframe schwebt sie mitten in der Landingpage - weg damit.
  devIndicators: false,

  // Im Entwicklungsmodus blockiert Next seine eigenen Ressourcen, wenn die Seite
  // nicht ueber localhost geoeffnet wird. Ohne diesen Eintrag scheitert unter
  // http://127.0.0.1:3000 die Hydrierung: das Formular faellt dann auf natives
  // Absenden zurueck und laedt die Seite neu, statt das Logo zu holen.
  allowedDevOrigins: ['127.0.0.1'],

  // sharp ist ein natives Modul: nicht bundeln, sondern zur Laufzeit aufloesen.
  serverExternalPackages: ['sharp'],

  // /api/render liest die Produktfotos vom Dateisystem. Ohne diesen Eintrag landen
  // sie nicht im Funktionspaket, weil die Tracing-Analyse den Pfad nicht sieht.
  outputFileTracingIncludes: {
    '/api/render': ['./public/products/**'],
  },
};

export default nextConfig;
