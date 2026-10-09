import type { TrimId } from '@/lib/graphic/render'

/** Kept free of jsPDF/JSZip imports so the export dialog can read them cheaply. */
export interface ComicOptions {
  trim: TrimId
  /** Render resolution. 150 is screen-sharp; 300 is print. */
  dpi: number
  includeTitlePage: boolean
  borders: boolean
  /**
   * Print-ready: the page carries an eighth of an inch of artwork past the cut
   * line, with crop marks showing where that cut goes. A printer needs it; a
   * tablet does not, and it would only show as a border there.
   */
  printReady: boolean
}

export const DEFAULT_COMIC_OPTIONS: ComicOptions = {
  trim: 'comic',
  dpi: 200,
  includeTitlePage: true,
  borders: true,
  printReady: false,
}

export const DPI_CHOICES = [
  { value: 150, label: '150 dpi — screen' },
  { value: 200, label: '200 dpi — good print' },
  { value: 300, label: '300 dpi — press ready' },
]
