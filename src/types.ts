export type ChapterKind = 'chapter' | 'front' | 'back'

/**
 * A chapter is written as one or more pages. Each page holds its own body and
 * starts a fresh printed page on export, which is how a writer decides where
 * the breaks fall rather than leaving it to the typesetter.
 */
export interface ProsePage {
  id: string
  /** TipTap HTML. */
  content: string
}

export interface Chapter {
  id: string
  /** 'front' = preface/foreword (unnumbered), 'chapter' = numbered body, 'back' = appendix/afterword. */
  kind: ChapterKind
  title: string
  /** Never empty: a chapter always has at least one page. */
  pages: ProsePage[]
  /**
   * Books written before chapters had pages stored one body here. It is read
   * once, folded into `pages`, and never written again.
   * @deprecated
   */
  content?: string
  createdAt: number
  updatedAt: number
}

export type CoverPalette = 'sepia' | 'ink' | 'forest' | 'plum' | 'cobalt' | 'ember'
export type CoverLayout = 'classic' | 'band' | 'minimal'

export interface Cover {
  palette: CoverPalette
  layout: CoverLayout
  /**
   * A picture for the jacket, as an asset id — drawn by the app or brought in
   * from a file. Without one the cover is the palette and the lettering, which
   * is what every book here started as.
   */
  art?: string
  /** What the picture was asked for, so it can be changed and drawn again. */
  artBrief?: string
  /**
   * How the lettering sits on the picture. 'full' prints the title over the
   * artwork behind a scrim; 'window' insets the picture and leaves the title
   * on the plain cover above it, the way most children's books do it.
   */
  artFit?: 'full' | 'window'
}

/** A book is either prose (chapters of text) or a graphic novel (drawn pages). */
export type BookKind = 'prose' | 'graphic'

export type BalloonKind = 'speech' | 'thought' | 'caption' | 'shout' | 'sfx'

export interface Balloon {
  id: string
  kind: BalloonKind
  text: string
  /** Who says it, where that is known — printed in the exported script. */
  speaker?: string
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
  /**
   * What this panel shows, in words — the drawing brief. A generated story
   * fills it in, the picture-maker starts from it, and the exported script
   * prints it where the artwork is still to come. Absent on panels made
   * before there was anywhere to write it down.
   */
  note?: string
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
  /**
   * The chapter this page is filed under, or null while it is loose. Pages are
   * stored in reading order and always grouped by chapter, so this and the
   * order in `Book.pages` never disagree.
   */
  chapterId: string | null
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
  /** Prose bodies. A graphic novel uses these too, as headings over its pages. */
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
  /** Drawn pages in a graphic novel, written pages in a novel. */
  pages: number
  panels: number
  artworkPlaced: number
}
