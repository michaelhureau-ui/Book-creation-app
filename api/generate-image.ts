import {
  buildImagePrompt, describeProviderFailure, pickSize,
  type ArtStyle, type GenerateError,
} from '../src/lib/graphic/image-prompt'

/**
 * Generates panel artwork on the server, because the image API key must never
 * reach the browser — anyone could read it out of the bundle and spend the
 * owner's credit.
 *
 * Configure by setting OPENAI_API_KEY on the Vercel project. Without it the
 * endpoint reports `not_configured` and the app explains what to add, rather
 * than failing in a way that looks like a bug.
 */

/** Minimal shapes so the function needs no extra type dependency. */
interface Req {
  method?: string
  body?: unknown
}
interface Res {
  status: (code: number) => Res
  json: (body: unknown) => void
}

const PROVIDER_URL = 'https://api.openai.com/v1/images/generations'
const MODEL = 'gpt-image-1'
/** Generation is slow; stay under Vercel's function ceiling with room to report. */
const TIMEOUT_MS = 55_000

export const config = { maxDuration: 60 }

function fail(res: Res, status: number, error: GenerateError): void {
  res.status(status).json({ error })
}

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== 'POST') {
    fail(res, 405, { code: 'provider_error', message: 'Use POST.' })
    return
  }

  const key = process.env.OPENAI_API_KEY
  if (!key) {
    fail(res, 501, {
      code: 'not_configured',
      message: 'Image generation is not switched on for this deployment yet.',
    })
    return
  }

  // The body arrives parsed on Vercel, but a string is possible behind proxies.
  let payload: { subject?: unknown; style?: unknown; aspect?: unknown }
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}) as never
  } catch {
    fail(res, 400, { code: 'empty_prompt', message: 'Could not read the request.' })
    return
  }

  const subject = typeof payload.subject === 'string' ? payload.subject : ''
  const style = (typeof payload.style === 'string' ? payload.style : 'color') as ArtStyle
  const aspect = typeof payload.aspect === 'number' ? payload.aspect : 1

  let prompt: string
  try {
    prompt = buildImagePrompt(subject, style)
  } catch {
    fail(res, 400, { code: 'empty_prompt', message: 'Describe what should be in the panel.' })
    return
  }

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(PROVIDER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        n: 1,
        size: pickSize(aspect),
      }),
      signal: abort.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      const error = describeProviderFailure(response.status, body)
      // A bad key is the deployment owner's problem, not a client error.
      fail(res, error.code === 'not_configured' ? 502 : response.status, error)
      return
    }

    const data = await response.json() as { data?: { b64_json?: string; url?: string }[] }
    const first = data?.data?.[0]

    if (first?.b64_json) {
      res.status(200).json({ image: first.b64_json, mime: 'image/png' })
      return
    }

    // Some providers hand back a URL instead of inline data; fetch it here so
    // the browser never has to reach a third-party host itself.
    if (first?.url) {
      const image = await fetch(first.url, { signal: abort.signal })
      if (!image.ok) {
        fail(res, 502, { code: 'provider_error', message: 'The generated image could not be downloaded.' })
        return
      }
      const buffer = Buffer.from(await image.arrayBuffer())
      res.status(200).json({
        image: buffer.toString('base64'),
        mime: image.headers.get('content-type') ?? 'image/png',
      })
      return
    }

    fail(res, 502, { code: 'provider_error', message: 'The image service returned no picture.' })
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    fail(res, aborted ? 504 : 502, {
      code: aborted ? 'provider_error' : 'network',
      message: aborted
        ? 'The image took too long to draw. Try a simpler description.'
        : 'Could not reach the image service.',
    })
  } finally {
    clearTimeout(timer)
  }
}
