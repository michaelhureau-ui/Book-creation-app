export type ChapterKind = 'chapter' | 'front' | 'back'

export interface Chapter {
  id: string
  /** 'front' = preface/foreword (unnumbered), 'chapter' = numbered body, 'back' = appendix/afterword. */
  kind: ChapterKind
  title: string
  /** TipTap HTML. */
  content: string
  createdAt: number
  updatedAt: number
}

export type CoverPalette = 'sepia' | 'ink' | 'forest' | 'plum' | 'cobalt' | 'ember'
export type CoverLayout = 'classic' | 'band' | 'minimal'

export interface Cover {
  palette: CoverPalette
  layout: CoverLayout
}

/** A book is either prose (chapters of text) or a graphic novel (drawn pages). */
export type BookKind = 'prose' | 'graphic'

export type BalloonKind = 'speech' | 'thought' | 'caption' | 'shout' | 'sfx'

export interface Balloon {
  id: string
  kind: BalloonKind
  text: string
  /** Position and width as a fraction (0–1) of the panel it sits in. */
  x: number
  y: number
  width: number
  /** Where the tail points, in the same panel-relative fraction. */
  tailX: number
  tailY: number
}

export interface Panel {
  id: string
  /** Key into the asset store, or null while the panel is still empty. */
  assetId: string | null
  /** Framing of the artwork: 1 = fit the frame, higher crops in. */
  zoom: number
  /** Pan within the frame, -1 to 1, 0 being centred. */
  offsetX: number
  offsetY: number
  balloons: Balloon[]
}

export interface Page {
  id: string
  title: string
  layout: PageLayoutId
  panels: Panel[]
}

export type PageLayoutId =
  | 'splash' | 'two-rows' | 'three-rows' | 'three-columns'
  | 'four-grid' | 'six-grid' | 'hero-two' | 'two-hero'

export interface Book {
  id: string
  kind: BookKind
  title: string
  subtitle: string
  author: string
  /** Back-cover blurb / description. */
  description: string
  language: string
  cover: Cover
  /** Used when kind is 'prose'. */
  chapters: Chapter[]
  /** Used when kind is 'graphic'. */
  pages: Page[]
  createdAt: number
  updatedAt: number
}

export interface BookStats {
  words: number
  characters: number
  /** Minutes, at 230 wpm. */
  readingMinutes: number
  chapters: number
  /** Graphic novels only. */
  pages: number
  panels: number
  artworkPlaced: number
}
