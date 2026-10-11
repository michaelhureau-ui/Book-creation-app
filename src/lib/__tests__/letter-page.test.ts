import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, {
  buildLetterPrompt, chooseWritingModel, clip, extractText, fraction, readLettering,
  resetWritingModelCache,
} from '../../../api/letter-page'
import { buildChapterPrompt } from '../../../api/generate-story'
import { drawnPanels, letterPage, LetteringFailed } from '@/lib/story/letter'
import { createPage, createPanel } from '@/lib/graphic/pages'

function makeRes() {
  const out: { code: number; body: unknown } = { code: 0, body: null }
  const res = {
    status(code: number) { out.code = code; return res },
    json(body: unknown) { out.body = body },
  }
  return { res, out }
}

function answered(text: string) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
  }
}

describe('asking for pictures with no words in them', () => {
  it('asks for a brief and a beat, and forbids dialogue', () => {
    const prompt = buildChapterPrompt(
      'a fox and a lighthouse', 'graphic', 'short', 'middle',
      { title: 'The Lamp', chapters: [{ title: 'One', summary: 'The lamp goes out.' }] },
      0, undefined, false, undefined, true,
    )
    expect(prompt).toMatch(/Do not write any dialogue/)
    expect(prompt).toMatch(/"beat"/)
    expect(prompt).not.toMatch(/\{"kind":"speech"/)
  })

  it('still writes the words in with the pictures when it is not asked to wait', () => {
    const prompt = buildChapterPrompt(
      'a fox and a lighthouse', 'graphic', 'short', 'middle',
      { title: 'The Lamp', chapters: [{ title: 'One', summary: 'The lamp goes out.' }] }, 0,
    )
    expect(prompt).toMatch(/balloon/)
    expect(prompt).not.toMatch(/Do not write any dialogue/)
  })

  it('asks a picture book for one panel a page even with the words held back', () => {
    const prompt = buildChapterPrompt(
      'a bear in the rain', 'picture', 'short', 'children',
      { title: 'Rain', chapters: [{ title: 'One', summary: 'It rains.' }] },
      0, undefined, false, undefined, true,
    )
    expect(prompt).toMatch(/one panel each/)
  })
})

describe('the words that come back', () => {
  it('reads a balloon and the speaker it belongs to', () => {
    const [panel] = readLettering(
      '{"panels":[{"balloons":[{"kind":"speech","speaker":"Kara","text":"Hold the line."}],'
      + '"people":[{"name":"Kara","x":0.3,"y":0.4}]}]}', 1,
    )
    expect(panel.balloons[0]).toEqual({ kind: 'speech', speaker: 'Kara', text: 'Hold the line.' })
    expect(panel.people[0]).toEqual({ name: 'Kara', x: 0.3, y: 0.4 })
  })

  it('gives one entry per panel even when the answer is short', () => {
    const panels = readLettering('{"panels":[{"balloons":[{"text":"Here."}]}]}', 3)
    expect(panels).toHaveLength(3)
    expect(panels[1].balloons).toEqual([])
  })

  it('takes a caption away from whoever was named as saying it', () => {
    const [panel] = readLettering(
      '{"panels":[{"balloons":[{"kind":"caption","speaker":"Kara","text":"Midwinter."}]}]}', 1,
    )
    expect(panel.balloons[0].speaker).toBe('')
  })

  it('trims a balloon that would never fit on a panel', () => {
    expect(clip('word '.repeat(60)).split(' ').length).toBeLessThanOrEqual(31)
    expect(clip('short one')).toBe('short one')
  })

  it('never lets one panel carry a wall of balloons', () => {
    const many = Array.from({ length: 9 }, (_, i) => `{"kind":"speech","text":"Line ${i}"}`)
    const [panel] = readLettering(`{"panels":[{"balloons":[${many.join(',')}]}]}`, 1)
    expect(panel.balloons.length).toBeLessThanOrEqual(3)
  })

  it('rescues positions given in percent', () => {
    expect(fraction(80)).toBeCloseTo(0.8)
    expect(fraction('nonsense')).toBe(0.5)
  })

  it('complains rather than inventing words when the answer is not JSON', () => {
    expect(() => readLettering('I am not able to help.', 2)).toThrow()
  })
})

describe('the prompt for a drawn page', () => {
  it('names each panel and what it was drawn for', () => {
    const prompt = buildLetterPrompt({
      kind: 'graphic',
      title: 'Page 3',
      story: 'The Lamp, from the idea: a fox who keeps a lighthouse.',
      cast: [{ name: 'Rell', look: 'a red fox in an oilskin coat' }],
      panels: [{ beat: 'Rell sees the light is out' }, { beat: 'Hask argues with her' }],
    })
    expect(prompt).toMatch(/Panel 1: Rell sees the light is out/)
    expect(prompt).toMatch(/Panel 2: Hask argues with her/)
    expect(prompt).toMatch(/Rell — a red fox/)
    expect(prompt).toMatch(/where each character who speaks/)
  })

  it('asks a picture book for a caption a child can follow', () => {
    const prompt = buildLetterPrompt({ kind: 'picture', panels: [{ beat: 'The bear waits.' }] })
    expect(prompt).toMatch(/five-year-old/)
    expect(prompt).toMatch(/picture book/)
  })
})

describe('chooseWritingModel', () => {
  const generates = (name: string) => ({
    name: `models/${name}`, supportedGenerationMethods: ['generateContent'],
  })

  it('takes a flash model over a lite one', () => {
    expect(chooseWritingModel([generates('gemini-3-flash-lite'), generates('gemini-3-flash')]))
      .toBe('gemini-3-flash')
  })

  it('refuses a model that cannot write', () => {
    expect(chooseWritingModel([generates('gemini-2.5-flash-image')])).toBeNull()
  })
})

describe('extractText', () => {
  it('joins the parts', () => {
    expect(extractText({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }))
      .toBe('ab')
  })
})

describe('the endpoint', () => {
  const key = process.env.GOOGLE_API_KEY

  beforeEach(() => {
    resetWritingModelCache()
    process.env.GOOGLE_API_KEY = 'test-key'
    process.env.GOOGLE_VISION_MODEL = 'gemini-3-flash'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.GOOGLE_VISION_MODEL
    if (key === undefined) delete process.env.GOOGLE_API_KEY
    else process.env.GOOGLE_API_KEY = key
  })

  it('refuses a request with no pictures in it', async () => {
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { panels: [] } }, res)
    expect(out.code).toBe(400)
    expect(out.body).toMatchObject({ error: { code: 'empty' } })
  })

  it('sends every panel as its own picture, in order', async () => {
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: unknown }) => {
      sent.push(String(init?.body ?? ''))
      return answered('{"panels":[{"balloons":[{"kind":"speech","speaker":"Rell","text":"Up."}]}]}')
    }))

    const { res, out } = makeRes()
    await handler({
      method: 'POST',
      body: {
        kind: 'graphic',
        panels: [
          { image: 'data:image/jpeg;base64,AAAA', beat: 'Rell climbs' },
          { image: 'BBBB', beat: 'Hask waits' },
        ],
      },
    }, res)

    expect(out.code).toBe(200)
    const body = JSON.parse(sent[0]) as { contents: { parts: Record<string, unknown>[] }[] }
    const parts = body.contents[0].parts
    expect(parts[0]).toEqual({ text: 'Panel 1:' })
    expect(parts[1]).toMatchObject({ inlineData: { data: 'AAAA' } })
    expect(parts[2]).toEqual({ text: 'Panel 2:' })
    expect(parts[3]).toMatchObject({ inlineData: { data: 'BBBB' } })
  })

  it('says plainly when it is not switched on', async () => {
    delete process.env.GOOGLE_API_KEY
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { panels: [{ image: 'AAAA' }] } }, res)
    expect(out.code).toBe(501)
    expect(out.body).toMatchObject({ error: { code: 'not_configured' } })
  })

  it('passes a refusal back rather than reporting no words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, text: async () => 'busy' })))
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { panels: [{ image: 'AAAA' }] } }, res)
    expect(out.code).toBe(429)
  })
})

describe('which panels are worth lettering', () => {
  it('is the ones that have been drawn', () => {
    const page = {
      ...createPage('two-rows'),
      panels: [
        { ...createPanel(), assetId: 'art-1' },
        { ...createPanel(), assetId: null },
      ],
    }
    expect(drawnPanels(page).map((d) => d.index)).toEqual([0])
  })
})

describe('asking for a page to be lettered', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('tells a build with no such endpoint apart from a service that failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => null })))
    await expect(letterPage({
      kind: 'graphic', title: '', story: '', cast: [], panels: [{ image: 'A', beat: '' }],
    })).rejects.toMatchObject({ code: 'stale_build' })
  })

  it('reports being offline as being offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const err = await letterPage({
      kind: 'graphic', title: '', story: '', cast: [], panels: [{ image: 'A', beat: '' }],
    }).catch((e) => e)
    expect(err).toBeInstanceOf(LetteringFailed)
    expect((err as LetteringFailed).code).toBe('network')
  })
})
