/**
 * Writes the words for a page that has already been drawn.
 *
 * The usual order is backwards. The words are written while the panels are
 * still empty, the pictures are drawn to match them afterwards, and the two
 * never quite meet: a balloon sits where a blank panel suggested, the dialogue
 * describes a thing the picture does not show, and nobody can point a tail at
 * a character because nobody knows where the character is.
 *
 * Written this way round, the page exists first. The model is shown the actual
 * panels, told what each one is for, and asked for the words — and, while it
 * is looking, for where each speaker is standing, so the balloons can be put
 * above them with their tails on their faces.
 *
 * Configure by setting GOOGLE_API_KEY (or GEMINI_API_KEY) on the Vercel
 * project. This file is deliberately self-contained: Vercel compiles it to ESM
 * without bundling, so an import reaching outside `api/` is not resolvable.
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

export interface LetterError {
  code: 'not_configured' | 'empty' | 'provider_error' | 'network' | 'unreadable'
  message: string
}

export type LetterKind = 'speech' | 'thought' | 'caption' | 'shout' | 'sfx'
const KINDS: LetterKind[] = ['speech', 'thought', 'caption', 'shout', 'sfx']

export interface WrittenBalloon {
  kind: LetterKind
  speaker: string
  text: string
}

export interface LetteredPanel {
  balloons: WrittenBalloon[]
  people: { name: string; x: number; y: number }[]
}

export const MAX_PANELS = 8
export const MAX_WORDS_PER_BALLOON = 30

/** Keep a fraction inside the picture, whatever units it came back in. */
export function fraction(value: unknown, fallback = 0.5): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  const scaled = n > 1 && n <= 100 ? n / 100 : n > 100 ? n / 1000 : n
  return Math.min(0.98, Math.max(0.02, scaled))
}

/** Trim a balloon to a length that will actually fit on a drawn panel. */
export function clip(text: string, words = MAX_WORDS_PER_BALLOON): string {
  const parts = text.replace(/\s+/g, ' ').trim().split(' ')
  if (parts.length <= words) return parts.join(' ')
  return `${parts.slice(0, words).join(' ')}…`
}

export interface PanelBrief {
  /** What this panel is meant to show or do, from the plan. */
  beat?: string
}

export interface PageBrief {
  kind: 'graphic' | 'picture'
  title?: string
  story?: string
  cast?: { name?: string; look?: string }[]
  panels: PanelBrief[]
}

export function buildLetterPrompt(brief: PageBrief): string {
  const picture = brief.kind === 'picture'
  const cast = (brief.cast ?? []).filter((c) => c?.name)
  const beats = brief.panels.map((panel, i) =>
    `Panel ${i + 1}${panel.beat ? `: ${panel.beat}` : ': (no note)'}`)

  return [
    picture
      ? 'You are writing the words for one page of a picture book for young children.'
      : 'You are lettering one page of a graphic novel.',
    brief.story ? `The story: ${brief.story}` : '',
    cast.length > 0
      ? `The cast: ${cast.map((c) => `${c.name} — ${c.look ?? ''}`).join('; ')}.`
      : '',
    brief.title ? `This is "${brief.title}".` : '',
    `The ${brief.panels.length} ${brief.panels.length === 1 ? 'picture' : 'pictures'} above are`,
    'this page\'s panels, in reading order. Each was drawn to show:',
    beats.join('. '),
    '',
    'Write the words that go on each panel, from what is actually in the picture.',
    picture
      ? 'Give each page one "caption" of one or two short sentences in plain words a'
        + ' five-year-old would follow, under 30 words, that reads well aloud. Add at most'
        + ' one short "speech" balloon if somebody in the picture is clearly saying something.'
      : 'Give a panel up to two balloons, and leave a panel wordless if the picture'
        + ' says it better alone. A balloon kind is one of speech, thought, caption,'
        + ' shout, sfx. Keep each under 25 words so it fits on the panel.',
    'Every speech, thought or shout balloon needs a "speaker": the name of whoever',
    'says it, from the cast where you can.',
    'Do not describe the picture — the reader can see it. Write what is said, or what',
    'a caption would add to it.',
    'The words must carry the story forward from panel to panel in the order given.',
    '',
    'Also, for each panel, list in "people" where each character who speaks on it is',
    'standing: the centre of their head as fractions of that picture, x 0 at the left',
    'edge and 1 at the right, y 0 at the top and 1 at the bottom. Use decimals, not',
    'percentages. Leave somebody out if you cannot see them.',
    '',
    'Reply with JSON only, no prose around it, one entry per panel in order:',
    '{"panels":[{"balloons":[{"kind":"speech","speaker":"","text":""}],'
    + '"people":[{"name":"","x":0.0,"y":0.0}]}]}',
  ].filter(Boolean).join(' ')
}

export function readLettering(text: string, panels: number): LetteredPanel[] {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = trimmed.search(/[[{]/)
  if (start < 0) throw new Error('no JSON in the answer')
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice(start))
  } catch {
    throw new Error('the answer was not JSON')
  }

  const body = (parsed ?? {}) as { panels?: unknown }
  const rows = Array.isArray(body.panels) ? body.panels : []

  // One entry per panel, in order, whatever came back: a page that answered
  // for two of its four panels still letters those two.
  return Array.from({ length: panels }, (_, i): LetteredPanel => {
    const row = (rows[i] ?? {}) as { balloons?: unknown; people?: unknown }
    const balloons = Array.isArray(row.balloons)
      ? row.balloons.flatMap((entry): WrittenBalloon[] => {
        const b = (entry ?? {}) as { kind?: unknown; speaker?: unknown; text?: unknown }
        const text = typeof b.text === 'string' ? clip(b.text) : ''
        if (!text) return []
        const kind = KINDS.includes(b.kind as LetterKind) ? b.kind as LetterKind : 'speech'
        const speaker = typeof b.speaker === 'string' ? b.speaker.trim().slice(0, 60) : ''
        // Nothing said in a caption or a sound effect has a speaker to aim at.
        return [{ kind, speaker: kind === 'caption' || kind === 'sfx' ? '' : speaker, text }]
      }).slice(0, 3)
      : []
    const people = Array.isArray(row.people)
      ? row.people.flatMap((entry) => {
        const p = (entry ?? {}) as { name?: unknown; x?: unknown; y?: unknown }
        const name = typeof p.name === 'string' ? p.name.trim() : ''
        if (!name) return []
        return [{ name, x: fraction(p.x), y: fraction(p.y) }]
      })
      : []
    return { balloons, people }
  })
}

interface GoogleModel {
  name?: string
  supportedGenerationMethods?: string[]
}

/** A model that can look at the panels and write about them. */
export function chooseWritingModel(models: GoogleModel[]): string | null {
  const usable = models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter((name) => /gemini/i.test(name))
    .filter((name) => !/image|imagen|tts|audio|embedding|live|robotics|gemma/i.test(name))
  if (usable.length === 0) return null
  // Writing wants a better model than simply locating a face does, but a page
  // at a time is still dozens of calls for a book, so flash it is.
  const flash = usable.filter((n) => /flash/i.test(n) && !/lite|thinking/i.test(n))
  const pool = flash.length > 0 ? flash : usable
  return pool.sort().reverse()[0]
}

const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const GOOGLE_FALLBACK_MODEL = 'gemini-flash-latest'
const LIST_MS = 8_000
const WRITE_MS = 45_000

let cachedModel: string | null = null

export function resetWritingModelCache(): void {
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

export async function resolveWritingModel(key: string, signal: AbortSignal): Promise<string> {
  if (process.env.GOOGLE_VISION_MODEL) return process.env.GOOGLE_VISION_MODEL
  if (cachedModel) return cachedModel
  try {
    const res = await fetchWithin(
      `${GOOGLE_BASE}/models?key=${encodeURIComponent(key)}&pageSize=200`, {}, LIST_MS, signal,
    )
    if (res.ok) {
      const json = await res.json() as { models?: GoogleModel[] }
      const chosen = chooseWritingModel(json.models ?? [])
      if (chosen) { cachedModel = chosen; return chosen }
    }
  } catch { /* the fallback still works */ }
  return GOOGLE_FALLBACK_MODEL
}

export function extractText(body: unknown): string {
  const json = body as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  return (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p?.text ?? '').join('').trim()
}

export const config = { maxDuration: 60 }

function fail(res: Res, status: number, error: LetterError): void {
  res.status(status).json({ error })
}

export default async function handler(req: Req, res: Res): Promise<void> {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY

  if (req.method === 'GET') {
    res.status(200).json({
      configured: Boolean(key),
      looksFor: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
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
      message: 'Writing the words from the pictures is not switched on for this deployment yet.',
    })
    return
  }

  let payload: {
    kind?: unknown; title?: unknown; story?: unknown; cast?: unknown; panels?: unknown
  }
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}) as never
  } catch {
    fail(res, 400, { code: 'empty', message: 'Could not read the request.' })
    return
  }

  const rows = Array.isArray(payload.panels) ? payload.panels.slice(0, MAX_PANELS) : []
  const panels = rows.map((entry) => {
    const panel = (entry ?? {}) as { image?: unknown; mime?: unknown; beat?: unknown }
    const raw = typeof panel.image === 'string' ? panel.image : ''
    return {
      image: raw.replace(/^data:[^;,]*;base64,/, ''),
      mime: typeof panel.mime === 'string' && /^image\//.test(panel.mime)
        ? panel.mime
        : /^data:(image\/[a-z+]+)/.exec(raw)?.[1] ?? 'image/jpeg',
      beat: typeof panel.beat === 'string' ? panel.beat.slice(0, 400) : '',
    }
  })
  if (panels.length === 0 || panels.some((p) => !p.image)) {
    fail(res, 400, { code: 'empty', message: 'There were no drawn panels to write words for.' })
    return
  }

  const brief: PageBrief = {
    kind: payload.kind === 'picture' ? 'picture' : 'graphic',
    title: typeof payload.title === 'string' ? payload.title.slice(0, 120) : '',
    story: typeof payload.story === 'string' ? payload.story.slice(0, 2000) : '',
    cast: Array.isArray(payload.cast)
      ? (payload.cast as { name?: string; look?: string }[]).slice(0, 8)
      : [],
    panels: panels.map((p) => ({ beat: p.beat })),
  }

  const model = await resolveWritingModel(key, new AbortController().signal)
  const thinking = /gemini-3|gemini-[4-9]/.test(model)
    ? { thinkingLevel: 'low' }
    : { thinkingBudget: 0 }

  const parts: unknown[] = []
  panels.forEach((panel, i) => {
    parts.push({ text: `Panel ${i + 1}:` })
    parts.push({ inlineData: { mimeType: panel.mime, data: panel.image } })
  })
  parts.push({ text: buildLetterPrompt(brief) })

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), WRITE_MS + 2_000)
  try {
    const response = await fetchWithin(
      `${GOOGLE_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 3000,
            responseMimeType: 'application/json',
            thinkingConfig: thinking,
          },
        }),
      },
      WRITE_MS, abort.signal,
    )

    const text = await response.text()
    if (!response.ok) {
      console.error('letter-page: provider refused', response.status, text.slice(0, 500))
      fail(res, response.status === 429 ? 429 : 502, {
        code: 'provider_error',
        message: `The writing service answered ${response.status}.`,
      })
      return
    }

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      fail(res, 502, { code: 'unreadable', message: 'The answer was not readable.' })
      return
    }

    try {
      res.status(200).json({ panels: readLettering(extractText(body), panels.length), model })
    } catch (err) {
      console.error('letter-page: unreadable answer', err instanceof Error ? err.message : err, text.slice(0, 500))
      fail(res, 502, {
        code: 'unreadable',
        message: 'The words came back in a shape the app could not read.',
      })
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    console.error('letter-page: failed', err)
    fail(res, aborted ? 504 : 502, {
      code: aborted ? 'provider_error' : 'network',
      message: aborted
        ? 'Writing the words for that page took too long.'
        : 'Could not reach the writing service.',
    })
  } finally {
    clearTimeout(timer)
  }
}
