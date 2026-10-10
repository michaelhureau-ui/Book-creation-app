/**
 * Looks at a drawn panel and says where the people in it are.
 *
 * Fitting lettering needs one fact the app cannot work out for itself: which
 * part of the picture is the person speaking. Edge detection does not know —
 * on painted artwork a smooth cheek measures quieter than a brick wall, so the
 * "quiet spot" it finds is as likely to be a face as the sky. A model that can
 * actually see the panel does know, so the app asks it.
 *
 * Configure by setting GOOGLE_API_KEY (or GEMINI_API_KEY) on the Vercel
 * project — the same key the picture service uses. Without it the endpoint
 * reports `not_configured` and the app falls back to its own guess rather than
 * failing.
 *
 * This file is deliberately self-contained: Vercel compiles it to ESM without
 * bundling, so an import reaching outside `api/` is not resolvable at runtime.
 */

interface Req {
  method?: string
  body?: unknown
  query?: Record<string, string | string[] | undefined>
  url?: string
}
interface Res {
  status: (code: number) => Res
  json: (body: unknown) => void
}

export interface SeeError {
  code: 'not_configured' | 'empty' | 'provider_error' | 'network' | 'unreadable'
  message: string
}

/** Where somebody is in the panel, in fractions of its width and height. */
export interface Spot {
  name: string
  x: number
  y: number
}

export interface Seen {
  /** The characters that were asked about and found, by the name given. */
  people: Spot[]
  /** Every face in the panel, named or not, for lettering to keep clear of. */
  faces: { x: number; y: number }[]
}

export const MAX_NAMES = 8
export const MAX_NOTE = 400

/** Keep a fraction inside the panel, and treat nonsense as the middle. */
export function fraction(value: unknown, fallback = 0.5): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  // A model asked for fractions sometimes answers in percent, or in pixels of
  // the image it was shown. Both are recoverable; silence is not.
  const scaled = n > 1 && n <= 100 ? n / 100 : n > 100 ? n / 1000 : n
  return Math.min(0.98, Math.max(0.02, scaled))
}

export function buildSeePrompt(names: string[], note: string): string {
  const who = names.length > 0
    ? `The characters that speak in this panel are: ${names.join(', ')}.`
    : 'No character names were given.'
  const brief = note ? `\nThe panel was drawn from this description: ${note}` : ''
  return [
    'You are looking at one panel of a comic page.',
    who,
    brief,
    '',
    'Answer with JSON only, in this exact shape:',
    '{"people":[{"name":"<one of the names above>","x":0.0,"y":0.0}],"faces":[{"x":0.0,"y":0.0}]}',
    '',
    'For each named character you can see, give the centre of their head.',
    'Leave a character out of "people" entirely if they are not visible.',
    'List the centre of every face you can see in "faces", including faces of',
    'characters that were not named.',
    'x and y are fractions of the picture: x 0 is the left edge, x 1 the right',
    'edge, y 0 the top, y 1 the bottom. Use decimals, not percentages or pixels.',
    'Do not guess at a character you cannot see. An empty list is a fine answer.',
  ].join('\n')
}

/** Pull the JSON out of whatever wrapping the model put around it. */
export function readSeen(text: string, names: string[]): Seen {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = trimmed.search(/[[{]/)
  if (start < 0) throw new Error('no JSON in the answer')
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice(start))
  } catch {
    throw new Error('the answer was not JSON')
  }

  const body = (parsed ?? {}) as { people?: unknown; faces?: unknown }
  const wanted = new Map(names.map((n) => [n.trim().toLowerCase(), n]))

  const people: Spot[] = Array.isArray(body.people)
    ? body.people.flatMap((row) => {
      const item = (row ?? {}) as { name?: unknown; x?: unknown; y?: unknown }
      const said = typeof item.name === 'string' ? item.name.trim().toLowerCase() : ''
      // Only names that were asked about: a model that invents a character
      // would otherwise have the app aim a tail at nobody.
      const name = wanted.get(said)
      if (!name) return []
      return [{ name, x: fraction(item.x), y: fraction(item.y) }]
    })
    : []

  const faces = Array.isArray(body.faces)
    ? body.faces.flatMap((row) => {
      const item = (row ?? {}) as { x?: unknown; y?: unknown }
      if (item.x === undefined && item.y === undefined) return []
      return [{ x: fraction(item.x), y: fraction(item.y) }]
    })
    : []

  // One entry per character, the first time it is named.
  const once = new Map<string, Spot>()
  for (const person of people) if (!once.has(person.name)) once.set(person.name, person)
  return { people: [...once.values()], faces }
}

interface GoogleModel {
  name?: string
  supportedGenerationMethods?: string[]
}

/**
 * Pick a model that can both look at a picture and answer in words.
 *
 * Google's own list is the source rather than a hardcoded id, because ids are
 * retired; a deployment can still pin one with GOOGLE_VISION_MODEL.
 */
export function chooseVisionModel(models: GoogleModel[]): string | null {
  const usable = models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter((name) => /gemini/i.test(name))
    // An image, speech or embedding variant cannot answer a question about a
    // picture, whatever the list says it supports.
    .filter((name) => !/image|imagen|tts|audio|embedding|live|robotics|gemma/i.test(name))
  if (usable.length === 0) return null
  // Flash is the right tool here: this is one small question per panel, asked
  // a hundred times for a book, so cheap and quick beats clever.
  const flash = usable.filter((n) => /flash/i.test(n) && !/thinking/i.test(n))
  const pool = flash.length > 0 ? flash : usable
  return pool.sort().reverse()[0]
}

const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const GOOGLE_FALLBACK_MODEL = 'gemini-flash-latest'
const LIST_MS = 8_000
const LOOK_MS = 25_000

let cachedModel: string | null = null

export function resetVisionModelCache(): void {
  cachedModel = null
}

async function fetchWithin(
  url: string, init: RequestInit, ms: number, outer: AbortSignal,
): Promise<Response> {
  const abort = new AbortController()
  const stop = () => abort.abort()
  outer.addEventListener('abort', stop)
  const timer = setTimeout(stop, ms)
  try {
    return await fetch(url, { ...init, signal: abort.signal })
  } finally {
    clearTimeout(timer)
    outer.removeEventListener('abort', stop)
  }
}

export async function resolveVisionModel(key: string, signal: AbortSignal): Promise<string> {
  if (process.env.GOOGLE_VISION_MODEL) return process.env.GOOGLE_VISION_MODEL
  if (cachedModel) return cachedModel
  try {
    const res = await fetchWithin(
      `${GOOGLE_BASE}/models?key=${encodeURIComponent(key)}&pageSize=200`,
      {}, LIST_MS, signal,
    )
    if (res.ok) {
      const json = await res.json() as { models?: GoogleModel[] }
      const chosen = chooseVisionModel(json.models ?? [])
      if (chosen) { cachedModel = chosen; return chosen }
    }
  } catch { /* the list is a convenience; the fallback still works */ }
  return GOOGLE_FALLBACK_MODEL
}

/** The model's own text, wherever in the response shape it ended up. */
export function extractText(body: unknown): string {
  const json = body as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const parts = json?.candidates?.[0]?.content?.parts ?? []
  return parts.map((p) => p?.text ?? '').join('').trim()
}

export async function lookWithGoogle(
  key: string,
  image: { data: string; mime: string },
  names: string[],
  note: string,
  signal: AbortSignal,
): Promise<{ ok: true; seen: Seen; model: string } | { ok: false; status: number; error: SeeError }> {
  const model = await resolveVisionModel(key, signal)
  const url = `${GOOGLE_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`

  // Thinking is wrong for this: the answer is a glance, and the tokens are the
  // whole latency. Gemini 3 takes a level, 2.5 takes a budget, and sending
  // both is an error, so the model's own generation decides which.
  const thinking = /gemini-3|gemini-[4-9]/.test(model)
    ? { thinkingLevel: 'low' }
    : { thinkingBudget: 0 }

  let res: Response
  try {
    res = await fetchWithin(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: image.mime, data: image.data } },
            { text: buildSeePrompt(names, note) },
          ],
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 900,
          responseMimeType: 'application/json',
          thinkingConfig: thinking,
        },
      }),
    }, LOOK_MS, signal)
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: {
        code: 'network',
        message: err instanceof Error && err.name === 'AbortError'
          ? 'Looking at the panel took too long.'
          : 'Could not reach the picture service.',
      },
    }
  }

  const text = await res.text()
  if (!res.ok) {
    console.error('see-panel: provider refused', res.status, text.slice(0, 500))
    return {
      ok: false,
      status: res.status === 429 ? 429 : 502,
      error: {
        code: 'provider_error',
        message: `The picture service answered ${res.status}.`,
      },
    }
  }

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return { ok: false, status: 502, error: { code: 'unreadable', message: 'The answer was not readable.' } }
  }

  try {
    return { ok: true, seen: readSeen(extractText(body), names), model }
  } catch (err) {
    console.error('see-panel: unreadable answer', err instanceof Error ? err.message : err, text.slice(0, 500))
    return {
      ok: false,
      status: 502,
      error: { code: 'unreadable', message: 'The picture service did not answer in a shape the app could read.' },
    }
  }
}

export const config = { maxDuration: 30 }

function fail(res: Res, status: number, error: SeeError): void {
  res.status(status).json({ error })
}

export default async function handler(req: Req, res: Res): Promise<void> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY

  if (req.method === 'GET') {
    res.status(200).json({
      configured: Boolean(key),
      looksFor: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
      model: process.env.GOOGLE_VISION_MODEL || null,
    })
    return
  }

  if (req.method !== 'POST') {
    fail(res, 405, { code: 'provider_error', message: 'Use POST.' })
    return
  }
  if (!key) {
    fail(res, 501, {
      code: 'not_configured',
      message: 'Looking at the pictures is not switched on for this deployment yet.',
    })
    return
  }

  let payload: { image?: unknown; mime?: unknown; names?: unknown; note?: unknown }
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}) as never
  } catch {
    fail(res, 400, { code: 'empty', message: 'Could not read the request.' })
    return
  }

  const raw = typeof payload.image === 'string' ? payload.image : ''
  // A data URL is what a canvas hands over; the provider wants the bytes only.
  const image = raw.replace(/^data:[^;,]*;base64,/, '')
  if (!image) {
    fail(res, 400, { code: 'empty', message: 'There was no picture to look at.' })
    return
  }
  const mime = typeof payload.mime === 'string' && /^image\//.test(payload.mime)
    ? payload.mime
    : /^data:(image\/[a-z+]+)/.exec(raw)?.[1] ?? 'image/jpeg'
  const names = Array.isArray(payload.names)
    ? payload.names
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      .map((n) => n.trim().slice(0, 60))
      .slice(0, MAX_NAMES)
    : []
  const note = typeof payload.note === 'string' ? payload.note.slice(0, MAX_NOTE) : ''

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), LOOK_MS + 2_000)
  try {
    const looked = await lookWithGoogle(key, { data: image, mime }, names, note, abort.signal)
    if (!looked.ok) {
      fail(res, looked.status, looked.error)
      return
    }
    res.status(200).json(looked.seen)
  } catch (err) {
    console.error('see-panel: failed', err)
    fail(res, 502, {
      code: 'network',
      message: err instanceof Error ? err.message : 'Looking at the panel failed.',
    })
  } finally {
    clearTimeout(timer)
  }
}
