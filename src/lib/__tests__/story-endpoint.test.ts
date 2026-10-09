import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, {
  describeProviderFailure as describeStoryFailure, looksLikeWrongModel, probeGoogleModels,
  parseJsonBody, providerReason, refusalAdvice, repairTruncatedJson, resetGoogleTextModelCache,
  thinkingFor, withReason,
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

/**
 * The endpoint asks each model for a single word before trusting it with a
 * chapter, so a test counting attempts has to tell the two apart.
 */
function isPing(init?: { body?: string }): boolean {
  return (init?.body ?? '').includes('Say the word yes.')
}

/** The models the endpoint reached for, in order, each named once. */
function walked(tried: string[]): string[] {
  return tried.filter((name, i) => tried.indexOf(name) === i)
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
    // A key problem is not solved by a different model.
    expect(looksLikeWrongModel(400, 'API key not valid')).toBe(false)
    expect(looksLikeWrongModel(500, 'internal')).toBe(false)
  })

  /**
   * Google's list offers models from every tier, so the newest is often one the
   * key cannot pay for. It answers 402 "your prepayment credits are depleted",
   * which reads to a writer as "you have run out" when the next model down
   * would have written the book for nothing.
   */
  it('treats a model the account cannot pay for as the wrong model', () => {
    expect(looksLikeWrongModel(402, 'Your prepayment credits are depleted.')).toBe(true)
    expect(looksLikeWrongModel(429, 'Quota exceeded for this model on the free tier')).toBe(true)
  })

  /**
   * Google retires a model with a 404 that reads nothing like "not found".
   * Missing that wording stopped the walk dead on the one model it should most
   * obviously have stepped over.
   */
  it('recognises a model Google has retired', () => {
    expect(looksLikeWrongModel(404,
      'This model models/gemini-2.5-flash is no longer available to new users.')).toBe(true)
    expect(looksLikeWrongModel(404, 'models/old-one is deprecated')).toBe(true)
  })

  it('walks past a whole run of models the key cannot pay for', async () => {
    // What production actually answered: every 3.x refused for billing.
    const paid = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash']
    const tried: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, _init?: { body?: string }) => {
      const target = String(url)
      if (target.includes('/models?')) {
        return jsonResponse({
          models: [...paid, 'gemini-3.8-flash-lite'].map((name) => ({
            name: `models/${name}`, supportedGenerationMethods: ['generateContent'],
          })),
        })
      }
      const model = /models\/([^:]+):/.exec(target)?.[1] ?? ''
      tried.push(model)
      if (paid.includes(model)) {
        return jsonResponse({ error: { message: 'Your prepayment credits are depleted.' } }, 402)
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"title":"T","chapters":[{"title":"One","summary":"S"}]}' }] } }] })
    }))
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox at sea' } }, res)
    expect(out.code).toBe(200)
    // A lite model is cheap and capable; excluding it left nothing to fall to.
    expect(tried[tried.length - 1]).toBe('gemini-3.8-flash-lite')
    expect(walked(tried).length).toBeGreaterThan(4)
  })

  it('keeps walking past the first ten refusals to reach one that writes', async () => {
    // A key with no credit was refused by eleven flash models in a row, and the
    // one it was allowed to use sat past where the walk used to stop.
    const paid = Array.from({ length: 12 }, (_, i) => `gemini-3.${12 - i}-flash`)
    const free = 'gemini-2.0-flash'
    const tried: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, _init?: { body?: string }) => {
      const target = String(url)
      if (target.includes('/models?')) {
        return jsonResponse({
          models: [...paid, free].map((name) => ({
            name: `models/${name}`, supportedGenerationMethods: ['generateContent'],
          })),
        })
      }
      const model = /models\/([^:]+):/.exec(target)?.[1] ?? ''
      tried.push(model)
      if (model !== free) {
        return jsonResponse({ error: { message: 'Your prepayment credits are depleted.' } }, 402)
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"title":"T","chapters":[{"title":"One","summary":"S"}]}' }] } }] })
    }))
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox at sea' } }, res)
    expect(out.code).toBe(200)
    // Twelve the key cannot pay for, then the one it can.
    expect(walked(tried).indexOf(free)).toBe(12)
    expect(tried[tried.length - 1]).toBe(free)
  })

  it('probes the key model by model and stops at the first that writes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const target = String(url)
      if (target.includes('/models?')) {
        return jsonResponse({
          models: ['gemini-3.8-flash', 'gemini-3.8-flash-lite', 'gemini-2.0-flash'].map((name) => ({
            name: `models/${name}`, supportedGenerationMethods: ['generateContent'],
          })),
        })
      }
      const model = /models\/([^:]+):/.exec(target)?.[1] ?? ''
      if (model === 'gemini-3.8-flash') {
        return jsonResponse({ error: { message: 'Your prepayment credits are depleted.' } }, 402)
      }
      if (model === 'gemini-3.8-flash-lite') {
        return jsonResponse({ error: { message: 'models/x is no longer available to new users.' } }, 404)
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: 'yes' }] } }] })
    }))
    const probe = await probeGoogleModels('a-key', new AbortController().signal)
    expect(probe.listed).toBe(3)
    expect(probe.wrote).toBe('gemini-2.0-flash')
    // The full flash model outranks a lite one, so the walk reaches the working
    // model before the retired lite one is ever asked.
    expect(probe.tried.map((t) => [t.model, t.status])).toEqual([
      ['gemini-3.8-flash', 402],
      ['gemini-2.0-flash', 200],
    ])
    expect(probe.tried[0].reason).toContain('prepayment')
    // Nothing in the answer may carry the key.
    expect(JSON.stringify(probe)).not.toContain('a-key')
  })

  it('answers a probe request without writing a story', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      asked.push(String(url))
      return String(url).includes('/models?')
        ? jsonResponse({ models: [{ name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] }] })
        : jsonResponse({ candidates: [{ content: { parts: [{ text: 'yes' }] } }] })
    }))
    const { res, out } = makeRes()
    await handler({ method: 'GET', query: { probe: 'models' } }, res)
    expect(out.code).toBe(200)
    expect((out.body as { wrote: string }).wrote).toBe('gemini-2.0-flash')
    expect(asked.some((u) => u.includes('generateContent'))).toBe(true)
  })

  it('writes a real outline when asked to prove the whole path works', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/models?')
        ? jsonResponse({ models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] })
        : jsonResponse({ candidates: [{ content: { parts: [{ text: '{"title":"The Lamp","chapters":[{"title":"One","summary":"S"},{"title":"Two","summary":"S"}]}' }] } }] })))
    const { res, out } = makeRes()
    await handler({ method: 'GET', url: '/api/generate-story?probe=write' }, res)
    expect(out.code).toBe(200)
    expect(out.body).toMatchObject({ wrote: true, title: 'The Lamp', chapters: 2, model: 'gemini-3.8-flash' })
  })

  it('reports the refusal rather than throwing when the write probe fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/models?')
        ? jsonResponse({ models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] })
        : jsonResponse({ error: { message: 'Your prepayment credits are depleted.' } }, 402)))
    const { res, out } = makeRes()
    await handler({ method: 'GET', url: '/api/generate-story?probe=write' }, res)
    expect(out.code).toBe(200)
    expect(out.body).toMatchObject({ wrote: false })
    expect(JSON.stringify(out.body)).toContain('run out of credit')
  })

  it('falls back when the model list stops answering, rather than waiting it out', async () => {
    vi.useFakeTimers()
    const asked: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (
      url: string, init?: { signal?: AbortSignal; body?: string },
    ) => {
      const target = String(url)
      if (!target.includes('/models?') && isPing(init)) return jsonResponse({ candidates: [{ content: { parts: [{ text: 'yes' }] } }] })
      asked.push(target.includes('/models?') ? 'list' : 'write')
      if (target.includes('/models?')) {
        // The list hangs: no refusal, no answer, nothing to log.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"title":"T","chapters":[{"title":"One","summary":"S"}]}' }] } }] })
    }))

    const { res, out } = makeRes()
    const handled = handler({ method: 'POST', body: { idea: 'a fox at sea' } }, res)
    await vi.advanceTimersByTimeAsync(20_000)
    await handled
    vi.useRealTimers()

    // It gave up on the list and went straight to the model it always has.
    expect(asked).toEqual(['list', 'write'])
    expect(out.code).toBe(200)
  })

  it('moves on from a model that stops answering instead of hanging', async () => {
    vi.useFakeTimers()
    const tried: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (
      url: string, init?: { signal?: AbortSignal; body?: string },
    ) => {
      const target = String(url)
      if (target.includes('/models?')) {
        return jsonResponse({
          models: ['gemini-3.8-flash', 'gemini-2.0-flash'].map((name) => ({
            name: `models/${name}`, supportedGenerationMethods: ['generateContent'],
          })),
        })
      }
      const model = /models\/([^:]+):/.exec(target)?.[1] ?? ''
      tried.push(model)
      if (model === 'gemini-3.8-flash') {
        // Never answers — exactly what an overloaded model does.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"title":"T","chapters":[{"title":"One","summary":"S"}]}' }] } }] })
    }))

    const { res, out } = makeRes()
    const handled = handler({ method: 'POST', body: { idea: 'a fox at sea' } }, res)
    await vi.advanceTimersByTimeAsync(30_000)
    await handled
    vi.useRealTimers()

    expect(walked(tried).slice(0, 2)).toEqual(['gemini-3.8-flash', 'gemini-2.0-flash'])
    expect(out.code).toBe(200)
  })

  it('says the models refused rather than that the account is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/models?')
        ? jsonResponse({
          models: ['gemini-3.8-flash', 'gemini-3.7-flash'].map((name) => ({
            name: `models/${name}`, supportedGenerationMethods: ['generateContent'],
          })),
        })
        : jsonResponse({ error: { message: 'Your prepayment credits are depleted.' } }, 402)))
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox at sea' } }, res)
    expect(errorOf(out.body).message).toContain('None of the 3 models this key can reach')
    // Google's own sentence is the only part anyone can act on, so it has to
    // survive all the way to the writer.
    expect(errorOf(out.body).message).toContain('prepayment credits are depleted')
    // An empty balance stops the free models too, so "try another" is a lie.
    expect(errorOf(out.body).message).toContain('run out of credit')
  })

  it('tells a writer to top the account up, not to wait, when the balance is the problem', () => {
    const money = refusalAdvice(4, ['Your prepayment credits are depleted.', ''])
    expect(money).toContain('run out of credit')
    expect(money).toContain('aistudio.google.com')
    expect(money).not.toMatch(/try again in a moment/i)

    const retired = refusalAdvice(2, ['models/x is no longer available to new users.'])
    expect(retired).not.toContain('credit')
    expect(retired).toContain('retired')
  })

  it('moves down the list when a model wants money the account has not got', async () => {
    const tried: string[] = []
    const fetchMock = vi.fn(async (url: string, _init?: { body?: string }) => {
      const target = String(url)
      if (target.includes('/models?')) {
        return jsonResponse({
          models: ['gemini-3.8-flash', 'gemini-2.5-flash'].map((name) => ({
            name: `models/${name}`, supportedGenerationMethods: ['generateContent'],
          })),
        })
      }
      const model = /models\/([^:]+):/.exec(target)?.[1] ?? ''
      tried.push(model)
      if (model === 'gemini-3.8-flash') {
        return jsonResponse({ error: { message: 'Your prepayment credits are depleted.' } }, 402)
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"title":"T","chapters":[{"title":"One","summary":"S"}]}' }] } }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox at sea' } }, res)
    expect(out.code).toBe(200)
    expect(walked(tried).slice(0, 2)).toEqual(['gemini-3.8-flash', 'gemini-2.5-flash'])
  })

  it('gives up with the provider’s own words when no model will do', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/models?')
        ? jsonResponse({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] })
        : jsonResponse({ error: { message: 'Your prepayment credits are depleted.' } }, 402)))
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox at sea' } }, res)
    expect(errorOf(out.body).message).toContain('prepayment credits are depleted')
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
    const bodies = fetchMock.mock.calls
      .map((c) => String((c[1] as { body?: string } | undefined)?.body ?? ''))
      .filter((b) => b.includes('a fox at sea'))
    expect(bodies.filter((b) => b.includes('responseMimeType'))).toHaveLength(1)
    expect(bodies.filter((b) => !b.includes('responseMimeType'))).toHaveLength(1)
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
    // The list, the one-word question, and the story itself: no retry on top.
    expect(fetchMock.mock.calls).toHaveLength(3)
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

describe('how hard the model is asked to think', () => {
  const original = process.env.GOOGLE_API_KEY
  beforeEach(() => { process.env.GOOGLE_API_KEY = 'test-key'; resetGoogleTextModelCache() })
  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_API_KEY
    else process.env.GOOGLE_API_KEY = original
    vi.unstubAllGlobals()
  })

  it('asks a Gemini 3 model for a level and an older one for a budget', () => {
    // The two generations take different fields, and sending both is an error.
    expect(thinkingFor('gemini-3.8-flash', true)).toEqual({ thinkingConfig: { thinkingLevel: 'low' } })
    expect(thinkingFor('gemini-2.5-flash', true)).toEqual({ thinkingConfig: { thinkingBudget: 0 } })
    expect(JSON.stringify(thinkingFor('gemini-3.8-flash', true))).not.toContain('thinkingBudget')
  })

  it('asks for nothing at all when the light touch is turned off', () => {
    expect(thinkingFor('gemini-3.8-flash', false)).toEqual({})
  })

  it('drops the thinking setting too when a model objects to the request', async () => {
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).includes('/models?')) {
        return jsonResponse({ models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] })
      }
      const body = String(init?.body ?? '')
      if (isPing(init)) return jsonResponse({ candidates: [{ content: { parts: [{ text: 'yes' }] } }] })
      bodies.push(body)
      // An older model knows neither field and says so.
      if (body.includes('thinkingConfig')) {
        return jsonResponse({ error: { message: 'Unknown name "thinkingConfig": Cannot find field.' } }, 400)
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"title":"T","chapters":[{"title":"One","summary":"S"}]}' }] } }] })
    }))

    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox at sea' } }, res)
    expect(out.code).toBe(200)
    // First try carries it, the retry does not, and the story still arrives.
    expect(bodies[0]).toContain('thinkingConfig')
    expect(bodies[1]).not.toContain('thinkingConfig')
  })
})

describe('a reply that stopped in the middle', () => {
  const original = process.env.GOOGLE_API_KEY
  beforeEach(() => { process.env.GOOGLE_API_KEY = 'test-key'; resetGoogleTextModelCache() })
  afterEach(() => {
    if (original === undefined) delete process.env.GOOGLE_API_KEY
    else process.env.GOOGLE_API_KEY = original
    vi.unstubAllGlobals()
  })

  /** What a chapter cut off at its token ceiling actually looks like. */
  const cutOff = '{"pages":[{"paragraphs":["The lamp had gone out again."]},'
    + '{"paragraphs":["She climbed the stair with the wick between her teeth."]},'
    + '{"paragraphs":["Below her the sea went on doing wha'

  it('keeps the pages that arrived whole instead of throwing the chapter away', () => {
    const parsed = parseJsonBody(cutOff) as { pages?: { paragraphs: string[] }[] }
    expect(parsed?.pages).toHaveLength(2)
    expect(parsed?.pages?.[1].paragraphs[0]).toContain('wick between her teeth')
  })

  it('rescues a plan the same way', () => {
    const parsed = parseJsonBody(
      '{"title":"The Lantern","chapters":[{"title":"One","summary":"S"},{"title":"Tw',
    ) as { title?: string; chapters?: unknown[] }
    expect(parsed?.title).toBe('The Lantern')
    expect(parsed?.chapters).toHaveLength(1)
  })

  it('invents nothing when there was never any JSON', () => {
    expect(parseJsonBody('I am sorry, I cannot write that story.')).toBeNull()
    expect(parseJsonBody('')).toBeNull()
    expect(repairTruncatedJson('{"pages":[{"para')).toBeNull()
  })

  it('leaves a reply that is already whole exactly as it is', () => {
    const whole = '{"pages":[{"paragraphs":["One."]},{"paragraphs":["Two."]}]}'
    expect(parseJsonBody(whole)).toEqual(JSON.parse(whole))
  })

  it('is not fooled by a bracket inside the writing itself', () => {
    const parsed = parseJsonBody(
      '{"pages":[{"paragraphs":["She wrote \\"}]\\" on the glass."]},{"paragraphs":["And th',
    ) as { pages?: { paragraphs: string[] }[] }
    expect(parsed?.pages).toHaveLength(1)
    expect(parsed?.pages?.[0].paragraphs[0]).toContain('on the glass')
  })

  it('says a chapter was cut off rather than blaming its shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).includes('/models?')) {
        return jsonResponse({ models: [{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] })
      }
      if (isPing(init)) return jsonResponse({ candidates: [{ content: { parts: [{ text: 'yes' }] } }] })
      // Cut off before anything at all finished, so nothing can be salvaged.
      return jsonResponse({
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"chapters":[{"title":"On' }] } }],
      })
    }))
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { idea: 'a fox at sea' } }, res)
    expect(errorOf(out.body).code).toBe('unreadable')
    expect(errorOf(out.body).message).toMatch(/ran longer than it is allowed/)
  })
})
