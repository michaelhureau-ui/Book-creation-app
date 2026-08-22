import type { Book } from '@/types'

const DB_NAME = 'bookwright'
/** v2 added the asset store that holds graphic-novel artwork. */
const DB_VERSION = 2
const BOOKS = 'books'
const ASSETS = 'assets'

export interface StoredAsset {
  id: string
  bookId: string
  blob: Blob
  type: string
  width: number
  height: number
  createdAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(BOOKS)) db.createObjectStore(BOOKS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(ASSETS)) {
        const store = db.createObjectStore(ASSETS, { keyPath: 'id' })
        // Deleting a book has to find its artwork without scanning every asset.
        store.createIndex('bookId', 'bookId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open the local database.'))
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = run(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('Local database write failed.'))
      }),
  )
}

export async function loadAllBooks(): Promise<Book[]> {
  const rows = await tx<Book[]>(BOOKS, 'readonly', (s) => s.getAll() as IDBRequest<Book[]>)
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveBook(book: Book): Promise<void> {
  await tx(BOOKS, 'readwrite', (s) => s.put(book))
}

export async function deleteBook(id: string): Promise<void> {
  await tx(BOOKS, 'readwrite', (s) => s.delete(id))
  // Artwork would otherwise sit in storage forever with nothing referencing it.
  await deleteAssetsForBook(id)
}

export async function saveAsset(asset: StoredAsset): Promise<void> {
  await tx(ASSETS, 'readwrite', (s) => s.put(asset))
}

export async function loadAsset(id: string): Promise<StoredAsset | undefined> {
  return tx<StoredAsset | undefined>(ASSETS, 'readonly', (s) => s.get(id) as IDBRequest<StoredAsset | undefined>)
}

export async function deleteAsset(id: string): Promise<void> {
  await tx(ASSETS, 'readwrite', (s) => s.delete(id))
}

export async function loadAssetsForBook(bookId: string): Promise<StoredAsset[]> {
  return openDb().then(
    (db) =>
      new Promise<StoredAsset[]>((resolve, reject) => {
        const store = db.transaction(ASSETS, 'readonly').objectStore(ASSETS)
        const req = store.index('bookId').getAll(bookId) as IDBRequest<StoredAsset[]>
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('Could not read stored artwork.'))
      }),
  )
}

export async function deleteAssetsForBook(bookId: string): Promise<void> {
  const assets = await loadAssetsForBook(bookId).catch(() => [])
  for (const asset of assets) await deleteAsset(asset.id).catch(() => undefined)
}
