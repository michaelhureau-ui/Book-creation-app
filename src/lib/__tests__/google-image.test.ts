import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, {
  chooseGoogleModel, describeProviderFailure, extractGoogleImage,
  GOOGLE_RATIOS, pickGoogleRatio, resetGoogleModelCache,
} from '../../../api/generate-image'

const PNG_B64 = 'iVBORw0KGgo='

function makeRes() {
  const out: { code: number; body: unknown } = { code: 0, body: null }
  const res = {
    status(code: number) { out.code = code; return res },
    json(body: unknown) { out.body = body },
  }
  return { res, out }
}

describe('pickGoogleRatio', () => {
  it('always returns a ratio Google accepts', () => {
    const names = GOOGLE_RATIOS.map(([n]) => n)
    for (const aspect of [0.1, 0.5, 0.75, 1, 1.33, 2, 9]) {
      expect(names).toContain(pickGoogleRatio(aspect))
    }
  })

  it('matches the panel shape', () => {
    expect(pickGoogleRatio(1)).toBe('1:1')
    expect(pickGoogleRatio(0.75)).toBe('3:4')
    expect(pickGoogleRatio(4 / 3)).toBe('4:3')
    expect(pickGoogleRatio(0.5)).toBe('9:16')
    expect(pickGoogleRatio(1.9)).toBe('16:9')
  })

  it('falls back to square for a degenerate aspect', () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pickGoogleRatio(bad)).toBe('1:1')
    }
  })
})

describe('chooseGoogleModel', () => {
  /** Google's list says what each model can actually be asked to do. */
  const predicts = (name: string) => ({ name: `models/${name}`, supportedGenerationMethods: ['predict'] })
  const generates = (name: string) => ({ name: `models/${name}`, supportedGenerationMethods: ['generateContent'] })

  it('prefers a dedicated image model over a text one', () => {
    expect(chooseGoogleModel([
      generates('gemini-2.5-flash'),
      predicts('imagen-3.0-generate-002'),
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ])).toBe('imagen-3.0-generate-002')
  })

  it('picks the newest-looking imagen when several exist', () => {
    expect(chooseGoogleModel([
      predicts('imagen-3.0-generate-001'),
      predicts('imagen-4.0-generate-001'),
      predicts('imagen-3.0-generate-002'),
    ])).toBe('imagen-4.0-generate-001')
  })

  it('accepts a gemini image model when no imagen is offered', () => {
    expect(chooseGoogleModel([
      generates('gemini-2.5-flash'),
      generates('gemini-2.5-flash-image'),
    ])).toBe('gemini-2.5-flash-image')
  })

  it('ignores models that only edit or embed', () => {
    expect(chooseGoogleModel([
      predicts('imagen-3.0-capability-edit'),
      predicts('image-upscale-001'),
      { name: 'models/multimodal-embedding', supportedGenerationMethods: ['embedContent'] },
    ])).toBeNull()
  })

  /**
   * The list carries models that cannot serve this endpoint at all. Taking one
   * on the strength of its name is how the story endpoint once chose an omni
   * model, which answers "This model only supports Interactions API".
   */
  it('will not take a model Google does not say can do this', () => {
    expect(chooseGoogleModel([{ name: 'models/imagen-4.0-generate-001' }])).toBeNull()
    expect(chooseGoogleModel([
      { name: 'models/gemini-omni-flash-image-preview', supportedGenerationMethods: ['bidiGenerateContent'] },
    ])).toBeNull()
  })

  it('reports nothing when the list has no image model at all', () => {
    expect(chooseGoogleModel([generates('gemini-2.5-pro')])).toBeNull()
    expect(chooseGoogleModel([])).toBeNull()
  })
})

describe('extractGoogleImage', () => {
  it('reads the Imagen predict shape', () => {
    expect(extractGoogleImage({
      predictions: [{ bytesBase64Encoded: PNG_B64, mimeType: 'image/png' }],
    })).toEqual({ data: PNG_B64, mime: 'image/png' })
  })

  it('reads the Gemini inline-data shape', () => {
    expect(extractGoogleImage({
      candidates: [{ content: { parts: [
        { text: 'here you go' },
        { inlineData: { data: PNG_B64, mimeType: 'image/jpeg' } },
      ] } }],
    })).toEqual({ data: PNG_B64, mime: 'image/jpeg' })
  })

  it('defaults the mime type when it is missing', () => {
    expect(extractGoogleImage({ predictions: [{ bytesBase64Encoded: PNG_B64 }] }))
      .toEqual({ data: PNG_B64, mime: 'image/png' })
  })

  it('reports nothing for a response carrying no image', () => {
    for (const body of [
      null, {}, { predictions: [] }, { predictions: [{}] },
      { candidates: [{ content: { parts: [{ text: 'I cannot draw that' }] } }] },
      { candidates: [{}] },
    ]) {
      expect(extractGoogleImage(body)).toBeNull()
    }
  })
})

describe('describeProviderFailure — Google wording', () => {
  it('recognises Google reporting a bad key with a 400', () => {
    expect(describeProviderFailure(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}').code)
      .toBe('not_configured')
  })

  it('separates the free allowance running out from plain rate limiting', () => {
    expect(describeProviderFailure(429, 'RESOURCE_EXHAUSTED: Quota exceeded').code).toBe('quota')
    expect(describeProviderFailure(429, 'RESOURCE_EXHAUSTED: too many requests').code).toBe('rate_limited')
  })
})

describe('the endpoint using a Google key', () => {
  const saved = { ...process.env }

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.GOOGLE_IMAGE_MODEL
    process.env.GOOGLE_API_KEY = 'google-test-key'
    // The chosen model is memoised for warm lambdas; each test starts fresh.
    resetGoogleModelCache()
  })
  afterEach(() => {
    process.env = { ...saved }
    vi.unstubAllGlobals()
  })

  it('discovers a model, then asks for a picture at the panel ratio', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/imagen-3.0-generate-002' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        predictions: [{ bytesBase64Encoded: PNG_B64, mimeType: 'image/png' }],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { subject: 'a red fox', style: 'noir', aspect: 0.75 } }, res)

    expect(out.code).toBe(200)
    expect(out.body).toEqual({ image: PNG_B64, mime: 'image/png' })

    const [listUrl, listInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(listUrl).toContain('/models')
    expect((listInit.headers as Record<string, string>)['x-goog-api-key']).toBe('google-test-key')

    const [genUrl, genInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(genUrl).toContain('imagen-3.0-generate-002:predict')
    const sent = JSON.parse(genInit.body as string)
    expect(sent.instances[0].prompt).toContain('a red fox')
    expect(sent.instances[0].prompt).toContain('film noir')
    expect(sent.parameters.aspectRatio).toBe('3:4')
  })

  it('uses generateContent for a gemini image model', async () => {
    process.env.GOOGLE_IMAGE_MODEL = 'gemini-2.5-flash-image'
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { data: PNG_B64, mimeType: 'image/png' } }] } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { subject: 'a fox', aspect: 1 } }, res)

    expect(out.code).toBe(200)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    // A pinned model skips discovery entirely.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(url).toContain('gemini-2.5-flash-image:generateContent')
    expect(JSON.parse(init.body as string).contents[0].parts[0].text).toContain('a fox')
  })

  it('still generates when the model list cannot be read', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        predictions: [{ bytesBase64Encoded: PNG_B64 }],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { subject: 'a fox' } }, res)
    expect(out.code).toBe(200)
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toContain('imagen')
  })

  it('explains a 200 that carries no picture instead of hanging', async () => {
    process.env.GOOGLE_IMAGE_MODEL = 'imagen-test'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'I will not draw that' }] } }],
    }), { status: 200 })))

    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { subject: 'a fox' } }, res)
    expect(out.code).toBe(502)
    const error = (out.body as { error: { code: string; message: string } }).error
    expect(error.code).toBe('rejected')
    expect(error.message).toMatch(/no picture/i)
  })

  it('passes a bad Google key through as not_configured', async () => {
    process.env.GOOGLE_IMAGE_MODEL = 'imagen-test'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '{"error":{"message":"API key not valid."}}', { status: 400 })))

    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { subject: 'a fox' } }, res)
    expect((out.body as { error: { code: string } }).error.code).toBe('not_configured')
  })

  it('draws one picture on demand so the key can be checked without opening a book', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/models?')
        ? new Response(JSON.stringify({
          models: [{ name: 'models/imagen-4.0-generate', supportedGenerationMethods: ['predict'] }],
        }), { status: 200 })
        : new Response(JSON.stringify({
          predictions: [{ bytesBase64Encoded: PNG_B64, mimeType: 'image/png' }],
        }), { status: 200 })))

    const { res, out } = makeRes()
    await handler({ method: 'GET', url: '/api/generate-image?probe=draw' }, res)
    expect(out.code).toBe(200)
    expect(out.body).toMatchObject({ drew: true, model: 'imagen-4.0-generate' })
    // The picture itself is thrown away; only its size is reported.
    expect(JSON.stringify(out.body)).not.toContain(PNG_B64)
  })

  it('reports why the drawing probe failed instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).includes('/models?')
        ? new Response(JSON.stringify({
          models: [{ name: 'models/imagen-4.0-generate', supportedGenerationMethods: ['predict'] }],
        }), { status: 200 })
        : new Response('{"error":{"message":"Your prepayment credits are depleted."}}', { status: 402 })))

    const { res, out } = makeRes()
    await handler({ method: 'GET', url: '/api/generate-image?probe=draw' }, res)
    expect(out.code).toBe(200)
    expect(out.body).toMatchObject({ drew: false })
  })

  it('says generation is off when neither key is set', async () => {
    delete process.env.GOOGLE_API_KEY
    delete process.env.GEMINI_API_KEY
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { subject: 'a fox' } }, res)
    expect(out.code).toBe(501)
    expect((out.body as { error: { code: string } }).error.code).toBe('not_configured')
  })
})
