import {
  AlignmentType, Document, HeadingLevel, PageBreak, Packer, Paragraph, TextRun,
} from 'docx'
import type { Block, Run } from '@/lib/blocks'
import { parseBlocks } from '@/lib/blocks'
import type { Book } from '@/types'
import { bookAuthor, bookTitle, chapterNumbers } from '@/lib/book'

function toTextRuns(runs: Run[], extra: { italics?: boolean; size?: number; color?: string } = {}): TextRun[] {
  return runs.map((r) =>
    new TextRun({
      text: r.text,
      bold: r.bold,
      italics: r.italic || extra.italics,
      underline: r.underline ? {} : undefined,
      strike: r.strike,
      font: r.code ? 'Consolas' : undefined,
      size: extra.size,
      color: extra.color,
    }),
  )
}

function blockToParagraphs(block: Block): Paragraph[] {
  switch (block.type) {
    case 'heading':
      return [new Paragraph({
        heading: block.level === 1 ? HeadingLevel.HEADING_2
          : block.level === 2 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4,
        spacing: { before: 240, after: 120 },
        children: toTextRuns(block.runs),
      })]
    case 'quote':
      return [new Paragraph({
        indent: { left: 720 },
        spacing: { before: 120, after: 120 },
        children: toTextRuns(block.runs, { italics: true, color: '4A4640' }),
      })]
    case 'code':
      return block.text.split('\n').map((line) =>
        new Paragraph({
          shading: { fill: 'F3EFE7' },
          children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 20 })],
        }),
      )
    case 'rule':
      return [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 200 },
        children: [new TextRun({ text: '* * *' })],
      })]
    case 'list':
      return block.items.map((item, i) =>
        new Paragraph({
          indent: { left: 720, hanging: 260 },
          spacing: { after: 60 },
          children: [
            new TextRun({ text: block.ordered ? `${i + 1}.\t` : '•\t' }),
            ...toTextRuns(item),
          ],
        }),
      )
    default:
      return [new Paragraph({
        spacing: { after: 140, line: 300 },
        children: toTextRuns(block.runs),
      })]
  }
}

export async function buildDocx(book: Book): Promise<Blob> {
  const numbers = chapterNumbers(book.chapters)
  const children: Paragraph[] = []

  // Title page.
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 2400, after: 200 },
    children: [new TextRun({ text: bookTitle(book), bold: true, size: 56 })],
  }))
  if (book.subtitle.trim()) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: book.subtitle.trim(), size: 28, color: '4A4640' })],
    }))
  }
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: bookAuthor(book), size: 24, color: '4A4640' })],
  }))

  for (const chapter of book.chapters) {
    const n = numbers.get(chapter.id)
    children.push(new Paragraph({
      // Every chapter opens on a fresh page, as in a printed book.
      children: [new PageBreak()],
    }))
    if (chapter.kind === 'chapter' && n) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 600, after: 80 },
        children: [new TextRun({ text: `CHAPTER ${n}`, size: 20, color: '8B857C' })],
      }))
    }
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [new TextRun({ text: chapter.title || 'Untitled', bold: true, size: 36 })],
    }))
    const written = chapter.pages.map((prosePage) => parseBlocks(prosePage.content))
    if (written.every((blocks) => blocks.length === 0)) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'This chapter is empty.', italics: true, color: '8B857C' })],
      }))
    }
    written.forEach((blocks, i) => {
      // Each page the writer made opens a fresh sheet, as it does in the PDF.
      if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }))
      for (const block of blocks) children.push(...blockToParagraphs(block))
    })
  }

  const doc = new Document({
    creator: bookAuthor(book),
    title: bookTitle(book),
    description: book.description.trim() || undefined,
    styles: {
      default: {
        document: { run: { font: 'Georgia', size: 24 }, paragraph: { spacing: { line: 300 } } },
      },
    },
    sections: [{ properties: {}, children }],
  })
  return Packer.toBlob(doc)
}
