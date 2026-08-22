import JSZip from 'jszip'
import type { Block, Run } from '@/lib/blocks'
import { parseBlocks } from '@/lib/blocks'
import type { Book, Chapter } from '@/types'
import { bookAuthor, bookTitle, chapterNumbers } from '@/lib/book'
import { paletteOf } from '@/lib/cover'

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function runToXhtml(run: Run): string {
  let out = esc(run.text).replace(/\n/g, '<br/>')
  if (run.code) out = `<code>${out}</code>`
  if (run.bold) out = `<strong>${out}</strong>`
  if (run.italic) out = `<em>${out}</em>`
  if (run.underline) out = `<u>${out}</u>`
  if (run.strike) out = `<s>${out}</s>`
  return out
}

function runsToXhtml(runs: Run[]): string {
  return runs.map(runToXhtml).join('')
}

function blockToXhtml(block: Block): string {
  switch (block.type) {
    case 'heading': return `<h${block.level + 1}>${runsToXhtml(block.runs)}</h${block.level + 1}>`
    case 'quote': return `<blockquote><p>${runsToXhtml(block.runs)}</p></blockquote>`
    case 'code': return `<pre><code>${esc(block.text)}</code></pre>`
    case 'rule': return '<hr/>'
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul'
      return `<${tag}>${block.items.map((i) => `<li>${runsToXhtml(i)}</li>`).join('')}</${tag}>`
    }
    default: return `<p>${runsToXhtml(block.runs)}</p>`
  }
}

function page(title: string, body: string, lang: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(lang)}" xml:lang="${esc(lang)}">
<head>
  <meta charset="utf-8"/>
  <title>${esc(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>`
}

function chapterXhtml(book: Book, chapter: Chapter, number: number | undefined): string {
  const blocks = parseBlocks(chapter.content)
  const body = [
    '<section epub:type="chapter">',
    number ? `<p class="chapter-number">Chapter ${number}</p>` : '',
    `<h1>${esc(chapter.title || 'Untitled')}</h1>`,
    blocks.length ? blocks.map(blockToXhtml).join('\n') : '<p class="empty">This chapter is empty.</p>',
    '</section>',
  ].filter(Boolean).join('\n')
  return page(chapter.title || 'Untitled', body, book.language)
}

const STYLESHEET = `body { font-family: Georgia, serif; line-height: 1.6; margin: 5%; color: #1c1a17; }
h1 { font-size: 1.7em; text-align: center; margin: 1.2em 0 1.4em; font-weight: normal; }
h2, h3, h4 { font-weight: normal; margin: 1.4em 0 .5em; }
p { margin: 0 0 .2em; text-indent: 1.3em; text-align: justify; }
p:first-of-type, h1 + p, h2 + p, h3 + p, blockquote p { text-indent: 0; }
.chapter-number { text-align: center; text-indent: 0; letter-spacing: .18em; font-size: .8em; text-transform: uppercase; color: #8b857c; }
.empty { text-align: center; text-indent: 0; font-style: italic; color: #8b857c; }
blockquote { margin: 1em 2em; font-style: italic; color: #4a4640; }
pre { background: #f3efe7; padding: .8em; overflow-x: auto; font-size: .85em; }
hr { border: 0; text-align: center; margin: 1.6em 0; }
hr:after { content: "* * *"; color: #8b857c; letter-spacing: .4em; }
.title-page { text-align: center; margin-top: 25%; }
.title-page h1 { font-size: 2.4em; margin-bottom: .3em; }
.title-page .subtitle { font-size: 1.2em; color: #4a4640; text-indent: 0; font-style: italic; }
.title-page .author { margin-top: 2.5em; text-indent: 0; letter-spacing: .1em; }
nav ol { list-style: none; padding: 0; }
nav li { margin: .5em 0; }`

/** Deterministic id so the manifest, spine, and nav always agree. */
function chapterFile(index: number): string {
  return `chapter-${String(index + 1).padStart(3, '0')}.xhtml`
}

export async function buildEpub(book: Book): Promise<Blob> {
  const zip = new JSZip()
  const title = bookTitle(book)
  const author = bookAuthor(book)
  const numbers = chapterNumbers(book.chapters)
  const lang = book.language || 'en'
  // EPUB requires a stable unique identifier; the book's own id serves.
  const uid = `urn:uuid:${book.id}`
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  // `mimetype` must be the first entry and stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)

  const oebps = zip.folder('OEBPS')
  if (!oebps) throw new Error('Could not assemble the EPUB package.')
  oebps.file('style.css', STYLESHEET)

  const palette = paletteOf(book.cover.palette)
  const titleBody = `<div class="title-page" style="color:${palette.fg};">
  <h1>${esc(title)}</h1>
  ${book.subtitle.trim() ? `<p class="subtitle">${esc(book.subtitle.trim())}</p>` : ''}
  <p class="author">${esc(author)}</p>
</div>`
  oebps.file('title.xhtml', page(title, titleBody, lang))

  const files: { file: string; title: string }[] = []
  book.chapters.forEach((chapter, i) => {
    const file = chapterFile(i)
    oebps.file(file, chapterXhtml(book, chapter, numbers.get(chapter.id)))
    const n = numbers.get(chapter.id)
    files.push({ file, title: n ? `${n}. ${chapter.title || 'Untitled'}` : chapter.title || 'Untitled' })
  })

  const navBody = `<nav epub:type="toc" id="toc">
  <h1>Contents</h1>
  <ol>
${files.map((f) => `    <li><a href="${f.file}">${esc(f.title)}</a></li>`).join('\n')}
  </ol>
</nav>`
  oebps.file('nav.xhtml', page('Contents', navBody, lang))

  oebps.file('content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${esc(lang)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${esc(uid)}</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
    <dc:creator>${esc(author)}</dc:creator>
    <dc:language>${esc(lang)}</dc:language>
    ${book.description.trim() ? `<dc:description>${esc(book.description.trim())}</dc:description>` : ''}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
${files.map((f, i) => `    <item id="ch${i + 1}" href="${f.file}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine>
    <itemref idref="title"/>
    <itemref idref="nav"/>
${files.map((_, i) => `    <itemref idref="ch${i + 1}"/>`).join('\n')}
  </spine>
</package>`)

  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' })
}
