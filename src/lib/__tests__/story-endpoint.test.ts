import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, {
  describeProviderFailure as describeStoryFailure, resetGoogleTextModelCache,
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
