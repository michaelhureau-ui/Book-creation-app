/**
 * Generates panel artwork on the server, because the image API key must never
 * reach the browser — anyone could read it out of the bundle and spend the
 * owner's credit.
 *
 * Configure by setting OPENAI_API_KEY on the Vercel project. Without it the
 * endpoint reports `not_configured` and the app explains what to add, rather
 * than failing in a way that looks like a bug.
 *
 * This file is deliberately self-contained: Vercel compiles it to ESM without
 * bundling, so an import reaching outside `api/` is not resolvable at runtime.
 * `styleIds` below is checked against the app's style list by a unit test, so
 * the two cannot drift apart.
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

export interface GenerateError {
  code:
    | 'not_configured' | 'empty_prompt' | 'rejected'
    | 'rate_limited' | 'quota' | 'provider_error' | 'network'
  message: string
}

/** How each art style is described to the image model. */
export const STYLE_MODIFIERS: Record<string, string> = {
  color: 'comic book panel art, bold clean ink outlines, flat cel shading, vivid colour',
  ink: 'black and white comic panel, brush and ink line art, crosshatched shadows, high contrast, no colour',
  noir: 'film noir comic panel, heavy black shadows, dramatic single light source, muted desaturated palette',
  manga: 'manga panel, screentone shading, expressive linework, black and white',
  watercolour: 'watercolour illustration, soft washes, visible paper texture, gentle palette',
  retro: 'vintage 1960s comic panel, halftone dot shading, limited four-colour palette, slight print misregistration',
}

export const MAX_SUBJECT_LENGTH = 300

export function cleanSubject(subject: string): string {
  return subject.replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT_LENGTH)
}

/**
 * A bare noun like "fox" produces a stock photo from most models. Naming the
 * medium and framing first is what makes the result usable as a comic panel.
 */
export function buildImagePrompt(subject: string, style: string): string {
  const cleaned = cleanSubject(subject)
  if (!cleaned) throw new Error('Describe what should be in the panel.')
  const modifiers = STYLE_MODIFIERS[style] ?? STYLE_MODIFIERS.color
  return `${cleaned}. ${modifiers}. Single illustration filling the frame, no panel borders, no speech bubbles, no lettering or text anywhere in the image.`
}

export const SUPPORTED_SIZES = ['1024x1024', '1024x1536', '1536x1024'] as const

/**
 * Pick whichever supported size is closest in shape to the panel, so the
 * artwork is cropped as little as possible when it lands in the frame.
 */
export function pickSize(aspect: number): string {
  if (!Number.isFinite(aspect) || aspect <= 0) return '1024x1024'
  let best: string = SUPPORTED_SIZES[0]
  let bestDistance = Infinity
  for (const size of SUPPORTED_SIZES) {
    const [w, h] = size.split('x').map(Number)
    // Compare in log space so 2:1 and 1:2 are treated as equally far from 1:1.
    const distance = Math.abs(Math.log(w / h) - Math.log(aspect))
    if (distance < bestDistance) {
      bestDistance = distance
      best = size
    }
  }
  return best
}

/** Turn a provider's HTTP failure into something worth showing a writer. */
export function describeProviderFailure(status: number, body: string): GenerateError {
  const lower = body.toLowerCase()
  // Google answers a bad or unauthorised key with 400, not 401.
  if (lower.includes('api key not valid') || lower.includes('api_key_invalid') ||
      lower.includes('permission_denied') || lower.includes('has not been used in project')) {
    return { code: 'not_configured', message: 'The image service rejected the API key. Check the key set on the deployment.' }
  }
  if (lower.includes('resource_exhausted') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return lower.includes('quota') || lower.includes('billing')
      ? { code: 'quota', message: 'The image account is out of credit or has hit its free allowance. Check the provider.' }
      : { code: 'rate_limited', message: 'Too many images at once. Wait a moment and try again.' }
  }
  if (status === 401 || status === 403) {
    return { code: 'not_configured', message: 'The image service rejected the API key. Check the key set on the deployment.' }
  }
  if (status === 429) {
    if (lower.includes('quota') || lower.includes('billing') || lower.includes('insufficient')) {
      return { code: 'quota', message: 'The image account is out of credit. Top it up to keep generating.' }
    }
    return { code: 'rate_limited', message: 'Too many images at once. Wait a moment and try again.' }
  }
  if (
    lower.includes('safety') || lower.includes('content_policy') ||
    lower.includes('content policy') || lower.includes('moderation')
  ) {
    return { code: 'rejected', message: 'The image service would not draw that. Try describing it differently.' }
  }
  return { code: 'provider_error', message: `The image service failed (${status}). Try again in a moment.` }
}

// ── Google (AI Studio / Gemini) ───────────────────────────────────────────────

/** Aspect ratios Google's image models accept, as width:height. */
export const GOOGLE_RATIOS: [string, number][] = [
  ['1:1', 1], ['3:4', 3 / 4], ['4:3', 4 / 3], ['9:16', 9 / 16], ['16:9', 16 / 9],
]

/** Nearest supported ratio to the panel, compared in log space. */
export function pickGoogleRatio(aspect: number): string {
  if (!Number.isFinite(aspect) || aspect <= 0) return '1:1'
  let best = '1:1'
  let bestDistance = Infinity
  for (const [name, value] of GOOGLE_RATIOS) {
    const distance = Math.abs(Math.log(value) - Math.log(aspect))
    if (distance < bestDistance) { bestDistance = distance; best = name }
  }
  return best
}

interface GoogleModel {
  name?: string
  supportedGenerationMethods?: string[]
}

/**
 * Pick an image model from Google's own model list rather than hardcoding a
 * name. Model ids change; this keeps working when they do, and a deployment
 * can still pin one with GOOGLE_IMAGE_MODEL.
 *
 * A model is taken only when Google says it supports the call this endpoint
 * makes. The list carries models that cannot be used this way at all, and
 * assuming capability when the list is silent is how one gets picked — a text
 * endpoint once chose an omni model that answers "This model only supports
 * Interactions API".
 */
export function chooseGoogleModel(models: GoogleModel[]): string | null {
  const usable = models
    .filter((m) => {
      const methods = m.supportedGenerationMethods ?? []
      return methods.includes('predict') || methods.includes('generateContent')
    })
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter((name) => /imagen|image/i.test(name))
    // A model that only edits or upscales cannot generate from a prompt alone,
    // and a conversational or speech variant is not an image model at all.
    .filter((name) => !/edit|upscale|segment|embedding|omni|live|tts|audio|robotics/i.test(name))
  if (usable.length === 0) return null
  // Prefer a dedicated Imagen model, then the newest-looking name.
  const imagen = usable.filter((n) => /imagen/i.test(n))
  const pool = imagen.length > 0 ? imagen : usable
  return pool.sort().reverse()[0]
}

/** Both response shapes Google uses: Imagen `:predict` and Gemini inline data. */
export function extractGoogleImage(body: unknown): { data: string; mime: string } | null {
  const json = body as {
    predictions?: { bytesBase64Encoded?: string; mimeType?: string }[]
    candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[]
  }

  const prediction = json?.predictions?.find((p) => p?.bytesBase64Encoded)
  if (prediction?.bytesBase64Encoded) {
    return { data: prediction.bytesBase64Encoded, mime: prediction.mimeType || 'image/png' }
  }

  for (const candidate of json?.candidates ?? []) {
    for (const part of candidate?.content?.parts ?? []) {
      if (part?.inlineData?.data) {
        return { data: part.inlineData.data, mime: part.inlineData.mimeType || 'image/png' }
      }
    }
  }
  return null
}

const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta'
/** Used only if the model list cannot be read. */
const GOOGLE_FALLBACK_MODEL = 'imagen-3.0-generate-002'
/** Model choice is stable for the life of a warm lambda. */
let cachedGoogleModel: string | null = null

/** Clears the memoised model choice. Exposed so tests start from a clean slate. */
export function resetGoogleModelCache(): void {
  cachedGoogleModel = null
}

async function resolveGoogleModel(key: string, signal: AbortSignal): Promise<string> {
  if (process.env.GOOGLE_IMAGE_MODEL) return process.env.GOOGLE_IMAGE_MODEL
  if (cachedGoogleModel) return cachedGoogleModel
  try {
    const res = await fetch(`${GOOGLE_BASE}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': key },
      signal,
    })
    if (res.ok) {
      const body = await res.json() as { models?: GoogleModel[] }
      const chosen = chooseGoogleModel(body.models ?? [])
      if (chosen) { cachedGoogleModel = chosen; return chosen }
    }
  } catch { /* fall through to the default */ }
  return GOOGLE_FALLBACK_MODEL
}

async function generateWithGoogle(
  key: string, prompt: string, aspect: number, signal: AbortSignal,
): Promise<{ ok: true; image: string; mime: string } | { ok: false; status: number; error: GenerateError }> {
  const model = await resolveGoogleModel(key, signal)
  const ratio = pickGoogleRatio(aspect)
  const imagen = /imagen/i.test(model)

  const url = `${GOOGLE_BASE}/models/${model}:${imagen ? 'predict' : 'generateContent'}`
  const payload = imagen
    ? { instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: ratio } }
    : {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ratio } },
    }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: describeProviderFailure(res.status, body) }
  }

  const image = extractGoogleImage(await res.json().catch(() => null))
  if (!image) {
    // A refusal comes back as a 200 with no image, so say what happened rather
    // than letting it be flattened into a generic provider error.
    return {
      ok: false,
      status: 502,
      error: {
        code: 'rejected',
        message: 'The image service returned no picture — it may have declined that description. Try wording it differently.',
      },
    }
  }
  return { ok: true, image: image.data, mime: image.mime }
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
  // Whichever key the deployment has decides the provider.
  const googleKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  const provider = googleKey ? 'google' : openaiKey ? 'openai' : null

  // A GET reports whether a key reached this deployment. Setting an
  // environment variable on the wrong project — or on one that has not been
  // rebuilt since — is otherwise invisible and easy to mistake for a bug in
  // the app. No key material is exposed, only whether one is present.
  if (req.method === 'GET') {
    res.status(200).json({
      configured: provider !== null,
      provider,
      looksFor: ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'],
      model: process.env.GOOGLE_IMAGE_MODEL || null,
    })
    return
  }

  if (req.method !== 'POST') {
    fail(res, 405, { code: 'provider_error', message: 'Use POST.' })
    return
  }
  if (!googleKey && !openaiKey) {
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
  const style = typeof payload.style === 'string' ? payload.style : 'color'
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
    if (googleKey) {
      const result = await generateWithGoogle(googleKey, prompt, aspect, abort.signal)
      if (result.ok) {
        res.status(200).json({ image: result.image, mime: result.mime })
      } else {
        // A bad key is the deployment owner's problem, not a client error.
        fail(res, result.error.code === 'not_configured' ? 502 : result.status, result.error)
      }
      return
    }

    const response = await fetch(PROVIDER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: MODEL, prompt, n: 1, size: pickSize(aspect) }),
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
