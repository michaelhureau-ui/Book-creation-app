import type { Book, BookStats, Chapter } from '@/types'
import { blocksText, parseBlocks } from '@/lib/blocks'

const WORDS_PER_MINUTE = 230

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/** Every page of a chapter, flattened — page breaks read as paragraph breaks. */
export function chapterText(chapter: Chapter): string {
  return chapter.pages.map((page) => blocksText(parseBlocks(page.content))).join('\n\n').trim()
}

export function chapterWords(chapter: Chapter): number {
  return countWords(chapterText(chapter))
}

export function bookStats(book: Book): BookStats {
  let words = 0
  let characters = 0
  for (const chapter of book.chapters) {
    const text = chapterText(chapter)
    words += countWords(text)
    characters += text.length
  }

  let panels = 0
  let artworkPlaced = 0
  for (const page of book.pages) {
    for (const panel of page.panels) {
      panels++
      if (panel.assetId) artworkPlaced++
      // Lettering counts toward the word total: it is the script of the book.
      for (const balloon of panel.balloons) {
        words += countWords(balloon.text)
        characters += balloon.text.length
      }
    }
  }

  return {
    words,
    characters,
    readingMinutes: Math.max(words > 0 ? 1 : 0, Math.round(words / WORDS_PER_MINUTE)),
    chapters: book.chapters.filter((c) => c.kind === 'chapter').length,
    // A novel counts its written pages; a graphic novel counts its drawn ones.
    // A graphic novel's chapters carry an unused body page each, so summing
    // both would report more pages than the book has.
    pages: book.kind === 'graphic'
      ? book.pages.length
      : book.chapters.reduce((n, c) => n + c.pages.length, 0),
    panels,
    artworkPlaced,
  }
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

export function formatReadingTime(minutes: number): string {
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} hr ${m} min` : `${h} hr`
}

/** "about 45 min of reading" — but never "about under a minute of reading". */
export function readingSummary(minutes: number): string {
  const time = formatReadingTime(minutes)
  return minutes < 1 ? `${time} of reading` : `about ${time} of reading`
}
