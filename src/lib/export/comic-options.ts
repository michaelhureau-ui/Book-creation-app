import type { TrimId } from '@/lib/graphic/render'

/** Kept free of jsPDF/JSZip imports so the export dialog can read them cheaply. */
export interface ComicOptions {
  trim: TrimId
  /** Render resolution. 150 is screen-sharp; 300 is print. */
  dpi: number
  includeTitlePage: boolean
  borders: boolean
}

export const DEFAULT_COMIC_OPTIONS: ComicOptions = {
  trim: 'comic',
  dpi: 200,
  includeTitlePage: true,
  borders: true,
}

export const DPI_CHOICES = [
  { value: 150, label: '150 dpi — screen' },
  { value: 200, label: '200 dpi — good print' },
  { value: 300, label: '300 dpi — press ready' },
]
