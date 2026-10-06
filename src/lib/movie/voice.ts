import type { Shot } from '@/lib/movie/film'
import { linesFor } from '@/lib/movie/narrator'

/**
 * A voice that can be put in the saved film.
 *
 * The browser's own speech cannot: no browser lets a page capture it, so a
 * film recorded with it comes out silent. A speech API would be one call a
 * line and would empty an allowance long before it finished a book. So the
 * voice is synthesised here, in the page, as sound data — which Web Audio can
 * mix straight into what the recorder is capturing.
 *
 * It is a plain robot voice rather than a polished one. That is the price of
 * a voice that is free, works with no key, and ends up in the file.
 */

/** Turns one line into WAV bytes, or null if it cannot. */
export type Speaker = (line: string) => ArrayBuffer | null

let speaker: Speaker | null | undefined

/**
 * Load the synthesiser. It is several megabytes, so it is fetched only when
 * someone actually asks for a voice, and kept for the rest of the session.
 */
export async function createSpeaker(): Promise<Speaker | null> {
  if (speaker !== undefined) return speaker
  try {
    const [{ default: meSpeak }, config, voice] = await Promise.all([
      import('mespeak'),
      import('mespeak/src/mespeak_config.json'),
      import('mespeak/voices/en/en-us.json'),
    ])
    meSpeak.loadConfig((config as { default: unknown }).default ?? config)
    meSpeak.loadVoice((voice as { default: unknown }).default ?? voice)
    speaker = (line: string) => {
      const said = line.trim()
      if (!said) return null
      try {
        return meSpeak.speak(said, { rawdata: 'arraybuffer', speed: 165, pitch: 50 })
      } catch {
        return null
      }
    }
  } catch {
    speaker = null
  }
  return speaker
}

/** Exposed so a test can start from a clean slate. */
export function resetSpeaker(): void {
  speaker = undefined
}

export interface Narration {
  /** The clips to play when each shot comes on screen, by shot index. */
  clips: Map<number, AudioBuffer[]>
  /** How long each shot needs to be for its lines to finish, by shot index. */
  seconds: number[]
}

/** A beat between lines, and after the last one, so nothing feels clipped. */
const GAP = 0.28

/**
 * Speak every shot up front and measure it.
 *
 * Doing this before filming is what lets a shot be held for as long as its
 * lines take: narration that outruns its picture was the reason the voice kept
 * being cut off mid-sentence.
 */
export async function narrate(
  shots: Shot[], ctx: AudioContext, say: Speaker,
  onProgress?: (done: number, total: number) => void,
): Promise<Narration> {
  const clips = new Map<number, AudioBuffer[]>()
  const seconds: number[] = []

  for (const [index, shot] of shots.entries()) {
    onProgress?.(index, shots.length)
    const lines = linesFor(shot)
    const buffers: AudioBuffer[] = []
    let total = 0
    for (const line of lines) {
      const wav = say(line)
      if (!wav) continue
      try {
        const buffer = await ctx.decodeAudioData(wav)
        buffers.push(buffer)
        total += buffer.duration + GAP
      } catch { /* a line that will not decode is simply not spoken */ }
    }
    if (buffers.length > 0) clips.set(index, buffers)
    seconds.push(total > 0 ? total + GAP : 0)
    // Let the browser draw between lines rather than locking the tab solid.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  onProgress?.(shots.length, shots.length)
  return { clips, seconds }
}

/**
 * Play one shot's lines, one after the other, into the recorded graph.
 *
 * Short of full scale on purpose: the voice and the score are summed, and a
 * recording that reaches 1.0 clips on the loudest word.
 */
export const VOICE_LEVEL = 0.8

export function playNarration(
  ctx: AudioContext, destination: AudioNode, buffers: AudioBuffer[], volume = VOICE_LEVEL,
): void {
  let at = ctx.currentTime + 0.02
  for (const buffer of buffers) {
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    gain.gain.value = volume
    source.buffer = buffer
    source.connect(gain)
    gain.connect(destination)
    source.start(at)
    at += buffer.duration + GAP
  }
}
