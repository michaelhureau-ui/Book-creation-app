import type { Block, Run } from '@/lib/blocks'
import { parseBlocks } from '@/lib/blocks'
import type { Book } from '@/types'
import { bookAuthor, bookTitle, chapterNumbers } from '@/lib/book'

function escapeMd(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1')
}

function runToMd(run: Run): string {
  if (run.code) return `\`${run.text}\``
  let out = escapeMd(run.text)
  if (run.bold) out = `**${out}**`
  if (run.italic) out = `*${out}*`
  if (run.strike) out = `~~${out}~~`
  // Markdown has no underline; HTML inline is the portable fallback.
  if (run.underline) out = `<u>${out}</u>`
  return out
}

function runsToMd(runs: Run[]): string {
  return runs.map(runToMd).join('').replace(/\n/g, '  \n')
}

function blockToMd(block: Block): string {
  switch (block.type) {
    case 'heading': return `${'#'.repeat(block.level + 1)} ${runsToMd(block.runs)}`
    case 'quote': return runsToMd(block.runs).split('\n').map((l) => `> ${l}`).join('\n')
    case 'code': return '```\n' + block.text + '\n```'
    case 'rule': return '---'
    case 'list':
      return block.items
        .map((item, i) => `${block.ordered ? `${i + 1}.` : '-'} ${runsToMd(item)}`)
        .join('\n')
    default: return runsToMd(block.runs)
  }
}

export function buildMarkdown(book: Book): string {
  const numbers = chapterNumbers(book.chapters)
  const parts: string[] = [`# ${bookTitle(book)}`]
  if (book.subtitle.trim()) parts.push(`## ${book.subtitle.trim()}`)
  parts.push(`*by ${bookAuthor(book)}*`)
  if (book.description.trim()) parts.push(book.description.trim())

  for (const chapter of book.chapters) {
    const n = numbers.get(chapter.id)
    const heading = chapter.kind === 'chapter' && n
      ? `Chapter ${n}. ${chapter.title || 'Untitled'}`
      : chapter.title || 'Untitled'
    parts.push(`\n## ${heading}`)
    const blocks = parseBlocks(chapter.content).map(blockToMd).filter(Boolean)
    parts.push(blocks.length ? blocks.join('\n\n') : '*This chapter is empty.*')
  }
  return parts.join('\n\n') + '\n'
}
