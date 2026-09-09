export type CandidateSource =
  | 'og:image'
  | 'twitter:image'
  | 'json-ld'
  | 'link:icon'
  | 'link:apple-touch-icon'
  | 'link:mask-icon'
  | 'svg:inline'
  | 'img:header'
  | 'img:page'
  | 'css:background'
  | 'favicon.ico'
  | 'logo.dev'
  | 'brandfetch';

export type LogoCandidate = {
  /** Absolute URL oder data:-URI */
  url: string;
  source: CandidateSource;
  /** Reihenfolge im Dokument - frueh heisst in der Regel Kopfbereich. */
  documentIndex: number;
  /** Aus dem Markup angekuendigte Groesse (width/height/sizes), falls vorhanden. */
  declaredWidth?: number;
  declaredHeight?: number;
  /** Text aus alt, class, id oder Dateiname - Hinweis auf ein Logo. */
  hint?: string;
  /** Lag das Element in header, nav oder im obersten Seitenbereich? */
  inHeader: boolean;
};

export type ResolvedLogo = {
  url: string;
  source: CandidateSource;
  width: number;
  height: number;
  format: string;
  /** data:-URI des Bildes, direkt an /api/render weiterreichbar. */
  dataUri: string;
  score: number;
};

export type BrandColor = {
  hex: string;
  /** Wie oft die Farbe im CSS auftauchte, gewichtet nach Fundstelle. */
  weight: number;
};

export type BrandResult = {
  domain: string;
  /** Endgueltige URL nach Weiterleitungen. */
  siteUrl: string | null;
  title: string | null;
  company: string | null;
  logo: ResolvedLogo | null;
  colors: BrandColor[];
  /** Woher das Logo letztlich kam - fuer Diagnose im Frontend. */
  strategy: 'extracted' | 'logo.dev' | 'brandfetch' | 'none';
  cached: boolean;
  /** Nicht fatale Hinweise, z. B. dass eine Rueckfallebene nicht konfiguriert ist. */
  notes: string[];
};
