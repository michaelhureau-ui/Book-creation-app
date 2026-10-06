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

/**
 * How much book each length asks for: about 50, 100 and 200 pages.
 *
 * A chapter is a call, and a call must finish well inside the function's
 * ceiling — so the page count is reached with many small chapters rather than
 * a few enormous ones. That is also what keeps a half-finished long book
 * worth having: each chapter is saved as it lands.
 */
export const SHAPES: Record<StoryKind, Record<StoryLength, { chapters: number; pages: number }>> = {
  prose: {
    short: { chapters: 10, pages: 5 },
    medium: { chapters: 20, pages: 5 },
    long: { chapters: 40, pages: 5 },
  },
  graphic: {
    short: { chapters: 10, pages: 5 },
    medium: { chapters: 20, pages: 5 },
    long: { chapters: 40, pages: 5 },
  },
}

/** Roughly how many pages a length comes to — what the app offers it as. */
export function pagesIn(kind: StoryKind, length: StoryLength): number {
  const shape = SHAPES[kind][length] ?? SHAPES[kind].medium
  return shape.chapters * shape.pages
}

export const MAX_IDEA_LENGTH = 1200
export const MAX_SHOW_LENGTH = 120

export function cleanIdea(idea: string): string {
  return idea.replace(/\s+/g, ' ').trim().slice(0, MAX_IDEA_LENGTH)
}

export function cleanShow(show: string): string {
  return show.replace(/\s+/g, ' ').trim().slice(0, MAX_SHOW_LENGTH)
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

/**
 * A story set in something someone loves, written with its real characters and
 * places — either a new adventure of theirs or its own story told again.
 *
 * The pictures are the part that cannot simply be asked for. An image model
 * refuses or mangles a character named outright, so the drawings are made from
 * description instead: the plan is asked to say how each character actually
 * looks, accurately enough to be recognised, and the panel briefs carry that
 * description rather than the name.
 */
function showNote(show: string, retell: boolean): string[] {
  const named = cleanShow(show)
  if (!named) return []
  return [
    `This book is set in "${named}", with its real characters, places and creatures.`,
    retell
      ? 'Tell its own story again as this book, in your own words and scenes.'
      : 'Tell a new adventure of theirs, somewhere in that world.',
    'In the cast, say how each character really looks in it — age, build, hair,',
    'clothes, colouring, markings, anything always true of them — in plain visual',
    'words, close enough that someone drawing from the description alone would',
    'be recognised.',
  ]
}

function shapeOf(kind: StoryKind, length: StoryLength): { chapters: number; pages: number } {
  return SHAPES[kind][length] ?? SHAPES[kind].medium
}

export function buildOutlinePrompt(
  idea: string, kind: StoryKind, length: StoryLength, audience: string,
  show?: string, retell = false,
): string {
  const cleaned = cleanIdea(idea)
  const named = cleanShow(show ?? '')
  if (!cleaned && !named) throw new Error('Say what the story is about.')
  const shape = shapeOf(kind, length)
  const form = kind === 'graphic' ? 'graphic novel' : 'novel'
  return [
    cleaned ? `Plan a ${form} from this idea: "${cleaned}".` : `Plan a ${form}.`,
    ...showNote(show ?? '', retell),
    `Write it for ${audienceNote(audience)}.`,
    `Plan exactly ${shape.chapters} ${shape.chapters === 1 ? 'chapter' : 'chapters'}.`,
    'Give the book a real title — not the idea repeated back — and a short subtitle.',
    'Each chapter needs a title and two or three sentences saying what happens in it,',
    'including how it ends, so the chapters can be written separately and still join up.',
    'Name the main characters in the first chapter summary and keep those names afterwards.',
    // The cast is what holds the drawings together: every panel is briefed with
    // the same descriptions, so a character looks the same on page forty as on
    // page one.
    'Also give a "cast" of the three to six characters who appear most, each with',
    'a "name" and a "look": one sentence of plain visual description — age, build,',
    'hair, clothes, anything always true of them — written so an illustrator who',
    'has never seen them could draw them the same way twice.',
    'Reply with JSON only, no prose around it, in exactly this shape:',
    '{"title":"","subtitle":"","cast":[{"name":"","look":""}],"chapters":[{"title":"","summary":""}]}',
  ].join(' ')
}

export function buildChapterPrompt(
  idea: string,
  kind: StoryKind,
  length: StoryLength,
  audience: string,
  outline: {
    title?: string
    cast?: { name?: string; look?: string }[]
    chapters?: { title?: string; summary?: string }[]
  },
  index: number,
  show?: string,
  retell = false,
): string {
  const shape = shapeOf(kind, length)
  const chapters = outline.chapters ?? []
  const here = chapters[index] ?? {}
  const cast = (outline.cast ?? []).filter((c) => c?.name)
  const story = [
    `The book is "${outline.title ?? 'Untitled'}", from the idea: "${cleanIdea(idea)}".`,
    ...showNote(show ?? '', retell),
    `Write it for ${audienceNote(audience)}.`,
    cast.length > 0
      ? `The cast: ${cast.map((c) => `${c.name} — ${c.look ?? ''}`).join('; ')}.`
      : '',
    'The whole plan is:',
    chapters.map((c, i) => `${i + 1}. ${c.title ?? ''} — ${c.summary ?? ''}`).join(' '),
    `Now write chapter ${index + 1}, "${here.title ?? ''}", and only that chapter.`,
    'Do not retell the other chapters, and do not repeat the chapter title in the text.',
  ].filter(Boolean).join(' ')

  if (kind === 'graphic') {
    return [
      story,
      `Lay it out as ${shape.pages} comic pages of 3 or 4 panels each.`,
      'For every panel write "art": one sentence describing what the picture shows,',
      'as a drawing brief — no dialogue in it, since the words go in balloons.',
      // Each panel is drawn on its own, with no memory of the one before, so a
      // brief that says only "Rell looks up" draws a different Rell every time.
      cast.length > 0
        ? 'Every panel is drawn separately by someone who has not read the book and'
          + ' does not know these characters, so inside "art" refer to each character'
          + ' only by their description from the cast — never by name, and never by'
          + ' naming what they are from. Repeat the description every time.'
        : 'Inside "art" describe who is in the panel and what they look like every'
          + ' time, since each panel is drawn separately by someone who has not seen'
          + ' the others.',
      // A tail aimed at nobody is what makes a drawn page look wrong.
      'Give every balloon a "speaker" — who says it — and a "from": where that',
      'character is standing in the panel, one of left, middle or right, so the',
      'balloon can point at them. Use "off" for a caption or a voice from outside',
      'the panel. Keep the same character on the same side within a panel.',
      'Give a panel up to two balloons. A balloon kind is one of',
      'speech, thought, caption, shout, sfx. Keep each balloon under 25 words so it fits.',
      'Reply with JSON only, in exactly this shape:',
      '{"pages":[{"title":"","panels":[{"art":"","balloons":'
      + '[{"kind":"speech","speaker":"","from":"left","text":""}]}]}]}',
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
 * How good a candidate a model name looks, best first. Sorting the names
 * alphabetically is what once picked `gemini-omni-flash-preview` over
 * `gemini-2.5-flash` — "o" simply sorts after "2" — so rank them on what
 * actually matters instead.
 */
export function rankTextModel(name: string): [number, number, number] {
  // A lite model is still a flash model, and it is the one a free key is most
  // likely to be allowed — excluding it is how a key with no credit ended up
  // with nothing left to try. It ranks below its full sibling, not out.
  const flash = /flash/i.test(name) ? (/lite/i.test(name) ? 0.5 : 1) : 0
  // A preview or a moving alias can change under the deployment without warning.
  const settled = /preview|exp(?:erimental)?\b|latest|-\d{4}/i.test(name) ? 0 : 1
  const version = Number(/gemini-(\d+(?:\.\d+)?)/i.exec(name)?.[1] ?? 0)
  return [flash, settled, version]
}

/**
 * Pick a text model from Google's own list rather than hardcoding a name that
 * will age. A deployment can still pin one with GOOGLE_TEXT_MODEL.
 *
 * The list contains models this endpoint cannot use at all — an omni model
 * answers "This model only supports Interactions API" — so a model is taken
 * only when Google says it supports generateContent. Assuming it does when the
 * list is silent is how an unusable one gets through.
 */
export function chooseGoogleTextModels(models: GoogleModel[]): string[] {
  return models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter((name) => /^gemini-/i.test(name))
    // Image, speech, embedding and realtime variants cannot write a chapter.
    .filter((name) => !/image|vision|embedding|tts|audio|live|thinking|omni|robotics/i.test(name))
    .sort((a, b) => {
      const [fa, sa, va] = rankTextModel(a)
      const [fb, sb, vb] = rankTextModel(b)
      return fb - fa || sb - sa || vb - va || a.localeCompare(b)
    })
}

export function chooseGoogleTextModel(models: GoogleModel[]): string | null {
  return chooseGoogleTextModels(models)[0] ?? null
}

/**
 * Whether a failure means this model is not one this account may use — it is
 * not there, it cannot do this, or it costs money the account has not got.
 *
 * The list offers models from every tier, so the newest one is often one the
 * key cannot pay for: Google answers 402 "your prepayment credits are
 * depleted", which reads to a writer as "you have run out" when in truth the
 * next model down would have written the book for nothing. Worth trying
 * another; everything else would fail the same way twice.
 */
export function looksLikeWrongModel(status: number, body: string): boolean {
  const lower = body.toLowerCase()
  if (status === 402) return true
  if (status === 429 || status === 400 || status === 404) {
    return lower.includes('only supports')
      || lower.includes('is not found')
      || lower.includes('not supported for')
      || lower.includes('is not supported')
      // Google retires a model with a 404 that reads nothing like "not found".
      || lower.includes('no longer available')
      || lower.includes('deprecated')
      || lower.includes('has been retired')
      || lower.includes('prepayment')
      || lower.includes('billing')
      || lower.includes('free tier')
      || lower.includes('quota')
  }
  return false
}

/**
 * The human-readable reason a provider gave, if it gave one. Both Google and
 * OpenAI nest it under `error.message`.
 *
 * A story that fails with nothing but a status number is a story nobody can
 * fix: not the writer, and not whoever has to debug it afterwards. So the
 * reason is carried through to the app instead of being swallowed.
 */
export function providerReason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } }
    const message = parsed?.error?.message
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 200)
  } catch { /* the body was not JSON; fall through */ }
  const plain = body.trim()
  return plain && plain.length <= 200 ? plain : ''
}

/** Attach the provider's own words to an error that only has a status number. */
export function withReason(error: StoryError, body: string): StoryError {
  if (error.code !== 'provider_error' && error.code !== 'quota' && error.code !== 'rate_limited') {
    return error
  }
  const reason = providerReason(body)
  return reason ? { ...error, message: `${error.message.replace(/\s*Try again in a moment\.$/, '')} ${reason}` } : error
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
/**
 * The last thing tried when nothing in the list will write, and the only thing
 * tried when the list cannot be read.
 *
 * Deliberately an alias rather than a version: a pinned name ages out from
 * under the deployment, and Google retires it with a 404 reading "no longer
 * available to new users" — which is exactly how the last resort became the
 * thing that broke.
 */
const GOOGLE_FALLBACK_MODEL = 'gemini-flash-latest'
let cachedGoogleModel: string | null = null

/** Clears the memoised model choice. Exposed so tests start from a clean slate. */
export function resetGoogleTextModelCache(): void {
  cachedGoogleModel = null
}

/**
 * At most this many models are tried before giving up. The list mixes tiers, so
 * a key with no credit can be refused by several in a row before reaching one
 * it may use — and a refusal is instant, so trying a few more costs nothing.
 */
const MODEL_ATTEMPTS = 10

async function resolveGoogleModels(key: string, signal: AbortSignal): Promise<string[]> {
  if (process.env.GOOGLE_TEXT_MODEL) return [process.env.GOOGLE_TEXT_MODEL]
  if (cachedGoogleModel) return [cachedGoogleModel]
  try {
    const res = await fetch(`${GOOGLE_BASE}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': key },
      signal,
    })
    if (res.ok) {
      const body = await res.json() as { models?: GoogleModel[] }
      const ranked = chooseGoogleTextModels(body.models ?? [])
      if (ranked.length > 0) return ranked.slice(0, MODEL_ATTEMPTS)
    }
  } catch { /* fall through to the default */ }
  return [GOOGLE_FALLBACK_MODEL]
}

type Written =
  | { ok: true; text: string }
  | { ok: false; status: number; error: StoryError }

function googlePayload(prompt: string, maxTokens: number, askForJson: boolean): string {
  return JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      // Not every model accepts being told to answer in JSON. The reply is
      // parsed out of surrounding prose anyway, so this is a preference.
      ...(askForJson ? { responseMimeType: 'application/json' } : {}),
      temperature: 0.9,
      maxOutputTokens: maxTokens,
    },
  })
}

async function writeWithGoogle(
  key: string, prompt: string, maxTokens: number, signal: AbortSignal,
): Promise<Written> {
  const send = (model: string, askForJson: boolean): Promise<Response> =>
    fetch(`${GOOGLE_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: googlePayload(prompt, maxTokens, askForJson),
      signal,
    })

  const candidates = await resolveGoogleModels(key, signal)
  // Worth one last go: every model in the list may be one this key cannot use.
  if (!candidates.includes(GOOGLE_FALLBACK_MODEL)) candidates.push(GOOGLE_FALLBACK_MODEL)

  let res: Response | null = null
  let model = candidates[0]
  let body = ''
  let refusedEveryModel = false

  for (const [i, candidate] of candidates.entries()) {
    refusedEveryModel = i === candidates.length - 1
    model = candidate
    res = await send(model, true)
    if (res.ok) break
    body = await res.text().catch(() => '')

    // A 400 we cannot otherwise explain is a complaint about the request, and
    // asking for JSON is the least standard thing in it. Try again plainly
    // before giving up on this model.
    if (res.status === 400 && !looksLikeWrongModel(res.status, body)
        && describeProviderFailure(res.status, body).code === 'provider_error') {
      res = await send(model, false)
      if (res.ok) break
      body = await res.text().catch(() => '')
    }

    // The list offers models from every tier, and one the key cannot use looks
    // from the outside exactly like having run out. Try the next one down
    // rather than telling a writer their account is empty.
    if (!looksLikeWrongModel(res.status, body)) { refusedEveryModel = false; break }
    console.error(`[generate-story] ${model} answered ${res.status}; trying the next model`)
    cachedGoogleModel = null
  }

  if (!res || !res.ok) {
    // Reaches the deployment's runtime logs. The key is never part of this.
    console.error(`[generate-story] ${model} answered ${res?.status ?? 0}: ${body.slice(0, 500)}`)
    if (refusedEveryModel) {
      // Not the same thing as an allowance running out, and saying so sends
      // someone looking for a problem they do not have.
      return {
        ok: false,
        status: 502,
        error: withReason({
          code: 'quota',
          message: `Every model this key can reach turned the story down — ${candidates.length} tried.`
            + ' They want billing set up on the Google account, or have been retired.',
        }, body),
      }
    }
    return {
      ok: false,
      status: res?.status ?? 502,
      error: withReason(describeProviderFailure(res?.status ?? 502, body), body),
    }
  }

  // The model that answered is the one worth using again.
  cachedGoogleModel = model

  const text = extractGoogleText(await res.json().catch(() => null))
  if (!text) {
    // A refusal comes back as a 200 with no text, so say what happened rather
    // than letting it flatten into a generic provider error.
    console.error(`[generate-story] ${model} answered 200 with no text`)
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
    console.error(`[generate-story] openai answered ${res.status}: ${body.slice(0, 500)}`)
    return {
      ok: false,
      status: res.status,
      error: withReason(describeProviderFailure(res.status, body), body),
    }
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
const OUTLINE_TOKENS = 8000
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
    audience?: unknown; outline?: unknown; index?: unknown; show?: unknown
    retell?: unknown
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
  const show = typeof payload.show === 'string' ? payload.show : ''
  const retell = payload.retell === true
  const outlining = payload.stage !== 'chapter'

  let prompt: string
  try {
    if (outlining) {
      prompt = buildOutlinePrompt(idea, kind, length, audience, show, retell)
    } else {
      const outline = (payload.outline ?? {}) as {
        title?: string
        cast?: { name?: string; look?: string }[]
        chapters?: { title?: string; summary?: string }[]
      }
      const index = typeof payload.index === 'number' && payload.index >= 0 ? Math.floor(payload.index) : 0
      if (!Array.isArray(outline.chapters) || outline.chapters.length === 0) {
        fail(res, 400, { code: 'unreadable', message: 'The plan for this book is missing.' })
        return
      }
      prompt = buildChapterPrompt(idea, kind, length, audience, outline, index, show, retell)
    }
  } catch {
    fail(res, 400, { code: 'empty_idea', message: 'Say what the story is about, or name a show or film.' })
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
