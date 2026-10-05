import clsx from 'clsx'
import { Icons } from '@/components/Icons'
import { useSpeech } from '@/lib/useSpeech'

/**
 * Speak instead of typing. Hidden entirely where the browser cannot do it,
 * rather than offered and then failing.
 */
export function MicButton({ onText, label, disabled, className }: {
  /** Each finished phrase, for the caller to append or replace. */
  onText: (text: string) => void
  label: string
  disabled?: boolean
  className?: string
}) {
  const speech = useSpeech(onText)
  if (!speech.supported) return null

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={speech.listening}
        title={speech.listening ? 'Stop listening' : label}
        aria-label={speech.listening ? 'Stop listening' : label}
        className={clsx(
          'rounded-md border p-1.5 transition-colors disabled:opacity-40',
          speech.listening
            ? 'animate-pulse border-red-400 bg-red-50 text-red-700'
            : 'border-rule text-ink-soft hover:border-accent hover:text-ink',
          className,
        )}
        onClick={() => (speech.listening ? speech.stop() : speech.start())}
      >
        <Icons.Mic className="h-4 w-4" />
      </button>
      {speech.error && <p className="mt-1 text-xs text-red-700">{speech.error}</p>}
    </>
  )
}
