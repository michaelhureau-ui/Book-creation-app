# Bookwright

A standalone app for writing books and publishing them as real files — PDF, Word,
EPUB, or Markdown.

It lives in this repository but is entirely self-contained: it does not import
from Voloboard, share its build, or use its auth, database, or navigation. Every
book is stored locally in the browser (IndexedDB); there is no server and no
account.

```bash
cd bookwright
npm install
npm run dev        # http://localhost:5180
```

## What it does

**Write.** A book is a list of chapters you write in a rich-text editor — bold,
italic, underline, strikethrough, three heading levels, block quotes, bulleted
and numbered lists, and scene breaks. Chapters can be renamed, reordered, and
split into front matter (a preface), body chapters, and back matter (an
appendix). Only body chapters are numbered, the way a printed book does it.
Everything autosaves.

**See it as a book.** Preview shows the jacket, title page, table of contents,
and every chapter typeset as pages. The jacket itself is generated from a
palette and a layout, so a book always has a presentable cover without you
sourcing artwork.

**Publish.** Five export formats, each built from the same parsed document:

| Format | What you get |
| --- | --- |
| **PDF** | Typeset for print: title page, contents with dot leaders and real page numbers, chapters opening on fresh pages, justified body text, running heads and folios. Choose 6×9 in, A5, or US Letter, and the body text size. |
| **Word** | A `.docx` with genuine heading styles and page breaks between chapters — editable in Word, Pages, or Google Docs. |
| **EPUB** | A valid EPUB 3 package with navigation, metadata, and a stylesheet, for Kindle, Apple Books, or Kobo. |
| **Markdown** | Plain text with formatting preserved and punctuation escaped. |
| **Backup** | The whole project as JSON, re-importable from the library screen. |

Keyboard: `⌘/Ctrl+P` previews, `⌘/Ctrl+E` exports.

## How it fits together

```
src/
├── lib/
│   ├── blocks.ts        HTML → structured blocks (the shared document model)
│   ├── book.ts          ids, chapter numbering, reordering, slugs
│   ├── db.ts            IndexedDB persistence
│   ├── store.ts         Zustand state + debounced autosave
│   ├── stats.ts         word counts and reading time
│   ├── cover.ts         jacket palettes and layouts
│   └── export/          markdown · docx · epub · pdf (+ shared options)
└── components/          Library, Workspace, Editor, ChapterList, Preview, dialogs
```

The editor stores chapter bodies as TipTap HTML. Rather than have four
exporters each re-interpret markup, `blocks.ts` parses that HTML once into a
small block model — headings, paragraphs, quotes, lists, code, rules, and
formatted runs — and every writer renders from it. The on-screen preview renders
from the same model, so what you see matches what gets exported, and an imported
project file never reaches the DOM as markup.

The PDF writer is the one non-obvious piece. jsPDF draws a single font at a
time, so mixed-format text is laid out by hand: each word is measured in its own
style, wrapped greedily into lines, and justified by distributing the leftover
width across the spaces. The table of contents needs page numbers that only
exist after layout, so the book is rendered twice — the first pass discovers
where each chapter lands, the second prints those numbers. Front matter is a
fixed length, which is what makes the two passes agree.

Exporters are loaded on demand: jsPDF and docx together outweigh the rest of the
app, and most sessions are spent writing rather than exporting.

## Checks

```bash
npm test          # unit tests (vitest)
npm run lint
npm run typecheck
npm run build
```

The unit tests cover the parts worth pinning down — the HTML parser, chapter
numbering, word counts, Markdown generation, and backup import validation.
