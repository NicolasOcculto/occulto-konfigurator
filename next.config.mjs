/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // sharp ist ein natives Modul: nicht bundeln, sondern zur Laufzeit aufloesen.
  serverExternalPackages: ['sharp'],

  // /api/render liest die Produktfotos vom Dateisystem. Ohne diesen Eintrag landen
  // sie nicht im Funktionspaket, weil die Tracing-Analyse den Pfad nicht sieht.
  outputFileTracingIncludes: {
    '/api/render': ['./public/products/**'],
  },
};

export default nextConfig;
