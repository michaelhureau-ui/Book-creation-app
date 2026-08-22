import type { Book, BookStats, Chapter } from '@/types'
import { blocksText, parseBlocks } from '@/lib/blocks'

const WORDS_PER_MINUTE = 230

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

export function chapterText(chapter: Chapter): string {
  return blocksText(parseBlocks(chapter.content))
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
  return {
    words,
    characters,
    readingMinutes: Math.max(words > 0 ? 1 : 0, Math.round(words / WORDS_PER_MINUTE)),
    chapters: book.chapters.filter((c) => c.kind === 'chapter').length,
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
