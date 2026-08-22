import { describe, expect, it } from 'vitest'
import { boardSize, colorsMatch, floodFill, parseHex, thin } from '@/lib/graphic/drawing'

/** A plain RGBA buffer standing in for a canvas, for fill tests. */
function makeImage(width: number, height: number, fill = [255, 255, 255, 255]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = fill[3]
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData
}

const at = (img: ImageData, x: number, y: number): number[] => {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}

const set = (img: ImageData, x: number, y: number, rgba: number[]): void => {
  const i = (y * img.width + x) * 4
  img.data[i] = rgba[0]; img.data[i + 1] = rgba[1]; img.data[i + 2] = rgba[2]; img.data[i + 3] = rgba[3]
}

describe('parseHex', () => {
  it('reads the usual forms', () => {
    expect(parseHex('#ffffff')).toEqual({ r: 255, g: 255, b: 255, a: 255 })
    expect(parseHex('000000')).toEqual({ r: 0, g: 0, b: 0, a: 255 })
    expect(parseHex('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    expect(parseHex('#12345678')).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 0x78 })
  })

  it('falls back to opaque black rather than producing NaN channels', () => {
    for (const bad of ['', 'nonsense', '#12345', 'rgb(1,2,3)']) {
      expect(parseHex(bad)).toEqual({ r: 0, g: 0, b: 0, a: 255 })
    }
  })
})

describe('colorsMatch', () => {
  const img = makeImage(1, 1, [100, 100, 100, 255])
  it('respects the tolerance in both directions', () => {
    expect(colorsMatch(img.data, 0, { r: 100, g: 100, b: 100, a: 255 }, 0)).toBe(true)
    expect(colorsMatch(img.data, 0, { r: 110, g: 90, b: 100, a: 255 }, 10)).toBe(true)
    expect(colorsMatch(img.data, 0, { r: 120, g: 100, b: 100, a: 255 }, 10)).toBe(false)
  })
})

describe('floodFill', () => {
  const RED = { r: 255, g: 0, b: 0, a: 255 }

  it('fills a blank canvas edge to edge', () => {
    const img = makeImage(8, 6)
    expect(floodFill(img, 0, 0, RED)).toBe(true)
    expect(at(img, 0, 0)).toEqual([255, 0, 0, 255])
    expect(at(img, 7, 5)).toEqual([255, 0, 0, 255])
  })

  it('stops at a drawn boundary and leaves the far side alone', () => {
    const img = makeImage(9, 5)
    // A solid black column down the middle divides the canvas in two.
    for (let y = 0; y < 5; y++) set(img, 4, y, [0, 0, 0, 255])
    floodFill(img, 0, 0, RED)
    expect(at(img, 3, 2)).toEqual([255, 0, 0, 255])
    expect(at(img, 4, 2)).toEqual([0, 0, 0, 255])
    expect(at(img, 5, 2)).toEqual([255, 255, 255, 255])
  })

  it('reaches around an obstacle through a gap', () => {
    const img = makeImage(9, 5)
    // The same wall, but with a hole at y = 2.
    for (let y = 0; y < 5; y++) if (y !== 2) set(img, 4, y, [0, 0, 0, 255])
    floodFill(img, 0, 0, RED)
    expect(at(img, 8, 0)).toEqual([255, 0, 0, 255])
  })

  it('does nothing when the target already holds the fill colour', () => {
    const img = makeImage(4, 4, [255, 0, 0, 255])
    expect(floodFill(img, 1, 1, RED)).toBe(false)
  })

  it('ignores a click outside the canvas', () => {
    const img = makeImage(4, 4)
    expect(floodFill(img, -1, 2, RED)).toBe(false)
    expect(floodFill(img, 4, 0, RED)).toBe(false)
    expect(at(img, 0, 0)).toEqual([255, 255, 255, 255])
  })

  it('completes on a large canvas without exhausting the stack', () => {
    const img = makeImage(600, 400)
    expect(floodFill(img, 300, 200, RED)).toBe(true)
    expect(at(img, 0, 0)).toEqual([255, 0, 0, 255])
    expect(at(img, 599, 399)).toEqual([255, 0, 0, 255])
  })

  it('bridges anti-aliased edges within the tolerance', () => {
    const img = makeImage(6, 3)
    set(img, 3, 1, [250, 250, 250, 255])
    floodFill(img, 0, 1, { r: 0, g: 0, b: 255, a: 255 }, 32)
    expect(at(img, 3, 1)).toEqual([0, 0, 255, 255])
  })
})

describe('thin', () => {
  it('drops samples that are too close together', () => {
    const points = [{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 5, y: 0 }, { x: 5.1, y: 0.1 }]
    expect(thin(points, 1.2)).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }])
  })

  it('always keeps at least one point, so a tap still marks', () => {
    expect(thin([{ x: 3, y: 4 }], 50)).toEqual([{ x: 3, y: 4 }])
    expect(thin([], 1)).toEqual([])
  })
})

describe('boardSize', () => {
  it('caps the longest edge and keeps the panel shape', () => {
    expect(boardSize(2, 1400)).toEqual({ width: 1400, height: 700 })
    expect(boardSize(0.5, 1400)).toEqual({ width: 700, height: 1400 })
    expect(boardSize(1, 1400)).toEqual({ width: 1400, height: 1400 })
  })

  it('survives a degenerate aspect rather than producing NaN', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const size = boardSize(bad, 800)
      expect(Number.isFinite(size.width)).toBe(true)
      expect(size.width).toBeGreaterThan(0)
      expect(size.height).toBeGreaterThan(0)
    }
  })
})
