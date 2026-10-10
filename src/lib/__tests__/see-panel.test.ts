import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, {
  buildSeePrompt, chooseVisionModel, extractText, fraction, readSeen, resetVisionModelCache,
} from '../../../api/see-panel'

function makeRes() {
  const out: { code: number; body: unknown } = { code: 0, body: null }
  const res = {
    status(code: number) { out.code = code; return res },
    json(body: unknown) { out.body = body },
  }
  return { res, out }
}

/** The shape Google answers a generateContent call in. */
function answered(text: string) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  }
}

describe('reading a fraction out of the answer', () => {
  it('takes a plain fraction as it is', () => {
    expect(fraction(0.42)).toBeCloseTo(0.42)
  })

  it('rescues an answer given in percent', () => {
    expect(fraction(80)).toBeCloseTo(0.8)
  })

  it('rescues an answer given in pixels of the thumbnail', () => {
    expect(fraction(448)).toBeGreaterThan(0.3)
    expect(fraction(448)).toBeLessThan(0.6)
  })

  it('keeps everything inside the panel', () => {
    expect(fraction(-5)).toBeGreaterThan(0)
    expect(fraction(1.4)).toBeLessThan(1)
  })

  it('falls back when there is no number at all', () => {
    expect(fraction(undefined)).toBe(0.5)
    expect(fraction('nowhere')).toBe(0.5)
  })
})

describe('reading the answer', () => {
  it('picks up the people and the faces', () => {
    const seen = readSeen('{"people":[{"name":"Kara","x":0.2,"y":0.4}],"faces":[{"x":0.2,"y":0.35}]}', ['Kara'])
    expect(seen.people).toEqual([{ name: 'Kara', x: 0.2, y: 0.4 }])
    expect(seen.faces).toHaveLength(1)
  })

  it('unwraps a fenced code block', () => {
    const seen = readSeen('```json\n{"people":[{"name":"Dev","x":0.7,"y":0.5}]}\n```', ['Dev'])
    expect(seen.people[0].name).toBe('Dev')
  })

  it('answers with the name the app asked about, whatever case came back', () => {
    const seen = readSeen('{"people":[{"name":"kara","x":0.2,"y":0.4}]}', ['Kara'])
    expect(seen.people[0].name).toBe('Kara')
  })

  it('throws away a character nobody asked about', () => {
    // Aiming a tail at an invented name would point it at nobody.
    const seen = readSeen('{"people":[{"name":"A passing dog","x":0.2,"y":0.4}]}', ['Kara'])
    expect(seen.people).toEqual([])
  })

  it('keeps one entry per character', () => {
    const seen = readSeen(
      '{"people":[{"name":"Kara","x":0.2,"y":0.4},{"name":"Kara","x":0.8,"y":0.4}]}', ['Kara'],
    )
    expect(seen.people).toHaveLength(1)
    expect(seen.people[0].x).toBeCloseTo(0.2)
  })

  it('treats an empty answer as nobody visible, not as a failure', () => {
    expect(readSeen('{"people":[],"faces":[]}', ['Kara'])).toEqual({ people: [], faces: [] })
  })

  it('complains when the answer is not JSON at all', () => {
    expect(() => readSeen('I cannot see any people.', ['Kara'])).toThrow()
  })
})

describe('the prompt', () => {
  it('names the characters to look for and insists on fractions', () => {
    const prompt = buildSeePrompt(['Kara', 'Dev'], 'A rooftop at dusk.')
    expect(prompt).toContain('Kara, Dev')
    expect(prompt).toContain('A rooftop at dusk.')
    expect(prompt).toMatch(/fractions of the picture/)
  })

  it('still works with no names', () => {
    expect(buildSeePrompt([], '')).toContain('No character names')
  })
})

describe('chooseVisionModel', () => {
  const generates = (name: string) => ({ name: `models/${name}`, supportedGenerationMethods: ['generateContent'] })

  it('prefers a flash model, because this is one small question per panel', () => {
    expect(chooseVisionModel([
      generates('gemini-3-pro-preview'),
      generates('gemini-3-flash'),
    ])).toBe('gemini-3-flash')
  })

  it('refuses a model that cannot answer in words', () => {
    expect(chooseVisionModel([
      generates('gemini-2.5-flash-image'),
      generates('imagen-4.0-generate-001'),
      generates('gemini-2.5-flash-tts'),
    ])).toBeNull()
  })

  it('takes a pro model when there is no flash', () => {
    expect(chooseVisionModel([generates('gemini-3-pro-preview')])).toBe('gemini-3-pro-preview')
  })

  it('ignores a model Google says cannot be called this way', () => {
    expect(chooseVisionModel([
      { name: 'models/gemini-3-flash', supportedGenerationMethods: ['embedContent'] },
    ])).toBeNull()
  })
})

describe('extractText', () => {
  it('joins the parts of the answer', () => {
    expect(extractText({ candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }] }))
      .toBe('{"a":1}')
  })

  it('is empty rather than broken when there is no answer', () => {
    expect(extractText({})).toBe('')
    expect(extractText(null)).toBe('')
  })
})

describe('the endpoint', () => {
  const key = process.env.GOOGLE_API_KEY

  beforeEach(() => {
    resetVisionModelCache()
    process.env.GOOGLE_API_KEY = 'test-key'
    process.env.GOOGLE_VISION_MODEL = 'gemini-3-flash'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.GOOGLE_VISION_MODEL
    if (key === undefined) delete process.env.GOOGLE_API_KEY
    else process.env.GOOGLE_API_KEY = key
  })

  it('reports whether it is switched on', async () => {
    const { res, out } = makeRes()
    await handler({ method: 'GET' }, res)
    expect(out.body).toMatchObject({ configured: true })
  })

  it('says so plainly when no key reached the deployment', async () => {
    delete process.env.GOOGLE_API_KEY
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { image: 'abc' } }, res)
    expect(out.code).toBe(501)
    expect(out.body).toMatchObject({ error: { code: 'not_configured' } })
  })

  it('refuses a request with no picture in it', async () => {
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { names: ['Kara'] } }, res)
    expect(out.code).toBe(400)
    expect(out.body).toMatchObject({ error: { code: 'empty' } })
  })

  it('answers where the people are', async () => {
    const sentBodies: string[] = []
    const fetchMock = vi.fn(async (_url: string, init?: { body?: unknown }) => {
      sentBodies.push(String(init?.body ?? ''))
      return answered('{"people":[{"name":"Kara","x":0.8,"y":0.4}],"faces":[{"x":0.8,"y":0.36}]}')
    })
    vi.stubGlobal('fetch', fetchMock)

    const { res, out } = makeRes()
    await handler({
      method: 'POST',
      body: { image: 'data:image/jpeg;base64,AAAA', names: ['Kara'], note: 'A rooftop.' },
    }, res)

    expect(out.code).toBe(200)
    expect(out.body).toMatchObject({ people: [{ name: 'Kara', x: 0.8 }] })

    // The data-URL wrapper is stripped: the provider wants the bytes only.
    const sent = JSON.parse(sentBodies[0])
    expect(sent.contents[0].parts[0].inlineData.data).toBe('AAAA')
    expect(sent.contents[0].parts[0].inlineData.mimeType).toBe('image/jpeg')
    // Thinking is off: the answer is a glance, and the tokens are the latency.
    expect(sent.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })
  })

  it('passes a provider refusal back as a refusal, not as an answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    })))
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { image: 'AAAA', names: ['Kara'] } }, res)
    expect(out.code).toBe(429)
    expect(out.body).toMatchObject({ error: { code: 'provider_error' } })
  })

  it('reports an answer it cannot read rather than inventing positions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answered('I am not able to help with that.')))
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { image: 'AAAA', names: ['Kara'] } }, res)
    expect(out.code).toBe(502)
    expect(out.body).toMatchObject({ error: { code: 'unreadable' } })
  })
})
