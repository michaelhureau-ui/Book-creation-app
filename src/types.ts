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

export interface Book {
  id: string
  title: string
  subtitle: string
  author: string
  /** Back-cover blurb / description. */
  description: string
  language: string
  cover: Cover
  chapters: Chapter[]
  createdAt: number
  updatedAt: number
}

export interface BookStats {
  words: number
  characters: number
  /** Minutes, at 230 wpm. */
  readingMinutes: number
  chapters: number
}
