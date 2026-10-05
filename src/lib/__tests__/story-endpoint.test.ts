import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, {
  describeProviderFailure as describeStoryFailure, looksLikeWrongModel, providerReason,
  resetGoogleTextModelCache, withReason,
} from '../../../api/generate-story'
import { describeProviderFailure as describeImageFailure } from '../../../api/generate-image'

/** Minimal stand-in for the Vercel response object. */
function makeRes() {
  const out: { code: number; body: unknown } = { code: 0, body: null }
  const res = {
    status(code: number) { out.code = code; return res },
    json(body: unknown) { out.body = body },
  }
  return { res, out }
}

function errorOf(body: unknown): { code: string; message: string } {
  return (body as { error: { code: string; message: string } }).error
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

/** Google is asked for its model list first, then for the writing itself. */
function stubGoogle(text: string, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/models?')) {
      return jsonResponse({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] })
    }
    if (status !== 200) return jsonResponse({ error: { message: text } }, status)
    return jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('generate-story endpoint', () => {
  const original = process.env.GOOGLE_API_KEY

  beforeEach(() => {
    process.env.GOOGLE_API_KEY = 'test-key'
    resetGoogleTextModelCache()
  })
  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_API_KEY
    else process.env.GOOGLE_API_KEY = original
    delete process.env.GOOGLE_TEXT_MODEL
    vi.unstubAllGlobals()
  })

  it('reports not_configured when no key is set', async () => {
    delete process.env.GOOGLE_API_KEY
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox' } }, res)
    expect(out.code).toBe(501)
    expect(errorOf(out.body).code).toBe('not_configured')
  })

  it('reports through GET whether a key reached this deployment, without leaking it', async () => {
    const { res, out } = makeRes()
    await handler({ method: 'GET' }, res)
    expect(out.body).toMatchObject({ configured: true, provider: 'google' })
    expect(JSON.stringify(out.body)).not.toContain('test-key')
  })

  it('rejects anything but GET or POST', async () => {
    const { res, out } = makeRes()
    await handler({ method: 'DELETE' }, res)
    expect(out.code).toBe(405)
  })

  it('asks for an idea before it will plan anything', async () => {
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: '   ' } }, res)
    expect(out.code).toBe(400)
    expect(errorOf(out.body).code).toBe('empty_idea')
  })

  it('plans a book and hands the outline back', async () => {
    stubGoogle('{"title":"Deep Water","subtitle":"A tale","chapters":[{"title":"One","summary":"S"}]}')
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox at sea', kind: 'prose', length: 'short' } }, res)
    expect(out.code).toBe(200)
    expect(out.body).toMatchObject({ outline: { title: 'Deep Water' } })
  })

  it('will not write a chapter without the plan it belongs to', async () => {
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { stage: 'chapter', idea: 'a fox', index: 0 } }, res)
    expect(out.code).toBe(400)
    expect(errorOf(out.body).code).toBe('unreadable')
  })

  it('writes a chapter when given the plan', async () => {
    stubGoogle('{"pages":[{"paragraphs":["It began."]}]}')
    const { res, out } = makeRes()
    await handler({
      method: 'POST',
      body: {
        stage: 'chapter', idea: 'a fox', kind: 'prose',
        outline: { title: 'T', chapters: [{ title: 'One', summary: 'S' }] }, index: 0,
      },
    }, res)
    expect(out.code).toBe(200)
    expect(out.body).toMatchObject({ chapter: { pages: [{ paragraphs: ['It began.'] }] } })
  })

  it('says so plainly when the reply holds no JSON at all', async () => {
    stubGoogle('I would rather not write that.')
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox' } }, res)
    expect(out.code).toBe(502)
    expect(errorOf(out.body).code).toBe('unreadable')
  })

  it('treats an empty reply as a refusal rather than a vague failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/models?')
        ? jsonResponse({ models: [] })
        : jsonResponse({ candidates: [{ content: { parts: [{ text: '' }] } }] })))
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox' } }, res)
    expect(errorOf(out.body).code).toBe('rejected')
  })

  it('blames the deployment, not the client, for a key the provider rejects', async () => {
    stubGoogle('API key not valid. Please pass a valid API key.', 400)
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox' } }, res)
    expect(out.code).toBe(502)
    expect(errorOf(out.body).code).toBe('not_configured')
  })

  it('reads a body that arrives as a string behind a proxy', async () => {
    stubGoogle('{"title":"T","chapters":[{"title":"One","summary":"S"}]}')
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: JSON.stringify({ idea: 'a fox' }) }, res)
    expect(out.code).toBe(200)
  })

  it('honours a pinned model instead of asking for the list', async () => {
    process.env.GOOGLE_TEXT_MODEL = 'gemini-pinned'
    const fetchMock = stubGoogle('{"title":"T","chapters":[{"title":"One","summary":"S"}]}')
    const { res } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox' } }, res)
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/models?'))).toBe(false)
    expect(urls.some((u) => u.includes('gemini-pinned'))).toBe(true)
  })
})

describe('a failure the provider explained', () => {
  it('takes the reason out of the body both providers use', () => {
    expect(providerReason(JSON.stringify({ error: { message: 'Json mode is not enabled for models/x' } })))
      .toBe('Json mode is not enabled for models/x')
  })

  it('falls back to a short plain-text body, and gives up on a long one', () => {
    expect(providerReason('Bad Request')).toBe('Bad Request')
    expect(providerReason('x'.repeat(500))).toBe('')
  })

  it('adds the reason only where the message is just a status number', () => {
    const generic = { code: 'provider_error', message: 'The story service failed (400). Try again in a moment.' } as const
    expect(withReason(generic, JSON.stringify({ error: { message: 'Unknown name "foo"' } })).message)
      .toBe('The story service failed (400). Unknown name "foo"')
    // A message that already says what to do is left alone.
    const keyed = { code: 'not_configured', message: 'The story service rejected the API key.' } as const
    expect(withReason(keyed, JSON.stringify({ error: { message: 'noise' } }))).toEqual(keyed)
  })
})

describe('a model that cannot write at all', () => {
  const original = process.env.GOOGLE_API_KEY
  beforeEach(() => { process.env.GOOGLE_API_KEY = 'test-key'; resetGoogleTextModelCache() })
  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_API_KEY
    else process.env.GOOGLE_API_KEY = original
    vi.unstubAllGlobals()
  })

  it('recognises the provider saying the model is the wrong one', () => {
    expect(looksLikeWrongModel(400, '{"error":{"message":"This model only supports Interactions API."}}')).toBe(true)
    expect(looksLikeWrongModel(404, 'models/foo is not found for API version v1beta')).toBe(true)
    // A quota or a key problem is not solved by a different model.
    expect(looksLikeWrongModel(429, 'You exceeded your current quota')).toBe(false)
    expect(looksLikeWrongModel(400, 'API key not valid')).toBe(false)
  })

  it('falls back to a model that can, rather than needing a redeploy', async () => {
    // The listed model is one the endpoint cannot use — exactly what happened
    // in production when the list offered an omni model.
    const fetchMock = vi.fn(async (url: string) => {
      const target = String(url)
      if (target.includes('/models?')) {
        return jsonResponse({ models: [{ name: 'models/gemini-made-up', supportedGenerationMethods: ['generateContent'] }] })
      }
      if (target.includes('gemini-made-up')) {
        return jsonResponse({ error: { message: 'This model only supports Interactions API.' } }, 400)
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"title":"T","chapters":[{"title":"One","summary":"S"}]}' }] } }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox at sea' } }, res)
    expect(out.code).toBe(200)
    expect(out.body).toMatchObject({ outline: { title: 'T' } })
    // It must not keep paying for the dead model on the next request.
    const { res: res2, out: out2 } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox at sea' } }, res2)
    expect(out2.code).toBe(200)
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('gemini-made-up'))).toHaveLength(1)
  })
})

describe('a 400 that cannot otherwise be explained', () => {
  const original = process.env.GOOGLE_API_KEY
  beforeEach(() => { process.env.GOOGLE_API_KEY = 'test-key'; resetGoogleTextModelCache() })
  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_API_KEY
    else process.env.GOOGLE_API_KEY = original
    vi.unstubAllGlobals()
  })

  /** Answers 400 while asked for JSON, and succeeds once asked plainly. */
  function stubFussyModel(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).includes('/models?')) {
        return jsonResponse({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] })
      }
      if (String(init?.body ?? '').includes('responseMimeType')) {
        return jsonResponse({ error: { message: 'Json mode is not enabled for this model' } }, 400)
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"title":"T","chapters":[{"title":"One","summary":"S"}]}' }] } }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('asks again plainly, and gets the story', async () => {
    const fetchMock = stubFussyModel()
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox at sea' } }, res)
    expect(out.code).toBe(200)
    expect(out.body).toMatchObject({ outline: { title: 'T' } })
    const bodies = fetchMock.mock.calls.map((c) => String((c[1] as { body?: string } | undefined)?.body ?? ''))
    expect(bodies.filter((b) => b.includes('responseMimeType'))).toHaveLength(1)
    expect(bodies.filter((b) => b.includes('maxOutputTokens') && !b.includes('responseMimeType'))).toHaveLength(1)
  })

  it('does not waste a second attempt on a key the provider rejected', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('/models?')
        ? jsonResponse({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] })
        : jsonResponse({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400))
    vi.stubGlobal('fetch', fetchMock)
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox at sea' } }, res)
    expect(errorOf(out.body).code).toBe('not_configured')
    // One list call and one generate call: no retry.
    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  it('tells the writer what the provider actually objected to', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/models?')
        ? jsonResponse({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] })
        : jsonResponse({ error: { message: 'Unknown name "responseMimeType" at generation_config' } }, 400)))
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox at sea' } }, res)
    expect(errorOf(out.body).message).toContain('Unknown name')
  })
})

describe('the two endpoints classify provider failures the same way', () => {
  // Both files must stay self-contained to deploy, so this logic is duplicated.
  // The wording differs by service; the decision must not.
  const cases: [number, string][] = [
    [400, 'API key not valid'],
    [400, 'PERMISSION_DENIED'],
    [401, 'nope'],
    [403, 'forbidden'],
    [429, 'quota exceeded'],
    [429, 'slow down'],
    [400, 'RESOURCE_EXHAUSTED'],
    [400, 'blocked by safety settings'],
    [500, 'internal'],
    [503, 'overloaded'],
  ]

  it.each(cases)('status %i with %s', (status, body) => {
    expect(describeStoryFailure(status, body).code).toBe(describeImageFailure(status, body).code)
  })
})
