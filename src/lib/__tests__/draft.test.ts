import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDraft, draftHasWriting, loadDraft, saveDraft } from '@/lib/story/draft'

const DRAFT = {
  source: 'own' as const,
  show: '',
  retell: false,
  idea: 'a fox who keeps a lighthouse at the edge of the world',
  kind: 'graphic' as const,
  length: 'long' as const,
  audience: 'middle',
  draw: true,
  style: 'manga' as const,
}

describe('the story form remembering what was typed', () => {
  beforeEach(() => { window.localStorage.clear() })
  afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear() })

  it('gives back everything that was typed, not just the idea', () => {
    saveDraft(DRAFT)
    expect(loadDraft()).toEqual(DRAFT)
  })

  it('has nothing to give back before anything is typed', () => {
    expect(loadDraft()).toBeNull()
    expect(draftHasWriting(null)).toBe(false)
    expect(draftHasWriting({ idea: '   ' })).toBe(false)
    expect(draftHasWriting({ idea: 'a fox' })).toBe(true)
    // A book from a show is a brief too, even with the idea box empty.
    expect(draftHasWriting({ show: 'Bluey' })).toBe(true)
  })

  it('forgets the draft once the book it describes has been written', () => {
    saveDraft(DRAFT)
    clearDraft()
    expect(loadDraft()).toBeNull()
  })

  it('survives a browser that will not store anything', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    })
    // A forgotten draft is a disappointment; a form that will not open is a fault.
    expect(() => saveDraft(DRAFT)).not.toThrow()
    expect(() => clearDraft()).not.toThrow()
    expect(loadDraft()).toBeNull()
  })

  it('ignores stored nonsense rather than breaking on it', () => {
    window.localStorage.setItem('bookwright:story-draft', 'not json at all')
    expect(loadDraft()).toBeNull()
  })
})
