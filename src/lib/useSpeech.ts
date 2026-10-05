import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Dictation through the browser's own speech recognition.
 *
 * This is deliberately not the image key's provider: the browser does the
 * listening, so nothing is sent to the deployment, no allowance is spent, and
 * it keeps working when the key is missing. Firefox has never shipped it, so
 * `supported` is false there and the button is simply not offered.
 */

interface SpeechEvent {
  resultIndex: number
  results: { isFinal: boolean; 0: { transcript: string }; length: number }[] & { length: number }
}

interface Recognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechEvent) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

type RecognitionClass = new () => Recognition

function recognitionClass(): RecognitionClass | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionClass
    webkitSpeechRecognition?: RecognitionClass
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export interface Speech {
  supported: boolean
  listening: boolean
  error: string | null
  start: () => void
  stop: () => void
}

const MESSAGES: Record<string, string> = {
  'not-allowed': 'The microphone is blocked. Allow it for this site and try again.',
  'service-not-allowed': 'The microphone is blocked. Allow it for this site and try again.',
  'no-speech': 'Nothing was heard. Try again.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition could not reach the network.',
}

/**
 * `onText` receives each finished phrase, so the caller decides whether to
 * append it or replace what is there.
 */
export function useSpeech(onText: (text: string) => void, lang = 'en-US'): Speech {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognition = useRef<Recognition | null>(null)
  // Kept in a ref so restarting never rebuilds the recogniser mid-sentence.
  const handler = useRef(onText)
  handler.current = onText

  const supported = recognitionClass() !== null

  useEffect(() => () => {
    recognition.current?.abort()
    recognition.current = null
  }, [])

  const stop = useCallback(() => {
    recognition.current?.stop()
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Recogniser = recognitionClass()
    if (!Recogniser) return
    recognition.current?.abort()
    setError(null)

    const session = new Recogniser()
    session.continuous = true
    session.interimResults = false
    session.lang = lang
    session.onresult = (event) => {
      let said = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) said += result[0].transcript
      }
      if (said.trim()) handler.current(said.trim())
    }
    session.onerror = (event) => {
      const code = event.error ?? ''
      // Someone pausing is not a failure worth a red message.
      if (code !== 'aborted' && code !== 'no-speech') {
        setError(MESSAGES[code] ?? 'The microphone could not be used.')
      }
      setListening(false)
    }
    session.onend = () => setListening(false)

    recognition.current = session
    try {
      session.start()
      setListening(true)
    } catch {
      setError('The microphone could not be started.')
      setListening(false)
    }
  }, [lang])

  return { supported, listening, error, start, stop }
}
