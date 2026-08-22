import { describe, expect, it } from 'vitest'
import { blocksText, parseBlocks, runsText } from '@/lib/blocks'

describe('parseBlocks', () => {
  it('returns nothing for empty content', () => {
    expect(parseBlocks('')).toEqual([])
    expect(parseBlocks('   ')).toEqual([])
  })

  it('reads a plain paragraph', () => {
    const [block] = parseBlocks('<p>Hello there.</p>')
    expect(block).toEqual({ type: 'paragraph', runs: [{ text: 'Hello there.' }] })
  })

  it('captures inline marks', () => {
    const [block] = parseBlocks('<p>a <strong>b</strong> <em>c</em> <u>d</u> <s>e</s> <code>f</code></p>')
    if (block.type !== 'paragraph') throw new Error('expected a paragraph')
    const marked = block.runs.filter((r) => r.text.trim())
    expect(marked.find((r) => r.text === 'b')?.bold).toBe(true)
    expect(marked.find((r) => r.text === 'c')?.italic).toBe(true)
    expect(marked.find((r) => r.text === 'd')?.underline).toBe(true)
    expect(marked.find((r) => r.text === 'e')?.strike).toBe(true)
    expect(marked.find((r) => r.text === 'f')?.code).toBe(true)
  })

  it('combines nested marks', () => {
    const [block] = parseBlocks('<p><strong><em>both</em></strong></p>')
    if (block.type !== 'paragraph') throw new Error('expected a paragraph')
    expect(block.runs[0]).toMatchObject({ text: 'both', bold: true, italic: true })
  })

  it('merges adjacent runs that share formatting', () => {
    const [block] = parseBlocks('<p><strong>one</strong><strong> two</strong></p>')
    if (block.type !== 'paragraph') throw new Error('expected a paragraph')
    expect(block.runs).toHaveLength(1)
    expect(block.runs[0].text).toBe('one two')
  })

  it('clamps heading levels to three', () => {
    expect(parseBlocks('<h1>A</h1>')[0]).toMatchObject({ type: 'heading', level: 1 })
    expect(parseBlocks('<h5>A</h5>')[0]).toMatchObject({ type: 'heading', level: 3 })
  })

  it('flattens the paragraphs TipTap nests inside a blockquote', () => {
    const [block] = parseBlocks('<blockquote><p>Quoted.</p></blockquote>')
    expect(block.type).toBe('quote')
    if (block.type !== 'quote') return
    expect(runsText(block.runs)).toBe('Quoted.')
  })

  it('reads both kinds of list', () => {
    const [ul] = parseBlocks('<ul><li><p>one</p></li><li><p>two</p></li></ul>')
    expect(ul).toMatchObject({ type: 'list', ordered: false })
    if (ul.type !== 'list') return
    expect(ul.items.map(runsText)).toEqual(['one', 'two'])
    expect(parseBlocks('<ol><li><p>x</p></li></ol>')[0]).toMatchObject({ ordered: true })
  })

  it('keeps code blocks verbatim', () => {
    const [block] = parseBlocks('<pre><code>a\n  b\n</code></pre>')
    expect(block).toEqual({ type: 'code', text: 'a\n  b' })
  })

  it('reads horizontal rules', () => {
    expect(parseBlocks('<hr>')[0]).toEqual({ type: 'rule' })
  })

  it('turns <br> into an explicit break', () => {
    const [block] = parseBlocks('<p>one<br>two</p>')
    if (block.type !== 'paragraph') throw new Error('expected a paragraph')
    expect(block.runs.map((r) => r.text)).toEqual(['one', '\n', 'two'])
  })

  it('drops blocks that hold no text', () => {
    expect(parseBlocks('<p></p><p>  </p>')).toEqual([])
  })

  it('does not carry a script element through as content', () => {
    // Imported project files are untrusted; only text ever survives parsing.
    const blocks = parseBlocks('<p>safe<script>alert(1)</script></p>')
    expect(blocksText(blocks)).not.toContain('alert')
  })
})

describe('blocksText', () => {
  it('renders every block type as plain text', () => {
    const text = blocksText(parseBlocks('<h1>Title</h1><p>Body.</p><ul><li><p>a</p></li></ul><hr>'))
    expect(text).toBe('Title\n\nBody.\n\na\n\n***')
  })
})
