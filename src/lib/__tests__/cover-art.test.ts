import { describe, expect, it, vi } from 'vitest'
import { COVER_ASPECT, suggestCoverBrief } from '@/lib/cover-art'
import { createBook } from '@/lib/book'

function bookWith(fields: Partial<ReturnType<typeof createBook>>) {
  return { ...createBook('prose'), ...fields }
}

describe('the picture on the cover', () => {
  it('is asked for at the shape of a jacket', () => {
    // Two across for every three up: a portrait book, not a square panel.
    expect(COVER_ASPECT).toBeCloseTo(2 / 3)
    expect(COVER_ASPECT).toBeLessThan(1)
  })

  it('suggests something to draw from the book itself', () => {
    const brief = suggestCoverBrief(bookWith({
      title: 'The Lantern at Bramble Head',
      description: 'A fox keeps a lighthouse through a hard winter.',
    }))
    expect(brief).toContain('The Lantern at Bramble Head')
    expect(brief).toContain('A fox keeps a lighthouse')
    // Room for the title, and no lettering in the artwork itself.
    expect(brief).toMatch(/top for the title/i)
    expect(brief).toMatch(/no lettering/i)
  })

  it('still suggests something for a book with nothing written in it yet', () => {
    const brief = suggestCoverBrief(createBook('prose'))
    expect(brief.trim().length).toBeGreaterThan(20)
    // Whatever an untitled book is called, the brief names it rather than
    // asking for a picture of nothing.
    expect(brief).toMatch(/Cover art for a book called "[^"]+"/)
  })
})

describe('the cover in what gets published', () => {
  it('travels into the EPUB as a real cover, not just a page inside', async () => {
    vi.resetModules()
    vi.doMock('@/lib/db', () => ({
      loadAsset: async (id: string) => (id === 'art-1'
        ? { id, bookId: 'b', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), type: 'image/png', width: 1024, height: 1536, createdAt: 0 }
        : undefined),
    }))
    const { buildEpub } = await import('@/lib/export/epub')
    const JSZip = (await import('jszip')).default

    const book = createBook('prose')
    book.title = 'The Lantern at Bramble Head'
    book.cover = { ...book.cover, art: 'art-1', artFit: 'full' }

    const zip = await JSZip.loadAsync(await buildEpub(book))
    const names = Object.keys(zip.files)
    expect(names).toContain('OEBPS/cover.png')

    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    // An e-reader finds the shelf thumbnail through this property.
    expect(opf).toContain('properties="cover-image"')
    expect(opf).toContain('<meta name="cover" content="cover-image"/>')
    // And opens on the cover rather than the title page.
    expect(opf.indexOf('idref="cover"')).toBeLessThan(opf.indexOf('idref="title"'))
    vi.doUnmock('@/lib/db')
  })

  it('leaves the EPUB exactly as it was when there is no picture', async () => {
    vi.resetModules()
    const { buildEpub } = await import('@/lib/export/epub')
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(await buildEpub(createBook('prose')))
    expect(Object.keys(zip.files).some((n) => n.includes('cover'))).toBe(false)
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).not.toContain('cover-image')
  })
})
