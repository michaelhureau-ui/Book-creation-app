import type { Shot } from '@/lib/movie/film'

/**
 * The voice that reads the film aloud.
 *
 * This is the browser's own speech, which is free and needs no key — but no
 * browser lets a page capture it, so it is heard while the film plays and is
 * not in the saved file. The alternative, a speech API, would be one call per
 * line and would empty an allowance long before it finished a book.
 */
export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** What is said over one shot, in the order a reader would take it. */
export function linesFor(shot: Shot): string[] {
  switch (shot.kind) {
    case 'cover':
      return [shot.title, shot.subtitle, `by ${shot.author}`].map((l) => l.trim()).filter(Boolean)
    case 'chapter':
      return [shot.number ? `Chapter ${shot.number}. ${shot.title}` : shot.title]
    case 'end':
      return ['The end.']
    case 'panel':
      return shot.balloons
        .map((balloon) => {
          const text = balloon.text.trim()
          if (!text) return ''
          // A sound effect is a noise, not a line; saying "sound effect" first
          // would be reading the stage directions aloud.
          if (balloon.kind === 'sfx') return text
          if (balloon.kind === 'caption') return text
          return balloon.speaker ? `${balloon.speaker} says, ${text}` : text
        })
        .filter(Boolean)
    default:
      return []
  }
}

export interface Narrator {
  speak: (shot: Shot) => void
  cancel: () => void
}

export function createNarrator(enabled: boolean): Narrator {
  if (!enabled || !speechSupported()) return { speak: () => {}, cancel: () => {} }
  const voices = window.speechSynthesis

  return {
    speak(shot) {
      const lines = linesFor(shot)
      if (lines.length === 0) return
      // Each shot interrupts the last: a film that falls behind its own voice
      // ends up describing a picture that left the screen a minute ago.
      voices.cancel()
      for (const line of lines) {
        const utterance = new SpeechSynthesisUtterance(line)
        utterance.rate = 1.02
        utterance.pitch = 1
        voices.speak(utterance)
      }
    },
    cancel() {
      voices.cancel()
    },
  }
}
