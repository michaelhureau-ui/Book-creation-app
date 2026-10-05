/**
 * Writes a story on the server, for the same reason pictures are drawn there:
 * the API key must never reach the browser.
 *
 * A whole book does not fit comfortably in one model call — it is slow enough
 * to hit the function's ceiling, and one enormous response is the easiest kind
 * to have truncated. So the work comes in two stages the client drives: an
 * outline first, then one call per chapter. That also gives the app something
 * honest to show a progress bar for.
 *
 * This file is deliberately self-contained: Vercel compiles it to ESM without
 * bundling, so an import reaching outside `api/` is not resolvable at runtime.
 * The pieces it shares with generate-image.ts are duplicated on purpose, and a
 * unit test holds the two copies to the same behaviour.
 */

interface Req {
  method?: string
  body?: unknown
}
interface Res {
  status: (code: number) => Res
  json: (body: unknown) => void
}

export interface StoryError {
  code:
    | 'not_configured' | 'empty_idea' | 'rejected'
    | 'rate_limited' | 'quota' | 'provider_error' | 'network' | 'unreadable'
  message: string
}

export type StoryKind = 'prose' | 'graphic'
export type StoryLength = 'short' | 'medium' | 'long'

/** How much book each length asks for. Kept modest: a slow call is a dead one. */
export const SHAPES: Record<StoryKind, Record<StoryLength, { chapters: number; pages: number }>> = {
  prose: {
    short: { chapters: 3, pages: 2 },
    medium: { chapters: 5, pages: 3 },
    long: { chapters: 8, pages: 3 },
  },
  graphic: {
    short: { chapters: 1, pages: 4 },
    medium: { chapters: 2, pages: 5 },
    long: { chapters: 3, pages: 6 },
  },
}

export const MAX_IDEA_LENGTH = 1200

export function cleanIdea(idea: string): string {
  return idea.replace(/\s+/g, ' ').trim().slice(0, MAX_IDEA_LENGTH)
}

/** Who the book is for. The model is told plainly; it shapes vocabulary too. */
export const AUDIENCES: Record<string, string> = {
  children: 'children aged about 6 to 9. Simple sentences, warm and playful, nothing frightening or upsetting',
  middle: 'readers aged about 9 to 13. Clear writing with real stakes, but nothing graphic or adult',
  teen: 'teenage readers. Real feeling and consequence, but no explicit content',
  adult: 'adult readers',
}

export function audienceNote(audience: string): string {
  return AUDIENCES[audience] ?? AUDIENCES.middle
}

function shapeOf(kind: StoryKind, length: StoryLength): { chapters: number; pages: number } {
  return SHAPES[kind][length] ?? SHAPES[kind].medium
}

export function buildOutlinePrompt(
  idea: string, kind: StoryKind, length: StoryLength, audience: string,
): string {
  const cleaned = cleanIdea(idea)
  if (!cleaned) throw new Error('Say what the story is about.')
  const shape = shapeOf(kind, length)
  const form = kind === 'graphic' ? 'graphic novel' : 'novel'
  return [
    `Plan a ${form} from this idea: "${cleaned}".`,
    `Write it for ${audienceNote(audience)}.`,
    `Plan exactly ${shape.chapters} ${shape.chapters === 1 ? 'chapter' : 'chapters'}.`,
    'Give the book a real title — not the idea repeated back — and a short subtitle.',
    'Each chapter needs a title and two or three sentences saying what happens in it,',
    'including how it ends, so the chapters can be written separately and still join up.',
    'Name the main characters in the first chapter summary and keep those names afterwards.',
    'Reply with JSON only, no prose around it, in exactly this shape:',
    '{"title":"","subtitle":"","chapters":[{"title":"","summary":""}]}',
  ].join(' ')
}

export function buildChapterPrompt(
  idea: string,
  kind: StoryKind,
  length: StoryLength,
  audience: string,
  outline: { title?: string; chapters?: { title?: string; summary?: string }[] },
  index: number,
): string {
  const shape = shapeOf(kind, length)
  const chapters = outline.chapters ?? []
  const here = chapters[index] ?? {}
  const story = [
    `The book is "${outline.title ?? 'Untitled'}", from the idea: "${cleanIdea(idea)}".`,
    `Write it for ${audienceNote(audience)}.`,
    'The whole plan is:',
    chapters.map((c, i) => `${i + 1}. ${c.title ?? ''} — ${c.summary ?? ''}`).join(' '),
    `Now write chapter ${index + 1}, "${here.title ?? ''}", and only that chapter.`,
    'Do not retell the other chapters, and do not repeat the chapter title in the text.',
  ].join(' ')

  if (kind === 'graphic') {
    return [
      story,
      `Lay it out as ${shape.pages} comic pages of 3 or 4 panels each.`,
      'For every panel write "art": one sentence describing what the picture shows,',
      'as a drawing brief — no dialogue in it, since the words go in balloons.',
      'Give a panel up to two balloons. A balloon kind is one of',
      'speech, thought, caption, shout, sfx. Keep each balloon under 25 words so it fits.',
      'Reply with JSON only, in exactly this shape:',
      '{"pages":[{"title":"","panels":[{"art":"","balloons":[{"kind":"speech","text":""}]}]}]}',
    ].join(' ')
  }

  return [
    story,
    `Write it as ${shape.pages} pages. A page is 3 to 5 paragraphs of real prose —`,
    'scenes with dialogue and description, not a summary of events.',
    'Each page should read on from the one before, and the last page should finish the chapter.',
    'Reply with JSON only, in exactly this shape, where every paragraph is its own string:',
    '{"pages":[{"paragraphs":[""]}]}',
  ].join(' ')
}

/**
 * Models wrap JSON in prose or fences often enough that trusting the response
 * verbatim is a reliable way to fail. Take the outermost braces and parse that.
 */
export function parseJsonBody(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(trimmed)
  } catch { /* fall through to the brace scan */ }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Turn a provider's HTTP failure into something worth showing a writer. This
 * mirrors the image endpoint's classifier; a test keeps the two in step.
 */
export function describeProviderFailure(status: number, body: string): StoryError {
  const lower = body.toLowerCase()
  // Google answers a bad or unauthorised key with 400, not 401.
  if (lower.includes('api key not valid') || lower.includes('api_key_invalid') ||
      lower.includes('permission_denied') || lower.includes('has not been used in project')) {
    return { code: 'not_configured', message: 'The story service rejected the API key. Check the key set on the deployment.' }
  }
  if (lower.includes('resource_exhausted') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return lower.includes('quota') || lower.includes('billing')
      ? { code: 'quota', message: 'The account is out of credit or has hit its free allowance. Check the provider.' }
      : { code: 'rate_limited', message: 'Too many requests at once. Wait a moment and try again.' }
  }
  if (status === 401 || status === 403) {
    return { code: 'not_configured', message: 'The story service rejected the API key. Check the key set on the deployment.' }
  }
  if (status === 429) {
    if (lower.includes('quota') || lower.includes('billing') || lower.includes('insufficient')) {
      return { code: 'quota', message: 'The account is out of credit. Top it up to keep writing.' }
    }
    return { code: 'rate_limited', message: 'Too many requests at once. Wait a moment and try again.' }
  }
  if (
    lower.includes('safety') || lower.includes('content_policy') ||
    lower.includes('content policy') || lower.includes('moderation')
  ) {
    return { code: 'rejected', message: 'The story service would not write that. Try describing the story differently.' }
  }
  return { code: 'provider_error', message: `The story service failed (${status}). Try again in a moment.` }
}

interface GoogleModel {
  name?: string
  supportedGenerationMethods?: string[]
}

/**
 * Pick a text model from Google's own list rather than hardcoding a name that
 * will age. A deployment can still pin one with GOOGLE_TEXT_MODEL.
 */
export function chooseGoogleTextModel(models: GoogleModel[]): string | null {
  const usable = models
    .filter((m) => (m.supportedGenerationMethods ?? ['generateContent']).includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter((name) => /gemini/i.test(name))
    // Image, speech, embedding and realtime variants cannot write a chapter.
    .filter((name) => !/image|vision|embedding|tts|audio|live|thinking/i.test(name))
  if (usable.length === 0) return null
  // Flash models are the fast, free-tier-friendly ones; a chapter does not need
  // the heaviest model, and a slow call is one that times out.
  const flash = usable.filter((n) => /flash/i.test(n) && !/lite/i.test(n))
  const pool = flash.length > 0 ? flash : usable
  return pool.sort().reverse()[0]
}

/** The text of the first candidate, across the parts Google may split it into. */
export function extractGoogleText(body: unknown): string {
  const json = body as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const parts = json?.candidates?.[0]?.content?.parts ?? []
  return parts.map((p) => p?.text ?? '').join('').trim()
}

const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta'
/** Used only if the model list cannot be read. */
const GOOGLE_FALLBACK_MODEL = 'gemini-2.0-flash'
let cachedGoogleModel: string | null = null

/** Clears the memoised model choice. Exposed so tests start from a clean slate. */
export function resetGoogleTextModelCache(): void {
  cachedGoogleModel = null
}

async function resolveGoogleModel(key: string, signal: AbortSignal): Promise<string> {
  if (process.env.GOOGLE_TEXT_MODEL) return process.env.GOOGLE_TEXT_MODEL
  if (cachedGoogleModel) return cachedGoogleModel
  try {
    const res = await fetch(`${GOOGLE_BASE}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': key },
      signal,
    })
    if (res.ok) {
      const body = await res.json() as { models?: GoogleModel[] }
      const chosen = chooseGoogleTextModel(body.models ?? [])
      if (chosen) { cachedGoogleModel = chosen; return chosen }
    }
  } catch { /* fall through to the default */ }
  return GOOGLE_FALLBACK_MODEL
}

type Written =
  | { ok: true; text: string }
  | { ok: false; status: number; error: StoryError }

async function writeWithGoogle(
  key: string, prompt: string, maxTokens: number, signal: AbortSignal,
): Promise<Written> {
  const model = await resolveGoogleModel(key, signal)
  const res = await fetch(`${GOOGLE_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.9,
        maxOutputTokens: maxTokens,
      },
    }),
    signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: describeProviderFailure(res.status, body) }
  }

  const text = extractGoogleText(await res.json().catch(() => null))
  if (!text) {
    // A refusal comes back as a 200 with no text, so say what happened rather
    // than letting it flatten into a generic provider error.
    return {
      ok: false,
      status: 502,
      error: {
        code: 'rejected',
        message: 'The story service returned nothing — it may have declined that idea. Try describing it differently.',
      },
    }
  }
  return { ok: true, text }
}

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

async function writeWithOpenAi(
  key: string, prompt: string, maxTokens: number, signal: AbortSignal,
): Promise<Written> {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.9,
      max_tokens: maxTokens,
    }),
    signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: describeProviderFailure(res.status, body) }
  }

  const data = await res.json().catch(() => null) as {
    choices?: { message?: { content?: string } }[]
  } | null
  const text = data?.choices?.[0]?.message?.content?.trim() ?? ''
  if (!text) {
    return {
      ok: false,
      status: 502,
      error: { code: 'rejected', message: 'The story service returned nothing. Try describing the story differently.' },
    }
  }
  return { ok: true, text }
}

/** A chapter needs far more room than an outline; neither should run away. */
const OUTLINE_TOKENS = 1600
const CHAPTER_TOKENS = 8000
/** Stay under Vercel's function ceiling with room left to report a timeout. */
const TIMEOUT_MS = 55_000

export const config = { maxDuration: 60 }

function fail(res: Res, status: number, error: StoryError): void {
  res.status(status).json({ error })
}

export default async function handler(req: Req, res: Res): Promise<void> {
  const googleKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  const provider = googleKey ? 'google' : openaiKey ? 'openai' : null

  // As with pictures, a GET says whether a key reached this deployment. No key
  // material is exposed, only whether one is present.
  if (req.method === 'GET') {
    res.status(200).json({
      configured: provider !== null,
      provider,
      looksFor: ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY'],
      model: process.env.GOOGLE_TEXT_MODEL || process.env.OPENAI_TEXT_MODEL || null,
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
      message: 'Story writing is not switched on for this deployment yet.',
    })
    return
  }

  let payload: {
    stage?: unknown; idea?: unknown; kind?: unknown; length?: unknown
    audience?: unknown; outline?: unknown; index?: unknown
  }
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}) as never
  } catch {
    fail(res, 400, { code: 'unreadable', message: 'Could not read the request.' })
    return
  }

  const idea = typeof payload.idea === 'string' ? payload.idea : ''
  const kind: StoryKind = payload.kind === 'graphic' ? 'graphic' : 'prose'
  const length: StoryLength =
    payload.length === 'short' || payload.length === 'long' ? payload.length : 'medium'
  const audience = typeof payload.audience === 'string' ? payload.audience : 'middle'
  const outlining = payload.stage !== 'chapter'

  let prompt: string
  try {
    if (outlining) {
      prompt = buildOutlinePrompt(idea, kind, length, audience)
    } else {
      const outline = (payload.outline ?? {}) as { title?: string; chapters?: { title?: string; summary?: string }[] }
      const index = typeof payload.index === 'number' && payload.index >= 0 ? Math.floor(payload.index) : 0
      if (!Array.isArray(outline.chapters) || outline.chapters.length === 0) {
        fail(res, 400, { code: 'unreadable', message: 'The plan for this book is missing.' })
        return
      }
      prompt = buildChapterPrompt(idea, kind, length, audience, outline, index)
    }
  } catch {
    fail(res, 400, { code: 'empty_idea', message: 'Say what the story is about.' })
    return
  }

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)

  try {
    const maxTokens = outlining ? OUTLINE_TOKENS : CHAPTER_TOKENS
    const written = googleKey
      ? await writeWithGoogle(googleKey, prompt, maxTokens, abort.signal)
      : await writeWithOpenAi(openaiKey!, prompt, maxTokens, abort.signal)

    if (!written.ok) {
      // A bad key is the deployment owner's problem, not a client error.
      fail(res, written.error.code === 'not_configured' ? 502 : written.status, written.error)
      return
    }

    const parsed = parseJsonBody(written.text)
    if (!parsed || typeof parsed !== 'object') {
      fail(res, 502, {
        code: 'unreadable',
        message: 'The story came back in a shape the app could not read. Try again.',
      })
      return
    }

    res.status(200).json(outlining ? { outline: parsed } : { chapter: parsed })
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    fail(res, aborted ? 504 : 502, {
      code: aborted ? 'provider_error' : 'network',
      message: aborted
        ? 'The story took too long to write. Try a shorter book.'
        : 'Could not reach the story service.',
    })
  } finally {
    clearTimeout(timer)
  }
}
