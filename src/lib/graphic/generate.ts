import { saveDrawing } from '@/lib/graphic/assets'
import { cleanSubject, type ArtStyle, type GenerateError } from '@/lib/graphic/image-prompt'

/** Thrown with a code the UI can explain, rather than a raw HTTP failure. */
export class GenerationFailed extends Error {
  readonly code: GenerateError['code']
  constructor(error: GenerateError) {
    super(error.message)
    this.name = 'GenerationFailed'
    this.code = error.code
  }
}

function base64ToBlob(data: string, mime: string): Blob {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * Measuring is best-effort: the stored dimensions are metadata, and the panel
 * cover-fits whatever it is given. So this never blocks — if the image reports
 * neither load nor error, it settles at zero rather than leaving the caller
 * (and the "Drawing…" spinner) waiting forever.
 */
const MEASURE_TIMEOUT_MS = 4000

function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    let settled = false

    const finish = (width: number, height: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve({ width, height })
    }

    const timer = setTimeout(() => finish(0, 0), MEASURE_TIMEOUT_MS)
    img.onload = () => finish(img.naturalWidth, img.naturalHeight)
    img.onerror = () => finish(0, 0)
    img.src = url
  })
}

/**
 * Ask the server for a picture of `subject` and store it as a panel asset.
 * Returns the new asset id.
 */
export async function generatePanelArt(
  bookId: string,
  subject: string,
  style: ArtStyle,
  aspect: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!cleanSubject(subject)) {
    throw new GenerationFailed({ code: 'empty_prompt', message: 'Type what should be in the panel first.' })
  }

  let response: Response
  try {
    response = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, style, aspect }),
      signal,
    })
  } catch {
    throw new GenerationFailed({ code: 'network', message: 'Could not reach the image service. Check your connection.' })
  }

  if (!response.ok) {
    // The endpoint reports a structured error; fall back if something else answered.
    const body = await response.json().catch(() => null) as { error?: GenerateError } | null
    if (body?.error) throw new GenerationFailed(body.error)

    // A 404 with no error body means the endpoint itself is not there — this
    // build predates image generation. Saying "the image service failed" would
    // send someone hunting for a problem with their API key instead.
    if (response.status === 404) {
      throw new GenerationFailed({
        code: 'stale_build',
        message: 'This version of the app was built before picture-making existed, so there is nothing here to ask.',
      })
    }

    throw new GenerationFailed({
      code: 'provider_error',
      message: `The image service failed (${response.status}).`,
    })
  }

  const body = await response.json().catch(() => null) as { image?: string; mime?: string } | null
  if (!body?.image) {
    throw new GenerationFailed({ code: 'provider_error', message: 'The image service returned no picture.' })
  }

  const blob = base64ToBlob(body.image, body.mime || 'image/png')
  const { width, height } = await imageSize(blob)
  const asset = await saveDrawing(bookId, blob, width, height)
  return asset.id
}

/** What to tell the writer when generation is switched off on this deployment. */
export const NOT_CONFIGURED_HELP =
  'Add a GOOGLE_API_KEY (free tier at aistudio.google.com) or an OPENAI_API_KEY environment variable to this app on Vercel, then redeploy. Until then you can still draw panels or bring in your own pictures.'

/** Shown when the deployment is older than the feature itself. */
export const STALE_BUILD_HELP =
  'Open the newest deployment of the app — or redeploy the latest commit — and try again.'
