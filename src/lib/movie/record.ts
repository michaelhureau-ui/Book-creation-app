import type { Book } from '@/types'
import { paletteOf } from '@/lib/cover'
import { frameToRect, layoutOf } from '@/lib/graphic/layouts'
import { assetIdsOf, pageGeometry, renderPage } from '@/lib/graphic/render'
import { loadImages } from '@/lib/graphic/assets'
import {
  ease, filmSeconds, shotAt, shotList, stretchShots,
  type FilmOptions, type Move, type Shot,
} from '@/lib/movie/film'
import { createScore } from '@/lib/movie/sound'
import { createNarrator } from '@/lib/movie/narrator'
import { createSpeaker, narrate, playNarration } from '@/lib/movie/voice'

function audioContext(): AudioContext | null {
  const Ctx = typeof window === 'undefined'
    ? undefined
    : window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return null
  try {
    return new Ctx()
  } catch {
    return null
  }
}

/** The shots that move across something drawn, rather than being typeset. */
type MovingShot = Extract<Shot, { move: Move }>

export const FRAME = { width: 1280, height: 720 }
const FPS = 30

/** The container the browser will actually record in. Safari is not WebM. */
export function pickMimeType(supported: (type: string) => boolean = (type) =>
  typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)): string | null {
  for (const type of [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ]) {
    if (supported(type)) return type
  }
  return null
}

export function fileExtension(mime: string): string {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm'
}

function fitText(
  ctx: CanvasRenderingContext2D, text: string, maxWidth: number, start: number, min: number,
  weight: string, family: string,
): number {
  let size = start
  ctx.font = `${weight} ${size}px ${family}`
  while (size > min && ctx.measureText(text).width > maxWidth) {
    size -= 2
    ctx.font = `${weight} ${size}px ${family}`
  }
  return size
}

const SERIF = 'Georgia, "Times New Roman", serif'

/**
 * One frame of the film.
 *
 * Comic pages are drawn through the same renderer that backs the editor, the
 * preview, the exports and the printout — so the film is made of the book
 * itself rather than a second, slightly different drawing of it.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  book: Book,
  shots: Shot[],
  time: number,
  pages: Map<string, HTMLCanvasElement>,
): void {
  const { width, height } = FRAME
  const palette = paletteOf(book.cover.palette)
  const found = shotAt(shots, time)

  ctx.fillStyle = '#0d0c0b'
  ctx.fillRect(0, 0, width, height)
  if (!found) return
  const { shot, progress } = found

  // A short fade at each end keeps shots from snapping into one another.
  const fade = Math.min(1, progress / 0.12, (1 - progress) / 0.12)
  ctx.globalAlpha = Math.max(0, Math.min(1, fade))

  const card = (lines: { text: string; size: number; weight?: string; colour?: string; gap?: number }[]): void => {
    ctx.fillStyle = palette.bg
    ctx.fillRect(0, 0, width, height)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const total = lines.reduce((h, l) => h + l.size * 1.4 + (l.gap ?? 0), 0)
    let y = height / 2 - total / 2
    for (const line of lines) {
      const size = fitText(ctx, line.text, width * 0.8, line.size, 18, line.weight ?? '400', SERIF)
      ctx.fillStyle = line.colour ?? palette.fg
      y += (size * 1.4) / 2 + (line.gap ?? 0)
      ctx.fillText(line.text, width / 2, y)
      y += (size * 1.4) / 2
    }
  }

  switch (shot.kind) {
    case 'cover':
      card([
        { text: shot.title, size: 76, weight: '700' },
        ...(shot.subtitle ? [{ text: shot.subtitle, size: 34, colour: palette.muted, gap: 14 }] : []),
        { text: shot.author.toUpperCase(), size: 24, colour: palette.muted, gap: 52 },
      ])
      break

    case 'chapter':
      card([
        ...(shot.number ? [{ text: `CHAPTER ${shot.number}`, size: 24, colour: palette.muted }] : []),
        { text: shot.title, size: 60, weight: '700', gap: 16 },
      ])
      break

    case 'end':
      card([
        { text: 'The End', size: 70, weight: '700' },
        { text: shot.title, size: 26, colour: palette.muted, gap: 28 },
      ])
      break

    case 'page': {
      const rendered = pages.get(shot.page.id)
      if (rendered) drawMoving(ctx, rendered, shot, progress)
      break
    }

    case 'panel': {
      const geo = pageGeometry({ trim: 'comic', dpi: 150 })
      const frame = layoutOf(shot.page.layout).frames[shot.panelIndex]
      const rendered = pages.get(shot.page.id)
      if (!frame || !rendered) break
      const rect = frameToRect(frame, geo)
      drawMoving(ctx, rendered, shot, progress, rect)
      break
    }
  }

  ctx.globalAlpha = 1
}

/** Cover-fit a source rectangle into the frame, moving across the shot. */
function drawMoving(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  shot: MovingShot,
  progress: number,
  within?: { x: number; y: number; w: number; h: number },
): void {
  const { width, height } = FRAME
  const box = within ?? { x: 0, y: 0, w: source.width, h: source.height }
  const t = ease(progress)
  const scale = shot.move.from.scale + (shot.move.to.scale - shot.move.from.scale) * t
  const cx = shot.move.from.x + (shot.move.to.x - shot.move.from.x) * t
  const cy = shot.move.from.y + (shot.move.to.y - shot.move.from.y) * t

  // Cover the frame, then crop in by the shot's scale.
  const cover = Math.max(width / box.w, height / box.h)
  const draw = cover * scale
  const sw = Math.min(box.w, width / draw)
  const sh = Math.min(box.h, height / draw)
  const sx = box.x + Math.max(0, Math.min(box.w - sw, cx * box.w - sw / 2))
  const sy = box.y + Math.max(0, Math.min(box.h - sh, cy * box.h - sh / 2))

  ctx.fillStyle = '#0d0c0b'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, width, height)
}

export interface FilmProgress {
  /** 0 while the pages are being drawn, then how far through the film. */
  share: number
  label: string
}

/**
 * Play the film onto a canvas and record it.
 *
 * The canvas is the recording: the same frames the viewer watches are the ones
 * that go into the file, so nothing can be true of one and not the other. It
 * runs in real time because that is what MediaRecorder captures — a book is
 * watched at the speed it is read.
 */
export interface SoundOptions {
  /** Music and effects. */
  music: boolean
  /** The story read aloud. */
  voice: boolean
}

export interface Film {
  blob: Blob
  mime: string
  seconds: number
  /** True when the voice is in the file rather than only heard while filming. */
  voiceRecorded: boolean
}

export async function recordFilm(
  book: Book,
  canvas: HTMLCanvasElement,
  options: FilmOptions,
  sound: SoundOptions,
  onProgress: (progress: FilmProgress) => void,
  signal?: AbortSignal,
): Promise<Film> {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('This browser could not draw the film.')
  canvas.width = FRAME.width
  canvas.height = FRAME.height

  let shots = shotList(book, options)

  // Every comic page is drawn once up front; redrawing one per frame would
  // never keep up with the clock.
  const images = await loadImages(assetIdsOf(book.pages))
  const pages = new Map<string, HTMLCanvasElement>()
  const wanted = book.kind === 'graphic' ? book.pages : []
  for (const [i, page] of wanted.entries()) {
    if (signal?.aborted) throw new Error('stopped')
    onProgress({ share: 0, label: `Drawing page ${i + 1} of ${wanted.length}…` })
    pages.set(page.id, renderPage(page, images, { trim: 'comic', dpi: 150 }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  // The voice is synthesised in the page, so it can be mixed into what the
  // recorder captures — and so each shot can be held for as long as its lines
  // take, rather than cutting them off when the clock says so.
  const audio = audioContext()
  const destination = audio?.createMediaStreamDestination() ?? null
  let narration: Awaited<ReturnType<typeof narrate>> | null = null
  let voiceRecorded = false

  if (sound.voice && audio && destination) {
    onProgress({ share: 0, label: 'Finding a voice…' })
    const say = await createSpeaker()
    if (say) {
      narration = await narrate(shots, audio, say, (done, total) =>
        onProgress({ share: 0, label: `Speaking the story — ${done} of ${total}…` }))
      shots = stretchShots(shots, narration.seconds)
      voiceRecorded = true
    }
  }

  const seconds = filmSeconds(shots)
  // Where the voice could not be synthesised, fall back to the browser reading
  // aloud: heard while it films, but not in the file.
  const narrator = createNarrator(sound.voice && !voiceRecorded)

  const mime = pickMimeType()
  if (!mime) throw new Error('This browser cannot record video.')

  const stream = canvas.captureStream(FPS)
  // Web Audio can be mixed into what the recorder captures, so the score ends
  // up in the file. The browser's voice cannot be: no browser exposes it.
  const score = sound.music ? createScore(audio, destination) : null
  for (const track of destination?.stream.getAudioTracks() ?? []) stream.addTrack(track)

  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data) }

  // A browser starts an audio context suspended unless it was created during a
  // click, and building the voice takes long enough that the click is over by
  // the time this runs. Wake it before recording.
  if (audio && audio.state !== 'running') await audio.resume().catch(() => undefined)

  // Something must feed the audio output for the whole film, even when it is
  // silence. Without it the recorded track only spans the moments something was
  // actually playing — with the music off that came out 38 seconds shorter than
  // the picture, which is a voice that slides further out of step the longer you
  // watch. A constant source of nothing holds the track open end to end.
  let silence: ConstantSourceNode | null = null
  if (audio && destination) {
    silence = audio.createConstantSource()
    silence.offset.value = 0
    silence.connect(destination)
    silence.start()
  }

  const finished = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })
  recorder.start(250)

  const started = performance.now()
  let sounded: Shot | null = null
  let shotIndex = -1
  await new Promise<void>((resolve) => {
    const step = (): void => {
      const time = (performance.now() - started) / 1000
      if (signal?.aborted || time >= seconds) { resolve(); return }
      drawFrame(ctx, book, shots, time, pages)
      // Cue the sound once per shot, as it comes on screen.
      const current = shotAt(shots, time)?.shot ?? null
      if (current && current !== sounded) {
        sounded = current
        shotIndex++
        score?.cue(current, shotIndex)
        if (narration && audio && destination) {
          const clips = narration.clips.get(shotIndex)
          if (clips) playNarration(audio, destination, clips)
        } else {
          narrator.speak(current)
        }
      }
      onProgress({ share: time / seconds, label: 'Filming…' })
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })

  // Hold the last frame briefly so the file does not end mid-fade.
  drawFrame(ctx, book, shots, Math.max(0, seconds - 0.05), pages)
  await new Promise((resolve) => setTimeout(resolve, 200))
  recorder.stop()
  narrator.cancel()
  score?.stop()
  try { silence?.stop() } catch { /* already stopped */ }
  stream.getTracks().forEach((track) => track.stop())
  await finished
  await audio?.close().catch(() => undefined)

  return { blob: new Blob(chunks, { type: mime }), mime, seconds, voiceRecorded }
}
