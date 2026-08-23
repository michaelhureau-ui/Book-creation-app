import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../../api/generate-image'
import { generatePanelArt, GenerationFailed } from '@/lib/graphic/generate'

// The browser path stores through IndexedDB, which jsdom does not provide.
vi.mock('@/lib/graphic/assets', () => ({
  saveDrawing: vi.fn(async () => ({ id: 'asset-1', width: 1024, height: 1536, bytes: 3 })),
}))

const PNG_B64 = 'iVBORw0KGgo='

/** Minimal stand-in for the Vercel response object. */
function makeRes() {
  const out: { code: number; body: unknown } = { code: 0, body: null }
  const res = {
    status(code: number) { out.code = code; return res },
    json(body: unknown) { out.body = body },
  }
  return { res, out }
}

describe('generate-image endpoint', () => {
  const originalKey = process.env.OPENAI_API_KEY

  beforeEach(() => { process.env.OPENAI_API_KEY = 'test-key' })
  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalKey
    vi.unstubAllGlobals()
  })

  it('reports not_configured when no key is set, rather than failing obscurely', async () => {
    delete process.env.OPENAI_API_KEY
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { subject: 'a fox' } }, res)
    expect(out.code).toBe(501)
    expect((out.body as { error: { code: string } }).error.code).toBe('not_configured')
  })

  it('rejects anything but POST', async () => {
    const { res, out } = makeRes()
    await handler({ method: 'GET' }, res)
    expect(out.code).toBe(405)
  })

  it('rejects an empty subject before spending a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { subject: '   ' } }, res)
    expect(out.code).toBe(400)
    expect((out.body as { error: { code: string } }).error.code).toBe('empty_prompt')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the shaped prompt and a size matching the panel', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { subject: 'a red fox', style: 'noir', aspect: 0.5 } }, res)

    expect(out.code).toBe(200)
    expect(out.body).toEqual({ image: PNG_B64, mime: 'image/png' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/images/generations')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
    const sent = JSON.parse(init.body as string)
    expect(sent.prompt).toContain('a red fox')
    expect(sent.prompt).toContain('film noir')
    expect(sent.size).toBe('1024x1536')
    expect(sent.n).toBe(1)
  })

  it('parses a JSON string body, as a proxy may deliver', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), { status: 200 })))
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: JSON.stringify({ subject: 'a fox' }) }, res)
    expect(out.code).toBe(200)
  })

  it('downloads the picture itself when the provider returns a URL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: 'https://img.example/a.png' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
        status: 200, headers: { 'content-type': 'image/png' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { subject: 'a fox' } }, res)
    expect(out.code).toBe(200)
    // The browser never has to reach the third-party host itself.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((out.body as { image: string }).image).toBe(Buffer.from([1, 2, 3]).toString('base64'))
  })

  it('translates provider failures into codes the app can explain', async () => {
    const cases: [number, string, string][] = [
      [401, 'invalid key', 'not_configured'],
      [429, 'Rate limit reached', 'rate_limited'],
      [429, 'exceeded your current quota', 'quota'],
      [400, 'rejected by our safety system', 'rejected'],
      [503, 'upstream boom', 'provider_error'],
    ]
    for (const [status, body, code] of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })))
      const { res, out } = makeRes()
      await handler({ method: 'POST', body: { subject: 'a fox' } }, res)
      expect((out.body as { error: { code: string } }).error.code, `${status} ${body}`).toBe(code)
    }
  })

  it('reports a provider that answers with no picture', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })))
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { subject: 'a fox' } }, res)
    expect(out.code).toBe(502)
    expect((out.body as { error: { code: string } }).error.code).toBe('provider_error')
  })

  it('survives the provider being unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const { res, out } = makeRes()
    await handler({ method: 'POST', body: { subject: 'a fox' } }, res)
    expect(out.code).toBe(502)
    expect((out.body as { error: { code: string } }).error.code).toBe('network')
  })
})

describe('generatePanelArt (browser side)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('will not call the server for an empty subject', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(generatePanelArt('book-1', '  ', 'color', 1)).rejects.toBeInstanceOf(GenerationFailed)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stores the returned picture and hands back an asset id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ image: PNG_B64, mime: 'image/png' }), { status: 200 })))
    // jsdom never loads the blob, so this also proves measuring cannot hang.
    await expect(generatePanelArt('book-1', 'a fox', 'color', 0.8)).resolves.toBe('asset-1')
  }, 10_000)

  it('surfaces the endpoint’s error code so the UI can explain it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 'not_configured', message: 'off' } }), { status: 501 })))
    await expect(generatePanelArt('book-1', 'a fox', 'color', 1))
      .rejects.toMatchObject({ code: 'not_configured' })
  })

  it('falls back to a readable error if something else answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>gateway</html>', { status: 502 })))
    await expect(generatePanelArt('book-1', 'a fox', 'color', 1))
      .rejects.toMatchObject({ code: 'provider_error' })
  })

  it('recognises a build with no endpoint rather than blaming the image service', async () => {
    // Vercel answers a missing route with its own 404 page, not our JSON.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('The page could not be found', { status: 404 })))
    const failure = await generatePanelArt('book-1', 'a fox', 'color', 1).catch((e) => e)
    expect(failure.code).toBe('stale_build')
    expect(failure.message).toMatch(/built before/i)
    expect(failure.message).not.toMatch(/image service failed/i)
  })

  it('still trusts our own error body on a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 'rejected', message: 'no' } }), { status: 404 })))
    await expect(generatePanelArt('book-1', 'a fox', 'color', 1))
      .rejects.toMatchObject({ code: 'rejected' })
  })

  it('reports a network failure distinctly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(generatePanelArt('book-1', 'a fox', 'color', 1))
      .rejects.toMatchObject({ code: 'network' })
  })
})
