import { describe, expect, it } from 'vitest'
import {
  buildImagePrompt, describeProviderFailure, MAX_SUBJECT_LENGTH as SERVER_MAX,
  pickSize, STYLE_MODIFIERS, SUPPORTED_SIZES,
} from '../../../api/generate-image'
import { cleanSubject, MAX_SUBJECT_LENGTH, STYLES, styleOf } from '@/lib/graphic/image-prompt'

describe('style list', () => {
  it('offers every style the server knows, and no others', () => {
    // The endpoint has to be self-contained to deploy, so its style table is a
    // separate copy. This is what stops the two drifting apart.
    expect(STYLES.map((s) => s.id).sort()).toEqual(Object.keys(STYLE_MODIFIERS).sort())
  })

  it('agrees with the server on how long a subject may be', () => {
    expect(MAX_SUBJECT_LENGTH).toBe(SERVER_MAX)
  })

  it('falls back to the first style for an unknown one', () => {
    expect(styleOf('nonsense' as never)).toBe(STYLES[0])
  })
})

describe('cleanSubject', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanSubject('  a   red \n fox ')).toBe('a red fox')
  })
  it('caps runaway input', () => {
    expect(cleanSubject('x'.repeat(1000))).toHaveLength(MAX_SUBJECT_LENGTH)
  })
  it('reports nothing for blank input', () => {
    expect(cleanSubject('   \n  ')).toBe('')
  })
})

describe('buildImagePrompt', () => {
  it('keeps what the writer typed and adds the medium', () => {
    const prompt = buildImagePrompt('a red fox in the snow', 'color')
    expect(prompt).toContain('a red fox in the snow')
    expect(prompt).toContain('comic book panel art')
  })

  it('asks for no lettering, since balloons are added afterwards', () => {
    const prompt = buildImagePrompt('a bus at night', 'color')
    expect(prompt).toMatch(/no speech bubbles/i)
    expect(prompt).toMatch(/no lettering or text/i)
  })

  it('applies the chosen style', () => {
    expect(buildImagePrompt('a fox', 'noir')).toContain('film noir')
    expect(buildImagePrompt('a fox', 'manga')).toContain('screentone')
  })

  it('falls back to the default style rather than dropping the modifiers', () => {
    expect(buildImagePrompt('a fox', 'nonsense')).toContain('comic book panel art')
  })

  it('refuses an empty subject rather than prompting for nothing', () => {
    expect(() => buildImagePrompt('   ', 'color')).toThrow(/describe what/i)
  })
})

describe('pickSize', () => {
  it('returns a supported size for any panel shape', () => {
    for (const aspect of [0.2, 0.5, 0.8, 1, 1.4, 2, 5]) {
      expect(SUPPORTED_SIZES).toContain(pickSize(aspect) as never)
    }
  })

  it('matches the panel orientation', () => {
    expect(pickSize(1)).toBe('1024x1024')
    expect(pickSize(0.5)).toBe('1024x1536')
    expect(pickSize(2)).toBe('1536x1024')
  })

  it('treats mirrored aspects symmetrically', () => {
    expect(pickSize(1.9)).toBe('1536x1024')
    expect(pickSize(1 / 1.9)).toBe('1024x1536')
  })

  it('falls back to square for a degenerate aspect', () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pickSize(bad)).toBe('1024x1024')
    }
  })
})

describe('describeProviderFailure', () => {
  it('separates a bad key from a rate limit from exhausted credit', () => {
    expect(describeProviderFailure(401, 'invalid api key').code).toBe('not_configured')
    expect(describeProviderFailure(429, 'Rate limit reached').code).toBe('rate_limited')
    expect(describeProviderFailure(429, 'You exceeded your current quota').code).toBe('quota')
  })

  it('recognises a content refusal so the writer can reword', () => {
    expect(describeProviderFailure(400, 'your request was rejected by our safety system').code).toBe('rejected')
    expect(describeProviderFailure(400, 'content_policy_violation').code).toBe('rejected')
  })

  it('falls back to a generic provider error with the status', () => {
    const error = describeProviderFailure(503, 'upstream unavailable')
    expect(error.code).toBe('provider_error')
    expect(error.message).toContain('503')
  })
})
