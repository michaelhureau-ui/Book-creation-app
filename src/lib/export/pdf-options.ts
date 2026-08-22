/**
 * Options live apart from the renderer so the export dialog can read them
 * without pulling jsPDF into the initial bundle — the PDF writer is loaded
 * only when someone actually exports one.
 */
export type TrimSize = '6x9' | 'a5' | 'letter'

export interface PdfOptions {
  trim: TrimSize
  /** Body text size in points. */
  fontSize: number
  includeTitlePage: boolean
  includeToc: boolean
  includePageNumbers: boolean
}

export const DEFAULT_PDF_OPTIONS: PdfOptions = {
  trim: '6x9',
  fontSize: 11,
  includeTitlePage: true,
  includeToc: true,
  includePageNumbers: true,
}

/** Page size in points. */
export const TRIM: Record<TrimSize, [number, number]> = {
  '6x9': [432, 648],
  a5: [420, 595],
  letter: [612, 792],
}

export const TRIM_LABELS: Record<TrimSize, string> = {
  '6x9': '6 × 9 in (trade paperback)',
  a5: 'A5 (148 × 210 mm)',
  letter: '8.5 × 11 in (US Letter)',
}
