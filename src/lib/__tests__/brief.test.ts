import { describe, expect, it } from 'vitest'
import { brief, withoutNames } from '@/lib/graphic/brief'

const CAST = [
  { name: 'Rell', look: 'a small red fox in a yellow oilskin coat, always wet' },
  { name: 'Hask', look: 'a tall grey heron with a crooked beak' },
]

describe('the brief a picture service is actually sent', () => {
  it('swaps a name for what the character looks like', () => {
    const out = brief('Rell climbs the lighthouse stair.', CAST)
    expect(out).toContain('a small red fox in a yellow oilskin coat')
    expect(out).not.toMatch(/\bRell\b/)
  })

  it('describes somebody once in full, then briefly', () => {
    const out = brief('Rell looks at the lamp. Rell climbs down. Rell waits.', CAST)
    expect(out.match(/always wet/g) ?? []).toHaveLength(1)
    // The later mentions keep the shortest useful form, not the whole sentence.
    expect(out.match(/a small red fox/g) ?? []).toHaveLength(3)
  })

  it('handles two characters and a possessive', () => {
    const out = brief("Hask lands on Rell's rail.", CAST)
    expect(out).toContain('a tall grey heron')
    expect(out).toContain('a small red fox')
    expect(out).not.toMatch(/\bHask\b|\bRell\b/)
  })

  it('leaves a brief alone when nobody in it is in the cast', () => {
    const note = 'An empty lamp room, salt on the glass.'
    expect(brief(note, CAST)).toBe(note)
    expect(brief(note, [])).toBe(note)
  })
})

describe('the last-ditch brief after a refusal', () => {
  it('takes out the names a picture service will not draw', () => {
    // This is the shape that comes back PROHIBITED_CONTENT.
    const out = withoutNames('Spider-Man swings past Elsa over the rooftops.')
    expect(out).not.toContain('Spider-Man')
    expect(out).not.toContain('Elsa')
    expect(out).toContain('the character')
  })

  it('says outright that the characters are nobody in particular', () => {
    expect(withoutNames('A fox on a quay.')).toMatch(/not resembling any existing film, show or comic/i)
  })

  it('leaves ordinary words that happen to start a sentence', () => {
    const out = withoutNames('The fox waits. Behind him the sea turns over.')
    expect(out).toContain('The fox waits')
    expect(out).toContain('Behind him')
  })
})
