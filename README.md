# Bookwright

A standalone app for making books and publishing them as real files. Two kinds:
a **novel** — chapters of prose, exported as PDF, Word, EPUB, or Markdown — or a
**graphic novel** — pages of panels, artwork, and lettering, exported as a print
PDF, a CBZ comic archive, or a lettering script.

It lives in this repository but is entirely self-contained: it does not import
from Voloboard, share its build, or use its auth, database, or navigation. Every
book is stored locally in the browser (IndexedDB); there is no server and no
account.

**Live: <https://bookwright-gamma.vercel.app>**

```bash
cd bookwright
npm install
npm run dev        # http://localhost:5180
```

Deployed from this directory on Vercel (project `bookwright`, root directory
`bookwright`). The production branch is `main`; pushes to other branches get
their own preview URL.

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

## Graphic novels

Choosing **Graphic novel** when you start a book swaps the chapter editor for a
page-and-panel one.

**Lay out a page.** Eight layouts — splash, two or three rows, three columns,
four or six up, and a hero panel over or under a pair. Changing a page's layout
keeps the artwork already placed; only panels the new layout has no room for are
dropped, along with their images.

**Draw the panels.** Every panel opens a drawing board: brush, straight line,
flood fill, and eraser, with a palette plus a custom colour, six brush sizes,
undo/redo (`⌘Z` / `⇧⌘Z`), and clear. The sheet is shaped to the panel it belongs
to, so a drawing lands in its frame uncropped, and reopening loads what is
already there — so you can pick a drawing back up, or ink over a photo.

**Or bring in a picture.** A panel takes a photo or scan instead. Images are
downscaled on import (a phone photo is far larger than a panel needs) and
cover-fitted to the frame, with zoom and pan to choose the crop.

**Letter it.** Five kinds of balloon — speech, thought, caption, shout, and
sound effect — each drawn properly: a tapered tail off the balloon's own
outline, a scalloped cloud with a bubble trail for thoughts, a starburst for a
shout, and outlined display type for sound effects. Drag one handle to move a
balloon and another to aim its tail.

**Publish it.** A print **PDF** (each page rendered and embedded at your chosen
trim and resolution), a **CBZ** archive of page images with a `ComicInfo.xml`
sidecar that comic readers use for metadata, or a plain-text **script** listing
every page, panel, and line of lettering in order — the format a letterer or
collaborator expects. Trim sizes: 6.625 × 10.25 in, A4, or square; 150, 200, or
300 dpi.

Artwork is held in its own IndexedDB store rather than on the book record, so
autosaving a page never rewrites megabytes of images. Replacing or removing a
panel's artwork collects the image nothing references any more. A graphic
novel's JSON backup embeds its artwork as base64, so the file is portable on its
own.

## How it fits together

```
src/
├── lib/
│   ├── blocks.ts        HTML → structured blocks (the shared document model)
│   ├── book.ts          ids, chapter numbering, reordering, slugs
│   ├── db.ts            IndexedDB persistence (books + artwork assets)
│   ├── store.ts         Zustand state + debounced autosave
│   ├── stats.ts         word counts, reading time, panel counts
│   ├── cover.ts         jacket palettes and layouts
│   ├── graphic/         layouts · pages · assets · drawing · the page renderer
│   └── export/          markdown · docx · epub · pdf · comic (+ shared options)
└── components/
    ├── graphic/         PageCanvas, PageList, PanelInspector, DrawingBoard
    └── ...              Library, Workspace, Editor, ChapterList, Preview, dialogs
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

Comic pages take the same approach one level up. `graphic/render.ts` draws a
page to a canvas, and that single renderer backs the editor, the preview, and
both exports — the CBZ zips its output as page images, and the PDF embeds them.
So the preview of a comic page is not an approximation of the export; it is the
export. The editor draws through it too, with DOM overlays for panel selection
and balloon dragging positioned from the same geometry.

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
numbering, word counts, Markdown generation, backup import validation, panel
layout geometry, the artwork crop maths, and the drawing board's flood fill and
colour parsing.
