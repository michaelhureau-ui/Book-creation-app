/**
 * Asking what is actually in a panel.
 *
 * Everything else about fitting lettering can be worked out from the pixels.
 * Where the speaker is cannot: edge energy finds the busiest part of a
 * picture, and on painted artwork that is a brick wall or a tree line as often
 * as a person — a smooth cheek reads as one of the *quietest* places in the
 * frame. So the app stops guessing and asks a model that can see the panel.
 *
 * The call is small and cheap — one glance per panel, at a thumbnail — and
 * entirely optional: if it is not configured, not reachable, or refused, the
 * caller falls back to the old guess rather than stopping.
 */

export interface Spot {
  name: string
  x: number
  y: number
}

export interface Seen {
  people: Spot[]
  faces: { x: number; y: number }[]
}

/** How wide the thumbnail sent for a look is. A glance needs no more. */
export const LOOK_SIZE = 448
/** JPEG quality: enough to make out who is where, small enough to post fast. */
const LOOK_QUALITY = 0.62

/**
 * A panel's visible crop as a small JPEG data URL, or null if the browser
 * refuses to read the canvas back (a tainted canvas, for instance).
 */
export function thumbnailOf(canvas: HTMLCanvasElement): string | null {
  try {
    const url = canvas.toDataURL('image/jpeg', LOOK_QUALITY)
    return url.startsWith('data:image/jpeg') ? url : null
  } catch {
    return null
  }
}

export class LookFailed extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * Ask where the named characters are in this picture.
 *
 * Throws `LookFailed` so the caller can tell "not switched on" from "this one
 * panel did not work" — the first is worth saying once, the second is worth
 * ignoring.
 */
export async function seePanel(
  image: string,
  names: string[],
  note: string,
  signal?: AbortSignal,
): Promise<Seen> {
  let response: Response
  try {
    response = await fetch('/api/see-panel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, names, note }),
      signal,
    })
  } catch {
    throw new LookFailed('network', 'Could not reach the service that looks at the pictures.')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null
    if (response.status === 404) {
      throw new LookFailed('stale_build', 'This version of the app was built before it could look at the pictures.')
    }
    throw new LookFailed(
      body?.error?.code ?? 'provider_error',
      body?.error?.message ?? `Looking at the panel failed (${response.status}).`,
    )
  }

  const body = await response.json().catch(() => null) as Seen | null
  return { people: body?.people ?? [], faces: body?.faces ?? [] }
}

/** Whether the deployment can look at pictures at all. */
export async function canSeePanels(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch('/api/see-panel', { signal })
    if (!res.ok) return false
    const body = await res.json() as { configured?: boolean }
    return Boolean(body?.configured)
  } catch {
    return false
  }
}
