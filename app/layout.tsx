import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Occulto — Dein Logo auf echten Socken',
  description:
    'Firmendomain eingeben und das eigene Logo sofort auf Socken, Sneakersocken, Tennissocken und Muetzen sehen.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        {/*
          Dasselbe Typekit-Kit, das der Shop laedt — daher liefert es basic-sans,
          die Schrift der B2B-Seite. Adobe gibt Kits nur auf freigeschalteten
          Domains aus: die spaetere Vercel-Adresse muss in Adobe Fonts ergaenzt
          werden, sonst greift der Fallback-Stack aus globals.css.
        */}
        <link rel="stylesheet" href="https://use.typekit.net/wdu6knh.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
