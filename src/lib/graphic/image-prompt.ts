/**
 * Turning what someone types into a prompt an image model can use, and picking
 * a supported output size for the panel it has to fill.
 *
 * Kept free of network and server code so it can be tested directly, and so
 * both the browser and the serverless function can share it.
 */

export type ArtStyle = 'ink' | 'color' | 'noir' | 'manga' | 'watercolour' | 'retro'

export interface StyleOption {
  id: ArtStyle
  label: string
  /** Appended to the subject to steer the model. */
  modifiers: string
}

export const STYLES: StyleOption[] = [
  {
    id: 'color', label: 'Comic colour',
    modifiers: 'comic book panel art, bold clean ink outlines, flat cel shading, vivid colour',
  },
  {
    id: 'ink', label: 'Ink line art',
    modifiers: 'black and white comic panel, brush and ink line art, crosshatched shadows, high contrast, no colour',
  },
  {
    id: 'noir', label: 'Noir',
    modifiers: 'film noir comic panel, heavy black shadows, dramatic single light source, muted desaturated palette',
  },
  {
    id: 'manga', label: 'Manga',
    modifiers: 'manga panel, screentone shading, expressive linework, black and white',
  },
  {
    id: 'watercolour', label: 'Watercolour',
    modifiers: 'watercolour illustration, soft washes, visible paper texture, gentle palette',
  },
  {
    id: 'retro', label: 'Retro print',
    modifiers: 'vintage 1960s comic panel, halftone dot shading, limited four-colour palette, slight print misregistration',
  },
]

export function styleOf(id: ArtStyle): StyleOption {
  return STYLES.find((s) => s.id === id) ?? STYLES[0]
}

export const MAX_SUBJECT_LENGTH = 300

/** Trim and collapse what the writer typed; empty means nothing to draw. */
export function cleanSubject(subject: string): string {
  return subject.replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT_LENGTH)
}

/**
 * A bare noun like "fox" produces a stock photo from most models. Naming the
 * medium and framing first is what makes the result usable as a comic panel.
 */
export function buildImagePrompt(subject: string, style: ArtStyle = 'color'): string {
  const cleaned = cleanSubject(subject)
  if (!cleaned) throw new Error('Describe what should be in the panel.')
  const { modifiers } = styleOf(style)
  return `${cleaned}. ${modifiers}. Single illustration filling the frame, no panel borders, no speech bubbles, no lettering or text anywhere in the image.`
}

/** Sizes the image endpoint accepts, as width × height. */
export const SUPPORTED_SIZES = ['1024x1024', '1024x1536', '1536x1024'] as const
export type ImageSize = (typeof SUPPORTED_SIZES)[number]

/**
 * Pick whichever supported size is closest in shape to the panel, so the
 * artwork is cropped as little as possible when it lands in the frame.
 */
export function pickSize(aspect: number): ImageSize {
  if (!Number.isFinite(aspect) || aspect <= 0) return '1024x1024'
  let best: ImageSize = SUPPORTED_SIZES[0]
  let bestDistance = Infinity
  for (const size of SUPPORTED_SIZES) {
    const [w, h] = size.split('x').map(Number)
    // Compare in log space so 2:1 and 1:2 are treated as equally far from 1:1.
    const distance = Math.abs(Math.log(w / h) - Math.log(aspect))
    if (distance < bestDistance) {
      bestDistance = distance
      best = size
    }
  }
  return best
}

/** Error shapes the browser needs to tell apart, so it can explain each one. */
export type GenerateErrorCode =
  | 'not_configured'
  | 'empty_prompt'
  | 'rejected'
  | 'rate_limited'
  | 'quota'
  | 'provider_error'
  | 'network'

export interface GenerateError {
  code: GenerateErrorCode
  message: string
}

/** Turn a provider's HTTP failure into something worth showing a writer. */
export function describeProviderFailure(status: number, body: string): GenerateError {
  const lower = body.toLowerCase()
  if (status === 401 || status === 403) {
    return { code: 'not_configured', message: 'The image service rejected the API key. Check the key set on the deployment.' }
  }
  if (status === 429) {
    if (lower.includes('quota') || lower.includes('billing') || lower.includes('insufficient')) {
      return { code: 'quota', message: 'The image account is out of credit. Top it up to keep generating.' }
    }
    return { code: 'rate_limited', message: 'Too many images at once. Wait a moment and try again.' }
  }
  if (
    lower.includes('safety') || lower.includes('content_policy') ||
    lower.includes('content policy') || lower.includes('moderation')
  ) {
    return { code: 'rejected', message: 'The image service would not draw that. Try describing it differently.' }
  }
  return { code: 'provider_error', message: `The image service failed (${status}). Try again in a moment.` }
}
