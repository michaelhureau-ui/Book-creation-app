import { newId } from '@/lib/book'
import { deleteAsset, loadAsset, loadAssetsForBook, saveAsset, type StoredAsset } from '@/lib/db'

/** Artwork is downscaled on import: a phone photo is far larger than a panel needs. */
const MAX_EDGE = 1800
const JPEG_QUALITY = 0.86
export const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/gif'

export interface ImportedAsset {
  id: string
  width: number
  height: number
  bytes: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('That file could not be read as an image.'))
    img.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))),
      type,
      quality,
    )
  })
}

/**
 * Read a picked file, downscale it if oversized, and store it against the book.
 * Assets live in their own object store so that saving a book — which happens
 * on every keystroke — never rewrites megabytes of artwork.
 */
export async function importImage(bookId: string, file: File): Promise<ImportedAsset> {
  if (!file.type.startsWith('image/')) throw new Error('Panels take an image file (PNG, JPEG, WebP, or GIF).')

  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const longest = Math.max(img.naturalWidth, img.naturalHeight)
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1
    const width = Math.max(1, Math.round(img.naturalWidth * scale))
    const height = Math.max(1, Math.round(img.naturalHeight * scale))

    let blob: Blob = file
    let type = file.type
    if (scale < 1) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('This browser could not process the image.')
      ctx.drawImage(img, 0, 0, width, height)
      // PNG keeps transparency; everything else is smaller as JPEG.
      type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      blob = await canvasToBlob(canvas, type, type === 'image/jpeg' ? JPEG_QUALITY : undefined)
    }

    const asset: StoredAsset = {
      id: newId(), bookId, blob, type, width, height, createdAt: Date.now(),
    }
    await saveAsset(asset)
    return { id: asset.id, width, height, bytes: blob.size }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Object URLs are cached per asset: the editor re-renders constantly, and
 * minting a fresh URL each time would leak one on every render.
 */
const urlCache = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()

export async function assetUrl(id: string): Promise<string | null> {
  const cached = urlCache.get(id)
  if (cached) return cached
  const inFlight = pending.get(id)
  if (inFlight) return inFlight

  const load = loadAsset(id)
    .then((asset) => {
      if (!asset) return null
      const url = URL.createObjectURL(asset.blob)
      urlCache.set(id, url)
      return url
    })
    .catch(() => null)
    .finally(() => pending.delete(id))

  pending.set(id, load)
  return load
}

export function releaseAsset(id: string): void {
  const url = urlCache.get(id)
  if (url) {
    URL.revokeObjectURL(url)
    urlCache.delete(id)
  }
}

export async function removeAsset(id: string): Promise<void> {
  releaseAsset(id)
  await deleteAsset(id)
}

/** Decoded images, ready to draw. Used by the page renderer. */
export async function loadImages(ids: string[]): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>()
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const url = await assetUrl(id)
      if (!url) return
      try { out.set(id, await loadImage(url)) } catch { /* a missing asset just leaves the panel empty */ }
    }),
  )
  return out
}

/**
 * Store a drawing made in the app. It already has the right dimensions and is
 * a PNG, so it skips the downscale and re-encode that an imported file needs.
 */
export async function saveDrawing(
  bookId: string,
  blob: Blob,
  width: number,
  height: number,
): Promise<ImportedAsset> {
  const asset: StoredAsset = {
    id: newId(), bookId, blob, type: 'image/png', width, height, createdAt: Date.now(),
  }
  await saveAsset(asset)
  return { id: asset.id, width, height, bytes: blob.size }
}

/**
 * Copy every asset of one book to another, returning old id → new id. Artwork
 * is owned by exactly one book so that deleting a book can clean up after
 * itself without stranding another book's panels.
 */
export async function duplicateAssets(fromBookId: string, toBookId: string): Promise<Map<string, string>> {
  const assets = await loadAssetsForBook(fromBookId)
  const remap = new Map<string, string>()
  for (const asset of assets) {
    const id = newId()
    await saveAsset({ ...asset, id, bookId: toBookId, createdAt: Date.now() })
    remap.set(asset.id, id)
  }
  return remap
}

/** Base64 copies for the JSON backup, so a project file is self-contained. */
export async function exportAssets(bookId: string): Promise<Record<string, { type: string; width: number; height: number; data: string }>> {
  const assets = await loadAssetsForBook(bookId)
  const out: Record<string, { type: string; width: number; height: number; data: string }> = {}
  for (const asset of assets) {
    out[asset.id] = {
      type: asset.type,
      width: asset.width,
      height: asset.height,
      data: await blobToBase64(asset.blob),
    }
  }
  return out
}

export async function importAssets(
  bookId: string,
  assets: Record<string, { type?: string; width?: number; height?: number; data?: string }> | undefined,
): Promise<void> {
  if (!assets) return
  for (const [id, asset] of Object.entries(assets)) {
    if (!asset?.data) continue
    try {
      const blob = base64ToBlob(asset.data, asset.type || 'image/png')
      await saveAsset({
        id,
        bookId,
        blob,
        type: asset.type || 'image/png',
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        createdAt: Date.now(),
      })
    } catch { /* skip an asset that will not decode rather than failing the import */ }
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('Could not read stored artwork.'))
    reader.readAsDataURL(blob)
  })
}

function base64ToBlob(data: string, type: string): Blob {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}
