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
  query?: Record<string, string | string[] | undefined>
  url?: string
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

export type StoryKind = 'prose' | 'graphic' | 'picture'
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
    // A graphic novel is not a novel with pictures: a single issue runs about
    // twenty-four pages, a collection sixty-odd, and a bookshelf graphic novel
    // around a hundred and twenty. Asking for two hundred made something no
    // shop would stock and no reader would recognise.
    short: { chapters: 6, pages: 4 },
    medium: { chapters: 16, pages: 4 },
    long: { chapters: 24, pages: 5 },
  },
  // A picture book is one picture to a page and a line or two beneath it, and
  // it is short: twenty-four pages is the standard, thirty-two is generous,
  // and anything past about forty-eight stops being a picture book.
  picture: {
    short: { chapters: 6, pages: 4 },
    medium: { chapters: 8, pages: 4 },
    long: { chapters: 12, pages: 4 },
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

export interface Shape { chapters: number; pages: number }

/** The most a book may be asked for in one go, and the least worth asking. */
export const MAX_CHAPTERS = 80
export const MAX_CHAPTER_PAGES = 12

/**
 * A length asked for by name, or a count of pages asked for exactly.
 *
 * The three named lengths are what the buttons offer, but somebody who wants a
 * 96-page book should get 96 pages rather than the nearest button, so the app
 * may send the shape it wants instead.
 */
export function readWant(value: unknown): Shape | undefined {
  const asked = (value ?? {}) as { chapters?: unknown; pages?: unknown }
  const chapters = Number(asked.chapters)
  const pages = Number(asked.pages)
  if (!Number.isFinite(chapters) || !Number.isFinite(pages)) return undefined
  if (chapters < 1 || pages < 1) return undefined
  return {
    chapters: Math.min(MAX_CHAPTERS, Math.floor(chapters)),
    pages: Math.min(MAX_CHAPTER_PAGES, Math.floor(pages)),
  }
}

function shapeOf(kind: StoryKind, length: StoryLength, want?: Shape): Shape {
  return want ?? SHAPES[kind][length] ?? SHAPES[kind].medium
}

/**
 * How many chapters one planning call asks for.
 *
 * Forty at once does not come back: the model spends longer than the function
 * is allowed to live, and a plan cut off halfway is what turned a two-hundred
 * page book into a five-page one.
 *
 * Ten took between thirty-two and forty-five seconds while the model was
 * thinking hard about every summary, which was too close to the forty-eight the
 * request has; six was the safe answer. Asking it to think lightly brought the
 * same work down to fourteen, so ten fits again with room to spare — and ten at
 * a time means a forty-chapter book is planned in four calls rather than seven.
 */
export const OUTLINE_BATCH = 10

export function buildOutlinePrompt(
  idea: string, kind: StoryKind, length: StoryLength, audience: string,
  show?: string, retell = false,
  /** Chapters already planned, when this call is continuing an earlier one. */
  sofar: { title?: string; summary?: string }[] = [],
  title = '',
  want?: Shape,
): string {
  const cleaned = cleanIdea(idea)
  const named = cleanShow(show ?? '')
  if (!cleaned && !named) throw new Error('Say what the story is about.')
  const shape = shapeOf(kind, length, want)
  const form = kind === 'graphic' ? 'graphic novel'
    : kind === 'picture' ? 'picture book for young children'
      : 'novel'
  const done = sofar.length
  const asking = Math.min(OUTLINE_BATCH, shape.chapters - done)

  if (done > 0) {
    // A continuation needs the story so far, or chapter 11 starts the book
    // again. The summaries already written are the only memory it has.
    return [
      `Here is the plan so far for "${title || 'this book'}", a ${form}`,
      cleaned ? `from this idea: "${cleaned}".` : 'already begun.',
      ...showNote(show ?? '', retell),
      `It is written for ${audienceNote(audience)}.`,
      `It has ${shape.chapters} chapters in all, and ${done} are planned:`,
      sofar.map((c, i) => `${i + 1}. ${c.title ?? ''} — ${c.summary ?? ''}`).join(' '),
      `Plan the next ${asking} ${asking === 1 ? 'chapter' : 'chapters'},`,
      `numbers ${done + 1} to ${done + asking}, carrying straight on from what happens above`,
      'with the same characters and names.',
      done + asking >= shape.chapters
        ? 'These are the last chapters, so bring the story to a proper ending.'
        : 'The story must not finish yet — these are the middle of the book.',
      'Each chapter needs a title and two or three sentences saying what happens in it,',
      'including how it ends.',
      'Reply with JSON only, no prose around it, in exactly this shape:',
      '{"chapters":[{"title":"","summary":""}]}',
    ].join(' ')
  }

  return [
    cleaned ? `Plan a ${form} from this idea: "${cleaned}".` : `Plan a ${form}.`,
    ...showNote(show ?? '', retell),
    `Write it for ${audienceNote(audience)}.`,
    `The whole book has ${shape.chapters} ${shape.chapters === 1 ? 'chapter' : 'chapters'},`,
    `but plan only the first ${asking} of them now — the rest are asked for afterwards,`,
    'so leave the story wide open at the end of the last one you plan.',
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
  want?: Shape,
  /**
   * Write the pictures only, with no words in them yet.
   *
   * The usual order is backwards: the dialogue is written while the panels are
   * still empty and the pictures are drawn to match it afterwards, so the
   * balloons sit where a blank panel suggested. Asked for this way, the page is
   * drawn first and the words are written to the picture that exists.
   */
  silent = false,
): string {
  const shape = shapeOf(kind, length, want)
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

  if (silent && (kind === 'graphic' || kind === 'picture')) {
    const perPage = kind === 'picture' ? 'one panel' : '3 or 4 panels'
    return [
      story,
      `Lay it out as ${shape.pages} pages of ${perPage} each.`,
      'Do not write any dialogue, captions or sound effects: the pictures are drawn',
      'first and the words are written onto them afterwards.',
      'For every panel write two things.',
      '"art": one sentence describing what the picture shows, as a drawing brief,',
      'with no words or lettering anywhere in the picture.',
      cast.length > 0
        ? 'Every panel is drawn separately by someone who has not read the book and'
          + ' does not know these characters, so inside "art" refer to each character'
          + ' only by their description from the cast — never by name, and never by'
          + ' naming what they are from. Repeat the description every time.'
        : 'Inside "art" describe who is in the panel and what they look like every'
          + ' time, since each panel is drawn separately by someone who has not seen'
          + ' the others.',
      '"beat": one short line saying what this panel is for in the story — what',
      'happens in it, and who says something and roughly about what. Use the',
      'characters\' real names here. This is the note the words will be written from,',
      'so it must carry the story forward panel by panel.',
      'Reply with JSON only, in exactly this shape:',
      '{"pages":[{"title":"","panels":[{"art":"","beat":""}]}]}',
    ].join(' ')
  }

  if (kind === 'picture') {
    return [
      story,
      `Lay it out as ${shape.pages} pages, one picture to a page.`,
      'This is a picture book: the picture carries the story and the words sit under it.',
      'For every page write one panel. Its "art" is one sentence describing the',
      'picture, as a drawing brief — warm, specific, and with no words or',
      'lettering in the picture itself.',
      cast.length > 0
        ? 'Every picture is drawn separately by someone who has not read the book and'
          + ' does not know these characters, so inside "art" refer to each character'
          + ' only by their description from the cast — never by name. Repeat the'
          + ' description every time.'
        : 'Inside "art" describe who is in the picture and what they look like every'
          + ' time, since each page is drawn separately.',
      'Give the page one balloon of kind "caption": one or two short sentences of',
      'the story, in plain words a five-year-old would follow, read aloud well, and',
      'under 30 words. If somebody in the picture says something out loud, you may',
      'add one "speech" balloon of under 12 words with its "speaker" and a "from"',
      'of left, middle or right. Never more than two balloons on a page.',
      'Reply with JSON only, in exactly this shape:',
      '{"pages":[{"title":"","panels":[{"art":"","balloons":'
      + '[{"kind":"caption","from":"off","text":""}]}]}]}',
    ].join(' ')
  }

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
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch { /* fall through to the repair */ }
  }
  return repairTruncatedJson(start === -1 ? trimmed : trimmed.slice(start))
}

/**
 * Rescue a reply that stopped in the middle.
 *
 * A chapter that runs past its allowance is cut off mid-word, and what arrives
 * is four good pages and the first half of a fifth — perfectly good writing
 * that the app threw away whole because the brackets did not match. This winds
 * back to the last element that finished properly and closes what is still
 * open, so the chapter arrives a page short instead of not at all.
 *
 * It only ever truncates and closes: nothing is invented, and a reply that was
 * never JSON in the first place still comes back as nothing.
 */
export function repairTruncatedJson(text: string): unknown {
  const open: string[] = []
  let inString = false
  let escaped = false
  let lastComplete = -1
  let stackThen: string[] = []

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; continue }
    if (c === '{') { open.push('}'); continue }
    if (c === '[') { open.push(']'); continue }
    if (c === '}' || c === ']') {
      open.pop()
      // A container just finished and something still holds it: everything up
      // to here is whole, and the rest can be closed off.
      if (open.length > 0) { lastComplete = i; stackThen = [...open] }
      continue
    }
  }

  if (lastComplete < 0) return null
  try {
    return JSON.parse(text.slice(0, lastComplete + 1) + stackThen.reverse().join(''))
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
    // The names keep changing — a probe of the live list found a transcriber, an
    // image model called "nano-banana" and a computer-use model all claiming
    // generateContent — so the list is kept up rather than trusted to be stable.
    .filter((name) => !new RegExp(
      'image|vision|embedding|tts|audio|live|thinking|omni|robotics'
      + '|transcribe|banana|imagen|computer-use|guard|rerank',
      'i',
    ).test(name))
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
  // "This model is currently experiencing high demand." One model being busy
  // says nothing about the next one, and giving up here is how a 200-page book
  // came back five pages long: the chapter after the busy one was never asked
  // for.
  if (status === 503) return true
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
/**
 * Why the model stopped. "MAX_TOKENS" means the answer was cut off mid-sentence
 * — which, for a plan the app then counts chapters from, is the difference
 * between a 200-page book and a 5-page one.
 */
export function googleFinishReason(body: unknown): string {
  const json = body as { candidates?: { finishReason?: string }[] }
  return json?.candidates?.[0]?.finishReason ?? ''
}

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

/** Which model last wrote something, if one has. */
export function cachedGoogleTextModel(): string | null {
  return cachedGoogleModel
}

/**
 * At most this many models are tried before giving up. The list mixes tiers, so
 * a key with no credit can be refused by several in a row before reaching one
 * it may use — and a refusal is instant, so trying more costs little.
 *
 * It was ten, and ten was not enough: a key whose credit had run out was
 * refused by every flash model it could see, and the one it was allowed to use
 * sat eleventh. A cap this high only ever bites when nothing works at all, and
 * WALK_BUDGET_MS is what actually keeps the request inside its ceiling.
 */
const MODEL_ATTEMPTS = 30

/**
 * How long the one-word walk may spend finding models that answer. Each
 * question is a second or so, so this is only reached when a lot of them are
 * refusing.
 */
const WALK_BUDGET_MS = 18_000

/**
 * When to stop waiting for a chapter and say so, leaving the function room to
 * answer rather than being killed.
 *
 * It was a flat twenty-two seconds, split between models. That was wrong twice
 * over: measured in production, these models answer a one-word question in
 * about a second and then take longer than twenty-two seconds over a real
 * plan — they are slow, not dead — and giving the second model a turn only
 * meant neither got enough time. A model that has just proved it is there gets
 * whatever is left.
 */
const WRITE_DEADLINE_MS = 48_000
/** No attempt is worth starting with less than this left. */
const MIN_ATTEMPT_MS = 10_000

/**
 * Fetch that cannot outlast its welcome.
 *
 * Every call here is one leg of a request that has about a minute to live, so
 * anything without a clock of its own can spend the lot. Asking Google which
 * models exist did exactly that during an outage: no refusal, no log line, just
 * a minute of silence and "the operation was aborted".
 */
async function fetchWithin(
  url: string, init: RequestInit, ms: number, outer: AbortSignal,
): Promise<Response | 'timeout'> {
  const attempt = new AbortController()
  const giveUp = setTimeout(() => attempt.abort(), ms)
  const relay = (): void => attempt.abort()
  outer.addEventListener('abort', relay)
  try {
    return await fetch(url, { ...init, signal: attempt.signal })
  } catch (err) {
    if (outer.aborted) throw err
    if (err instanceof Error && err.name === 'AbortError') return 'timeout'
    throw err
  } finally {
    clearTimeout(giveUp)
    outer.removeEventListener('abort', relay)
  }
}

/** Long enough for a list of models, short enough to leave time to write. */
const LIST_MS = 8_000

async function resolveGoogleModels(key: string, signal: AbortSignal): Promise<string[]> {
  if (process.env.GOOGLE_TEXT_MODEL) return [process.env.GOOGLE_TEXT_MODEL]
  if (cachedGoogleModel) return [cachedGoogleModel]
  try {
    const res = await fetchWithin(
      `${GOOGLE_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } }, LIST_MS, signal)
    if (res === 'timeout') {
      console.error('[generate-story] the model list took too long; using the fallback')
      return [GOOGLE_FALLBACK_MODEL]
    }
    if (res.ok) {
      const body = await res.json() as { models?: GoogleModel[] }
      const ranked = chooseGoogleTextModels(body.models ?? [])
      if (ranked.length > 0) return ranked.slice(0, MODEL_ATTEMPTS)
    }
  } catch { /* fall through to the default */ }
  return [GOOGLE_FALLBACK_MODEL]
}

type Written =
  | { ok: true; text: string; finishReason: string }
  | { ok: false; status: number; error: StoryError }

/**
 * How hard to let the model think before it writes.
 *
 * These models think before answering, and the thinking is most of the wait: a
 * chapter that times out has usually spent longer deciding what to write than
 * writing it. A bedtime adventure does not need deep reasoning, so the app asks
 * for a light touch — and asks differently depending on the generation, because
 * Gemini 3 takes a level, 2.5 takes a token budget, and sending both is an
 * error.
 */
export function thinkingFor(model: string, light: boolean): Record<string, unknown> {
  if (!light) return {}
  return /gemini-3/i.test(model)
    ? { thinkingConfig: { thinkingLevel: 'low' } }
    : { thinkingConfig: { thinkingBudget: 0 } }
}

function googlePayload(
  prompt: string, maxTokens: number, askForJson: boolean,
  model = '', light = false,
): string {
  return JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      // Not every model accepts being told to answer in JSON. The reply is
      // parsed out of surrounding prose anyway, so this is a preference.
      ...(askForJson ? { responseMimeType: 'application/json' } : {}),
      ...thinkingFor(model, light),
      temperature: 0.9,
      maxOutputTokens: maxTokens,
    },
  })
}

/**
 * What to tell a writer when nothing at all would write for them.
 *
 * Worth being exact, because the two causes want opposite things done. A
 * retired model is the app's problem and fixes itself from the model list. An
 * empty prepay balance stops *every* key on that billing account — the free
 * allowance included — so no amount of trying other models will help, and the
 * only thing that does is someone adding credit or putting a new key on the
 * deployment. Saying "try again in a moment" to that is how an afternoon gets
 * lost.
 */
export function refusalAdvice(tried: number, reasons: string[]): string {
  const money = reasons.some((r) => /credit|billing|prepay|payment/i.test(r))
  const busy = reasons.some(
    (r) => /high demand|overload|unavailable|try again later|took too long/i.test(r))
  const head = `None of the ${tried} models this key can reach would write the story.`
  if (money) {
    return `${head} The Google account behind the key has run out of credit, which stops every`
      + ' model it has — even the free ones. Add credit at aistudio.google.com, or put a new'
      + ' key on the deployment. Google said:'
  }
  // Busy is the one that really does pass on its own, so it is the one case
  // where waiting is the right advice rather than a brush-off.
  if (busy) {
    return `${head} Google is busy right now — this one passes on its own. Give it a few`
      + ' minutes and press the button again. Google said:'
  }
  return `${head} They have been retired or are out of this key's reach. Google said:`
}

/** A word's worth of answer: enough to prove a model is there. */
const PING_MS = 6_000
const PING_TOKENS = 8
/** How many live models to hold on to — one to write with, one to fall back on. */
const LIVE_WANTED = 2

/**
 * Which of these models are answering right now.
 *
 * Asked for a whole chapter, a model that has stopped answering and a model
 * that is thinking look identical for twenty seconds. Asked for one word, they
 * do not: a healthy model answers in about a second. So the walk is done with
 * single words — cheap, quick, and it means a bad hour at Google costs seconds
 * rather than the whole request.
 */
async function liveModels(
  key: string, candidates: string[], signal: AbortSignal,
  refused: { model: string; reason: string }[], startedAt: number,
): Promise<string[]> {
  const found: string[] = []
  for (const model of candidates) {
    if (found.length >= LIVE_WANTED) break
    if (Date.now() - startedAt > WALK_BUDGET_MS) break

    const res = await fetchWithin(`${GOOGLE_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: googlePayload('Say the word yes.', PING_TOKENS, false),
    }, PING_MS, signal)

    if (res === 'timeout') {
      refused.push({ model, reason: 'took too long to answer' })
      console.error(`[generate-story] ${model} did not answer a one-word question; skipping it`)
      continue
    }
    if (res.ok) { found.push(model); continue }

    const body = await res.text().catch(() => '')
    if (!looksLikeWrongModel(res.status, body)) {
      // Not a refusal we understand — worth trying properly rather than
      // writing the model off on the strength of one odd answer.
      found.push(model)
      // A key the provider will not take is a key no other model will take
      // either, so there is nothing to be gained by asking them all.
      if (describeProviderFailure(res.status, body).code === 'not_configured') break
      continue
    }
    refused.push({ model, reason: providerReason(body) })
    console.error(`[generate-story] ${model} answered ${res.status}; trying the next model`)
  }
  return found
}

async function writeWithGoogle(
  key: string, prompt: string, maxTokens: number, signal: AbortSignal,
  /** Ask the model to think lightly; the probe turns it off to compare. */
  light = true,
): Promise<Written> {
  /**
   * One model, one go, with its own clock.
   *
   * A model that has stopped answering holds the line until the whole request
   * is killed, and then nobody is told anything at all — which is worse than
   * any refusal. Giving each attempt a slice of the budget means a model that
   * hangs costs that slice and nothing more.
   */
  const send = (
    model: string, askForJson: boolean, deadline: number, think = light,
  ): Promise<Response | 'timeout'> =>
    fetchWithin(`${GOOGLE_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: googlePayload(prompt, maxTokens, askForJson, model, think),
    }, Math.max(MIN_ATTEMPT_MS, deadline - Date.now()), signal)

  const candidates = await resolveGoogleModels(key, signal)
  // Worth one last go: every model in the list may be one this key cannot use.
  if (!candidates.includes(GOOGLE_FALLBACK_MODEL)) candidates.push(GOOGLE_FALLBACK_MODEL)

  const startedAt = Date.now()
  let res: Response | null = null
  let model = candidates[0]
  let body = ''
  /** What each model said when it turned this key away, in the order tried. */
  const refused: { model: string; reason: string }[] = []

  // Whole chapters take half a minute to write, so trying them one model at a
  // time means two dead models use up the request. A word costs a second, and
  // tells a model that has stopped answering from one that is merely working —
  // which is the only way to reach a live model further down the list.
  const live = cachedGoogleModel
    ? [cachedGoogleModel]
    : await liveModels(key, candidates, signal, refused, startedAt)

  const deadline = startedAt + WRITE_DEADLINE_MS

  for (const candidate of live) {
    model = candidate
    // Nothing useful can be started with seconds left; say so instead.
    if (deadline - Date.now() < MIN_ATTEMPT_MS && refused.length > 0) break
    const first = await send(model, true, deadline)

    if (first === 'timeout') {
      refused.push({ model, reason: 'took too long to answer' })
      console.error(`[generate-story] ${model} ran out of time; trying the next model`)
      cachedGoogleModel = null
      res = null
      continue
    }

    res = first
    if (res.ok) break
    body = await res.text().catch(() => '')

    // A 400 we cannot otherwise explain is a complaint about the request, and
    // the two least standard things in it are asking for JSON and asking the
    // model to think lightly. Drop both and try again before giving up on this
    // model — an older one may know neither field.
    if (res.status === 400 && !looksLikeWrongModel(res.status, body)
        && describeProviderFailure(res.status, body).code === 'provider_error') {
      const plain = await send(model, false, deadline, false)
      if (plain === 'timeout') {
        refused.push({ model, reason: 'took too long to answer' })
        res = null
        continue
      }
      res = plain
      if (res.ok) break
      body = await res.text().catch(() => '')
    }

    // The list offers models from every tier, and one the key cannot use looks
    // from the outside exactly like having run out. Try the next one down
    // rather than telling a writer their account is empty.
    if (!looksLikeWrongModel(res.status, body)) break
    refused.push({ model, reason: providerReason(body) })
    console.error(`[generate-story] ${model} answered ${res.status}; trying the next model`)
    cachedGoogleModel = null
  }

  // Every model that was tried turned us away, or none of them ever answered —
  // either way there was never a model to write with, which is a different
  // problem from one model failing and wants a different thing said.
  //
  // Comparing the last refusal against the model the loop happened to stop on
  // got this wrong whenever the walk ran out of budget before trying the next
  // one, and a writer whose chapter had timed out was told "the story service
  // failed (502)" — true, useless, and not what happened.
  const refusedEveryModel = refused.length > 0 && (!res || looksLikeWrongModel(res.status, body))

  if (!res || !res.ok) {
    // Reaches the deployment's runtime logs. The key is never part of this.
    console.error(`[generate-story] ${model} answered ${res?.status ?? 0}: ${body.slice(0, 500)}`)
    if (refusedEveryModel) {
      // Not the same thing as an allowance running out, and saying so sends
      // someone looking for a problem they do not have.
      const reasons = refused.map((r) => r.reason)
      const silent = /took too long/
      // A walk that only ever met silence has no response to quote, and
      // "Google said: took too long to answer" is not Google saying anything.
      const theirs = providerReason(body) || reasons.filter((r) => r && !silent.test(r)).pop() || ''
      const advice = refusalAdvice(refused.length, reasons)
      const busy = reasons.every((r) => !r || silent.test(r) || /high demand|overload|unavailable/i.test(r))
      return {
        ok: false,
        status: busy ? 503 : 502,
        error: {
          code: busy ? 'rate_limited' : 'quota',
          message: theirs ? `${advice} ${theirs}` : advice.replace(/\s*Google said:$/, ''),
        },
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

  const payload = await res.json().catch(() => null)
  const text = extractGoogleText(payload)
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
  return { ok: true, text, finishReason: googleFinishReason(payload) }
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
    choices?: { message?: { content?: string }; finish_reason?: string }[]
  } | null
  const text = data?.choices?.[0]?.message?.content?.trim() ?? ''
  if (!text) {
    return {
      ok: false,
      status: 502,
      error: { code: 'rejected', message: 'The story service returned nothing. Try describing the story differently.' },
    }
  }
  return { ok: true, text, finishReason: data?.choices?.[0]?.finish_reason ?? '' }
}

/** A chapter needs far more room than an outline; neither should run away. */
const OUTLINE_TOKENS = 8000
/**
 * Room for a chapter. It was eight thousand, which was the right size when the
 * model spent half its allowance thinking; asked to think lightly it writes
 * considerably more, and a chapter cut off at the ceiling comes back as
 * unreadable JSON. Sixteen is room to finish.
 */
const CHAPTER_TOKENS = 16000
/** What one model said when asked to write a single word. */
export interface ProbedModel {
  model: string
  status: number
  ok: boolean
  reason: string
}

/**
 * Ask the key itself which models it may use.
 *
 * The runtime log says which models refused a story, but only for stories
 * someone happened to ask for, and never which one would have worked. Twice now
 * a fix has been shipped on a guess about that. This answers it directly: it is
 * the same walk the writer does, with a one-word prompt, reported model by
 * model. No key material is in the answer.
 */
export async function probeGoogleModels(
  key: string, signal: AbortSignal,
): Promise<{ listed: number; candidates: string[]; tried: ProbedModel[]; wrote: string | null }> {
  let listed = 0
  let candidates: string[] = []
  try {
    const res = await fetchWithin(
      `${GOOGLE_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } }, LIST_MS, signal)
    if (res !== 'timeout' && res.ok) {
      const body = await res.json() as { models?: GoogleModel[] }
      listed = (body.models ?? []).length
      candidates = chooseGoogleTextModels(body.models ?? [])
    }
  } catch { /* an unreadable list is itself worth reporting, as zero */ }

  if (!candidates.includes(GOOGLE_FALLBACK_MODEL)) candidates.push(GOOGLE_FALLBACK_MODEL)

  const startedAt = Date.now()
  const tried: ProbedModel[] = []
  let wrote: string | null = null

  for (const model of candidates.slice(0, MODEL_ATTEMPTS)) {
    const res = await fetch(`${GOOGLE_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: googlePayload('Say the word yes.', 16, false),
      signal,
    }).catch(() => null)
    if (!res) {
      tried.push({ model, status: 0, ok: false, reason: 'could not be reached' })
      continue
    }
    if (res.ok) {
      tried.push({ model, status: 200, ok: true, reason: '' })
      wrote = model
      break
    }
    const body = await res.text().catch(() => '')
    tried.push({ model, status: res.status, ok: false, reason: providerReason(body) })
    if (Date.now() - startedAt > WALK_BUDGET_MS) break
  }

  return { listed, candidates, tried, wrote }
}

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
    // ?probe=models checks the key against every model it can see and says what
    // each one answered. It writes a word per model, so it is asked for, never
    // run by default.
    const fromUrl = /[?&]probe=([a-z]+)/.exec(req.url ?? '')?.[1]
    const asked = req.query?.probe ?? fromUrl
    // ?probe=write goes the whole way: the real prompt, the real model, the
    // real parse. A key that answers "yes" to one word has still not proved it
    // can write a book, and that gap is where every one of these faults has
    // been hiding.
    if (asked === 'write') {
      if (!googleKey) {
        res.status(200).json({ provider, probe: 'needs a Google key' })
        return
      }
      const probeLength: StoryLength =
        req.url?.includes('length=long') ? 'long'
          : req.url?.includes('length=medium') ? 'medium' : 'short'
      const probeKind: StoryKind = req.url?.includes('kind=graphic') ? 'graphic'
        : req.url?.includes('kind=picture') ? 'picture' : 'prose'
      // A chapter is the call that actually times out, so the probe has to be
      // able to ask for one rather than only for a plan.
      const probeChapter = req.url?.includes('stage=chapter')
      const probeThinking = !req.url?.includes('think=full')
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
      const startedAt = Date.now()
      try {
        // A canned plan, so a chapter can be asked for without writing the plan
        // first — the point is to time the one call, not the whole book.
        const plan = {
          title: 'The Lantern at Bramble Head',
          cast: [{ name: 'Rell', look: 'a small red fox in a yellow oilskin coat' }],
          chapters: Array.from({ length: shapeOf(probeKind, probeLength).chapters }, (_, i) => ({
            title: `Chapter ${i + 1}: The Light Goes Out`,
            summary: 'Rell climbs the stair to relight the lamp and finds something on the rocks.',
          })),
        }
        const written = await writeWithGoogle(
          googleKey,
          probeChapter
            ? buildChapterPrompt('a fox who keeps a lighthouse', probeKind, probeLength, 'middle', plan, 3)
            : buildOutlinePrompt('a fox who keeps a lighthouse', probeKind, probeLength, 'middle'),
          probeChapter ? CHAPTER_TOKENS : OUTLINE_TOKENS,
          abort.signal,
          probeThinking,
        )
        if (!written.ok) {
          res.status(200).json({
            provider,
            wrote: false,
            stage: probeChapter ? 'chapter' : 'outline',
            thinking: probeThinking ? 'light' : 'full',
            seconds: Math.round((Date.now() - startedAt) / 100) / 10,
            error: written.error,
          })
          return
        }
        const parsedReply = parseJsonBody(written.text) as
          { title?: string; chapters?: unknown[]; pages?: unknown[] } | null
        res.status(200).json({
          provider,
          wrote: probeChapter
            ? Boolean(parsedReply && Array.isArray(parsedReply.pages) && parsedReply.pages.length > 0)
            : Boolean(parsedReply && Array.isArray(parsedReply.chapters) && parsedReply.chapters.length > 0),
          stage: probeChapter ? 'chapter' : 'outline',
          thinking: probeThinking ? 'light' : 'full',
          model: cachedGoogleTextModel(),
          length: probeLength,
          kind: probeKind,
          // What the book is supposed to be, against what the plan would make it.
          wantedChapters: shapeOf(probeKind, probeLength).chapters,
          chapters: Array.isArray(parsedReply?.chapters) ? parsedReply.chapters.length : 0,
          pages: Array.isArray(parsedReply?.pages) ? parsedReply.pages.length : 0,
          title: parsedReply?.title ?? null,
          // A reply cut off mid-sentence is the difference between 200 pages and 5.
          finishReason: written.finishReason,
          replyChars: written.text.length,
          parsed: parsedReply !== null,
          seconds: Math.round((Date.now() - startedAt) / 100) / 10,
        })
      } catch (err) {
        res.status(200).json({
          provider,
          wrote: false,
          error: { code: 'network', message: err instanceof Error ? err.message : 'the probe failed' },
        })
      } finally {
        clearTimeout(timer)
      }
      return
    }
    if (asked === 'models') {
      if (!googleKey) {
        res.status(200).json({ configured: provider !== null, provider, probe: 'needs a Google key' })
        return
      }
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
      try {
        res.status(200).json({ provider, ...(await probeGoogleModels(googleKey, abort.signal)) })
      } catch {
        res.status(200).json({ provider, probe: 'the probe itself could not finish' })
      } finally {
        clearTimeout(timer)
      }
      return
    }
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
    retell?: unknown; sofar?: unknown; title?: unknown; want?: unknown; silent?: unknown
  }
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}) as never
  } catch {
    fail(res, 400, { code: 'unreadable', message: 'Could not read the request.' })
    return
  }

  const idea = typeof payload.idea === 'string' ? payload.idea : ''
  const kind: StoryKind = payload.kind === 'graphic' ? 'graphic'
    : payload.kind === 'picture' ? 'picture' : 'prose'
  const length: StoryLength =
    payload.length === 'short' || payload.length === 'long' ? payload.length : 'medium'
  const audience = typeof payload.audience === 'string' ? payload.audience : 'middle'
  const show = typeof payload.show === 'string' ? payload.show : ''
  const retell = payload.retell === true
  const outlining = payload.stage !== 'chapter'
  // The exact shape asked for, when it is not one of the three named lengths.
  const want = readWant(payload.want)

  let prompt: string
  try {
    if (outlining) {
      // A continuation carries the chapters planned so far, so the next ten
      // follow on instead of starting the book again.
      const sofar = Array.isArray(payload.sofar)
        ? (payload.sofar as { title?: string; summary?: string }[]).slice(0, 200)
        : []
      const planned = typeof payload.title === 'string' ? payload.title : ''
      prompt = buildOutlinePrompt(idea, kind, length, audience, show, retell, sofar, planned, want)
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
      prompt = buildChapterPrompt(
        idea, kind, length, audience, outline, index, show, retell, want,
        payload.silent === true,
      )
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
      // This used to fail in silence, which left nothing to diagnose it with.
      console.error(
        `[generate-story] unreadable reply, finish=${written.finishReason}, `
        + `${written.text.length} chars, ends: ${JSON.stringify(written.text.slice(-120))}`,
      )
      fail(res, 502, {
        code: 'unreadable',
        message: written.finishReason === 'MAX_TOKENS'
          ? 'That chapter ran longer than it is allowed to be and was cut off. Try again — it is rarely the same twice.'
          : 'The story came back in a shape the app could not read. Try again.',
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
