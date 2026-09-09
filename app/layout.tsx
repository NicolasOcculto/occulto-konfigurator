import type { Metadata } from 'next';
import { Instrument_Sans } from 'next/font/google';
import './globals.css';

const sans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Occulto — Dein Logo auf echten Socken',
  description:
    'Firmendomain eingeben und das eigene Logo sofort auf Socken, Sneakersocken, Tennissocken und Muetzen sehen.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
