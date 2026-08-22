import { useEffect, useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import { Icons } from '@/components/Icons'

export function Modal({
  title, subtitle, onClose, children, footer, wide,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    panel.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/35 p-4 py-10 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          'w-full rounded-2xl border border-rule bg-paper-raised shadow-card outline-none',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink-faint">{subtitle}</p>}
          </div>
          <button className="btn btn-ghost -mr-2 -mt-1 px-2" onClick={onClose} aria-label="Close">
            <Icons.Close />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-rule px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

export function Field({
  label, value, onChange, placeholder, multiline, rows = 3, maxLength,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
  rows?: number
  maxLength?: number
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {multiline ? (
        <textarea
          className="field resize-y"
          rows={rows}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="field"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  )
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-paper-sunk text-ink-faint">{icon}</div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-faint">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** A destructive action always asks first — chapters and books are not recoverable. */
export function ConfirmDialog({
  title, body, confirmLabel, onConfirm, onCancel,
}: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn btn-outline" onClick={onCancel}>Cancel</button>
          <button className="btn border-red-600 bg-red-600 text-white hover:bg-red-700" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-soft">{body}</p>
    </Modal>
  )
}
