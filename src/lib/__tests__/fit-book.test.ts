import { afterEach, describe, expect, it, vi } from 'vitest'
import { peopleOf, speakersIn } from '@/lib/graphic/fit-book'
import { LookFailed, seePanel } from '@/lib/graphic/see'
import { createBalloon, createPanel } from '@/lib/graphic/pages'
import type { Balloon, BalloonKind, Panel } from '@/types'

function line(kind: BalloonKind, text: string, speaker?: string): Balloon {
  return { ...createBalloon(kind), text, speaker }
}

function panelWith(balloons: Balloon[]): Panel {
  return { ...createPanel(), balloons }
}

describe('who to look for in a panel', () => {
  it('lists the speakers in the order they first speak', () => {
    expect(speakersIn(panelWith([
      line('speech', 'Mine.', 'Kara'),
      line('speech', 'Mine too.', 'Dev'),
      line('speech', 'Still mine.', 'Kara'),
    ]))).toEqual(['Kara', 'Dev'])
  })

  it('ignores captions, sound effects and unattributed lines', () => {
    expect(speakersIn(panelWith([
      line('caption', 'Midwinter.', 'Narrator'),
      line('sfx', 'THUMP', 'Kara'),
      line('speech', 'Who said that?'),
    ]))).toEqual([])
  })

  it('does not ask twice about the same person named differently', () => {
    expect(speakersIn(panelWith([
      line('speech', 'Here.', 'Kara'),
      line('speech', 'Here.', 'kara '),
    ]))).toEqual(['Kara'])
  })
})

describe('peopleOf', () => {
  it('keys the answer the way the fitter looks a speaker up', () => {
    const people = peopleOf({ people: [{ name: 'Kara', x: 0.3, y: 0.4 }], faces: [] })
    expect(people.get('kara')).toEqual({ x: 0.3, y: 0.4 })
  })
})

describe('asking what is in a picture', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the people and faces it was told about', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ people: [{ name: 'Kara', x: 0.8, y: 0.4 }], faces: [] }),
    })))
    const seen = await seePanel('data:image/jpeg;base64,AAAA', ['Kara'], '')
    expect(seen.people[0].name).toBe('Kara')
  })

  it('tells a build with no such endpoint apart from a service that failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => null })))
    await expect(seePanel('AAAA', [], '')).rejects.toMatchObject({ code: 'stale_build' })
  })

  it('passes the endpoint\'s own reason through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 501,
      json: async () => ({ error: { code: 'not_configured', message: 'Not switched on.' } }),
    })))
    await expect(seePanel('AAAA', [], '')).rejects.toMatchObject({ code: 'not_configured' })
  })

  it('reports being offline as being offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const err = await seePanel('AAAA', [], '').catch((e) => e)
    expect(err).toBeInstanceOf(LookFailed)
    expect((err as LookFailed).code).toBe('network')
  })

  it('treats a missing list as nobody found, not as a crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
    expect(await seePanel('AAAA', ['Kara'], '')).toEqual({ people: [], faces: [] })
  })
})
