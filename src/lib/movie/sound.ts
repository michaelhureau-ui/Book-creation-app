import type { Shot } from '@/lib/movie/film'

/**
 * The film's score, played live into the recording.
 *
 * Web Audio can be mixed into what MediaRecorder captures, so music and
 * effects end up in the saved file. It is written rather than sampled: a few
 * oscillators on a pentatonic scale, which cannot land on a sour chord however
 * the shots fall, and which costs nothing to ship.
 */

/** A minor pentatonic, in semitones from the root. Nothing here clashes. */
const SCALE = [0, 3, 5, 7, 10]
const ROOT = 146.83 // D3

export function noteAt(step: number): number {
  const octave = Math.floor(step / SCALE.length)
  return ROOT * Math.pow(2, (SCALE[((step % SCALE.length) + SCALE.length) % SCALE.length] + octave * 12) / 12)
}

export interface Score {
  /** The audio to mix into the recording, if there is any. */
  tracks: MediaStreamTrack[]
  cue: (shot: Shot, index: number) => void
  stop: () => Promise<void>
}

const SILENT: Score = { tracks: [], cue: () => {}, stop: async () => {} }

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    // Fade the noise out across the buffer so a whoosh falls away by itself.
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  }
  return buffer
}

/**
 * Build the score. Returns a silent one where the browser has no audio, so a
 * film is still made rather than refused.
 */
export function createScore(volume = 0.5): Score {
  const Ctx = typeof window === 'undefined'
    ? undefined
    : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return SILENT

  let ctx: AudioContext
  let destination: MediaStreamAudioDestinationNode
  try {
    ctx = new Ctx()
    destination = ctx.createMediaStreamDestination()
  } catch {
    return SILENT
  }

  const master = ctx.createGain()
  master.gain.value = Math.max(0, Math.min(1, volume))
  master.connect(destination)

  // A quiet bed that holds the film together between cues.
  const bed = ctx.createGain()
  bed.gain.value = 0
  bed.connect(master)
  const drone = ctx.createOscillator()
  drone.type = 'sine'
  drone.frequency.value = ROOT / 2
  drone.connect(bed)
  drone.start()

  const noise = noiseBuffer(ctx, 1.2)

  const pluck = (frequency: number, at: number, length: number, level: number, type: OscillatorType = 'triangle'): void => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(level, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
    osc.connect(gain)
    gain.connect(master)
    osc.start(at)
    osc.stop(at + length + 0.05)
  }

  const whoosh = (at: number, level: number): void => {
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    source.buffer = noise
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(400, at)
    filter.frequency.exponentialRampToValueAtTime(2400, at + 0.35)
    gain.gain.setValueAtTime(level, at)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45)
    source.connect(filter)
    filter.connect(gain)
    gain.connect(master)
    source.start(at)
    source.stop(at + 0.5)
  }

  const thump = (at: number): void => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(150, at)
    osc.frequency.exponentialRampToValueAtTime(42, at + 0.3)
    gain.gain.setValueAtTime(0.5, at)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5)
    osc.connect(gain)
    gain.connect(master)
    osc.start(at)
    osc.stop(at + 0.55)
  }

  let step = 0

  return {
    tracks: destination.stream.getAudioTracks(),
    cue(shot, index) {
      const at = ctx.currentTime + 0.01
      switch (shot.kind) {
        case 'cover':
          bed.gain.setTargetAtTime(0.06, at, 1.2)
          for (const [i, note] of [0, 2, 4, 7].entries()) pluck(noteAt(note + 5), at + i * 0.22, 1.9, 0.14)
          break
        case 'chapter':
          // A chapter turns the harmony over, so the film does not sit still.
          step += 2
          bed.gain.setTargetAtTime(0.06, at, 0.8)
          pluck(noteAt(step + 5), at, 1.6, 0.13)
          pluck(noteAt(step + 8), at + 0.18, 1.5, 0.1)
          break
        case 'end':
          bed.gain.setTargetAtTime(0.02, at, 1.5)
          for (const [i, note] of [7, 4, 2, 0].entries()) pluck(noteAt(note + 5), at + i * 0.3, 2.4, 0.13)
          break
        case 'panel': {
          whoosh(at, 0.055)
          // A sound effect in the panel gets heard as well as seen.
          if (shot.balloons.some((b) => b.kind === 'sfx' || b.kind === 'shout')) thump(at + 0.08)
          else pluck(noteAt(step + (index % 5)), at + 0.05, 1.1, 0.055, 'sine')
          break
        }
        case 'page':
          whoosh(at, 0.07)
          pluck(noteAt(step + (index % 5)), at + 0.05, 1.3, 0.06, 'sine')
          break
        default:
          break
      }
    },
    async stop() {
      try {
        bed.gain.setTargetAtTime(0, ctx.currentTime, 0.2)
        drone.stop(ctx.currentTime + 0.6)
      } catch { /* already stopped */ }
      await new Promise((resolve) => setTimeout(resolve, 150))
      await ctx.close().catch(() => undefined)
    },
  }
}
