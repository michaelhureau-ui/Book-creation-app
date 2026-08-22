import type { Book } from '@/types'

const DB_NAME = 'bookwright'
const DB_VERSION = 1
const STORE = 'books'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open the local database.'))
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('Local database write failed.'))
      }),
  )
}

export async function loadAllBooks(): Promise<Book[]> {
  const rows = await tx<Book[]>('readonly', (s) => s.getAll() as IDBRequest<Book[]>)
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveBook(book: Book): Promise<void> {
  await tx('readwrite', (s) => s.put(book))
}

export async function deleteBook(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
}
