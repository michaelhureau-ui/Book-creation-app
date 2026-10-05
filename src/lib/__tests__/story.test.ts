import { describe, expect, it } from 'vitest'
import {
  buildGraphicPage, buildProseChapter, layoutForPanels, paragraphsToHtml,
  readGraphicPages, readOutline, readProsePages, startBook,
} from '@/lib/story/story'
import { MAX_IDEA_LENGTH, STORY_AUDIENCES, STORY_LENGTHS } from '@/lib/story/limits'
import {
  AUDIENCES, MAX_IDEA_LENGTH as API_MAX_IDEA_LENGTH, SHAPES, buildChapterPrompt,
  buildOutlinePrompt, chooseGoogleTextModel, cleanIdea, extractGoogleText, parseJsonBody,
  rankTextModel,
} from '../../../api/generate-story'
import { panelCount } from '@/lib/graphic/layouts'
import { parseBlocks, blocksText } from '@/lib/blocks'

describe('limits mirrored from the endpoint', () => {
  // The endpoint has to be self-contained to deploy, so the form keeps its own
  // copy of these. They must not drift.
  it('agrees with the endpoint on how long an idea may be', () => {
    expect(MAX_IDEA_LENGTH).toBe(API_MAX_IDEA_LENGTH)
  })

  it('offers only lengths and audiences the endpoint knows', () => {
    for (const length of STORY_LENGTHS) {
      expect(SHAPES.prose[length]).toBeDefined()
      expect(SHAPES.graphic[length]).toBeDefined()
    }
    for (const audience of STORY_AUDIENCES) expect(AUDIENCES[audience]).toBeDefined()
  })
})

describe('prompts', () => {
  it('refuses to plan a book from nothing', () => {
    expect(() => buildOutlinePrompt('   ', 'prose', 'short', 'middle')).toThrow()
  })

  it('asks for the number of chapters the chosen length means', () => {
    const prompt = buildOutlinePrompt('a fox at sea', 'prose', 'long', 'middle')
    expect(prompt).toContain(`exactly ${SHAPES.prose.long.chapters} chapters`)
    expect(prompt).toContain('a fox at sea')
  })

  it('carries the audience into the writing, not just the plan', () => {
    const outline = { title: 'T', chapters: [{ title: 'One', summary: 'It begins.' }] }
    const prompt = buildChapterPrompt('a fox', 'prose', 'short', 'children', outline, 0)
    expect(prompt).toContain(AUDIENCES.children)
  })

  it('gives the model the whole plan so chapters join up', () => {
    const outline = {
      title: 'T',
      chapters: [{ title: 'One', summary: 'It begins.' }, { title: 'Two', summary: 'It ends.' }],
    }
    const prompt = buildChapterPrompt('a fox', 'prose', 'short', 'middle', outline, 1)
    expect(prompt).toContain('It begins.')
    expect(prompt).toContain('write chapter 2')
  })

  it('asks a graphic novel for panels and balloons, a novel for paragraphs', () => {
    const outline = { title: 'T', chapters: [{ title: 'One', summary: '' }] }
    expect(buildChapterPrompt('x', 'graphic', 'short', 'middle', outline, 0)).toContain('balloons')
    expect(buildChapterPrompt('x', 'prose', 'short', 'middle', outline, 0)).toContain('paragraphs')
  })

  it('trims an idea that runs on', () => {
    expect(cleanIdea(' a  fox \n at sea ')).toBe('a fox at sea')
    expect(cleanIdea('x'.repeat(5000))).toHaveLength(MAX_IDEA_LENGTH)
  })
})

describe('reading what the model sent back', () => {
  it('takes JSON out of a fenced reply', () => {
    expect(parseJsonBody('```json\n{"title":"A"}\n```')).toEqual({ title: 'A' })
  })

  it('takes JSON out of a reply with chatter around it', () => {
    expect(parseJsonBody('Sure! Here you go:\n{"title":"A"}\nHope that helps.')).toEqual({ title: 'A' })
  })

  it('returns nothing rather than throwing on a reply with no JSON at all', () => {
    expect(parseJsonBody('I would rather not.')).toBeNull()
  })

  it('joins the parts Google may split a reply across', () => {
    expect(extractGoogleText({
      candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }],
    })).toBe('{"a":1}')
  })

  it('reads an outline, and still gives a chapter when the model sent none', () => {
    expect(readOutline({ title: 'Deep Water', subtitle: 'A tale', chapters: [{ title: 'One', summary: 'S' }] }))
      .toEqual({ title: 'Deep Water', subtitle: 'A tale', cast: [], chapters: [{ title: 'One', summary: 'S' }] })
    expect(readOutline({ title: 'T' }).chapters).toHaveLength(1)
    expect(readOutline(null).title).toBe('Untitled book')
  })

  it('reads prose pages, and falls back when the model wrote one blob', () => {
    expect(readProsePages({ pages: [{ paragraphs: ['One.', 'Two.'] }] }))
      .toEqual(['<p>One.</p><p>Two.</p>'])
    expect(readProsePages({ pages: [{ text: 'One.\n\nTwo.' }] }))
      .toEqual(['<p>One.</p><p>Two.</p>'])
    expect(readProsePages({})).toEqual([''])
  })

  it('escapes prose so generated text can never arrive as markup', () => {
    const html = paragraphsToHtml(['<script>alert(1)</script> and 5 < 6'])
    expect(html).not.toContain('<script>')
    expect(blocksText(parseBlocks(html))).toContain('alert(1)')
  })
})

describe('turning a written comic into pages', () => {
  const written = {
    pages: [{
      title: 'The Harbour',
      panels: [
        { art: 'A fox waits in the rain.', balloons: [{ kind: 'speech', text: 'Nobody came.' }] },
        { art: 'The ferry pulls away.', balloons: [{ kind: 'sfx', text: 'Hooooonk' }, { kind: 'thought', text: 'Typical.' }] },
        { art: 'An empty quay.', balloons: [] },
      ],
    }],
  }

  it('picks a layout with room for every panel written', () => {
    expect(panelCount(layoutForPanels(1))).toBe(1)
    expect(panelCount(layoutForPanels(3))).toBeGreaterThanOrEqual(3)
    expect(panelCount(layoutForPanels(5))).toBeGreaterThanOrEqual(5)
    // More panels than any layout holds still gets the biggest one.
    expect(panelCount(layoutForPanels(99))).toBe(6)
  })

  it('keeps the drawing brief and the lettering on the right panels', () => {
    const [page] = readGraphicPages(written)
    expect(page.title).toBe('The Harbour')
    expect(page.panels[0].note).toBe('A fox waits in the rain.')
    expect(page.panels[1].balloons.map((b) => b.kind)).toEqual(['sfx', 'thought'])
    expect(page.panels[2].balloons).toEqual([])
  })

  it('drops a balloon with no words, and falls back on an unknown kind', () => {
    const [page] = readGraphicPages({
      pages: [{ panels: [{ art: 'a', balloons: [{ kind: 'speech', text: '' }, { kind: 'wat', text: 'Hi' }] }] }],
    })
    expect(page.panels[0].balloons).toHaveLength(1)
    expect(page.panels[0].balloons[0].kind).toBe('speech')
  })

  it('fills the layout out with empty panels and files the page under its chapter', () => {
    const [written1] = readGraphicPages(written)
    const page = buildGraphicPage(written1, 'chapter-1')
    expect(page.chapterId).toBe('chapter-1')
    expect(page.panels).toHaveLength(panelCount(page.layout))
    expect(page.panels[0].note).toBe('A fox waits in the rain.')
  })

  it('spreads several balloons down the panel instead of stacking them', () => {
    const [page] = readGraphicPages(written)
    const built = buildGraphicPage(page, 'c')
    const ys = built.panels[1].balloons.map((b) => b.y)
    expect(new Set(ys).size).toBe(ys.length)
  })
})

describe('assembling the book', () => {
  it('starts an empty book carrying the title and subtitle', () => {
    const book = startBook({ title: 'Deep Water', subtitle: 'A tale', cast: [], chapters: [] }, 'graphic')
    expect(book).toMatchObject({ title: 'Deep Water', subtitle: 'A tale', kind: 'graphic' })
    expect(book.chapters).toEqual([])
    expect(book.pages).toEqual([])
  })

  it('makes a chapter of as many pages as were written', () => {
    const chapter = buildProseChapter('One', ['<p>A.</p>', '<p>B.</p>'])
    expect(chapter.title).toBe('One')
    expect(chapter.pages.map((p) => p.content)).toEqual(['<p>A.</p>', '<p>B.</p>'])
  })

  it('never leaves a chapter with no page at all', () => {
    expect(buildProseChapter('Empty', []).pages).toHaveLength(1)
  })
})

describe('choosing a text model', () => {
  const models = (...names: string[]) =>
    names.map((name) => ({ name: `models/${name}`, supportedGenerationMethods: ['generateContent'] }))

  it('prefers a flash model, which is the fast free-tier one', () => {
    expect(chooseGoogleTextModel(models('gemini-2.5-pro', 'gemini-2.5-flash')))
      .toBe('gemini-2.5-flash')
  })

  it('skips models that cannot write a chapter', () => {
    expect(chooseGoogleTextModel(models('gemini-2.0-flash-image', 'imagen-3.0', 'text-embedding-004')))
      .toBeNull()
  })

  it('skips a model that cannot be asked for content at all', () => {
    expect(chooseGoogleTextModel([
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['countTokens'] },
    ])).toBeNull()
  })

  it('falls back to a non-flash model rather than nothing', () => {
    expect(chooseGoogleTextModel(models('gemini-2.5-pro'))).toBe('gemini-2.5-pro')
  })

  /**
   * The failure this guards against, seen in production: Google's list offers
   * `gemini-omni-flash-preview`, which answers "This model only supports
   * Interactions API". It was picked for two reasons — the names were sorted
   * alphabetically, so "omni" beat "2.5", and a model was assumed capable when
   * the list never said it was.
   */
  it('will not take a model Google does not say can write', () => {
    expect(chooseGoogleTextModel([{ name: 'models/gemini-2.5-flash' }])).toBeNull()
  })

  it('leaves out an omni model, which serves a different API entirely', () => {
    expect(chooseGoogleTextModel(models('gemini-omni-flash-preview'))).toBeNull()
  })

  it('does not let a name that merely sorts last win', () => {
    expect(chooseGoogleTextModel(models(
      'gemini-2.5-flash', 'gemini-omni-flash-preview', 'gemini-flash-latest',
    ))).toBe('gemini-2.5-flash')
  })

  it('prefers a settled model over a preview or a moving alias', () => {
    expect(rankTextModel('gemini-2.5-flash')[1]).toBe(1)
    for (const moving of ['gemini-2.5-flash-preview-05-20', 'gemini-flash-latest', 'gemini-2.0-flash-exp']) {
      expect(rankTextModel(moving)[1]).toBe(0)
    }
    expect(chooseGoogleTextModel(models('gemini-2.5-flash-preview-05-20', 'gemini-2.0-flash')))
      .toBe('gemini-2.0-flash')
  })

  it('prefers the higher version among equally settled models', () => {
    expect(chooseGoogleTextModel(models('gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-2.0-flash')))
      .toBe('gemini-2.5-flash')
  })
})
