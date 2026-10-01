// Lo que el usuario hace en su teléfono (IndexedDB). Solo se agrega: nada se borra
// cuando el admin publica contenido nuevo.
import type { BalanceNote } from '../shared/balance.ts'
import type { Bytes } from '../shared/crypto.ts'

const DB_NAME = 'mamata'
const DB_VERSION = 1
const KEY_ENTRY = 'contentKey'
const LAST_GOOD_ENTRY = 'lastGoodContent'

export interface Prefs {
  skipBalanceExplainer: boolean
  onboarded: boolean
}

const DEFAULT_PREFS: Prefs = { skipBalanceExplainer: false, onboarded: false }

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function openDatabase(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB_NAME, DB_VERSION)
  req.onupgradeneeded = () => {
    const db = req.result
    db.createObjectStore('kv')
    db.createObjectStore('reads', { keyPath: 'messageId' })
    db.createObjectStore('done', { keyPath: 'id' })
    db.createObjectStore('balances', { autoIncrement: true })
  }
  return request(req).then((db) => {
    // Si otra pestaña actualiza o borra la base, soltar la conexión para no bloquearla.
    db.onversionchange = () => db.close()
    return db
  })
}

export function deleteLocalDatabase(): Promise<void> {
  return request(indexedDB.deleteDatabase(DB_NAME)).then(() => undefined)
}

export class LocalStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<LocalStore> {
    return new LocalStore(await openDatabase())
  }

  static doneKey(reminderId: string, occurrence: string): string {
    return `${reminderId}|${occurrence}`
  }

  close(): void {
    this.db.close()
  }

  private store(name: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
    return this.db.transaction(name, mode).objectStore(name)
  }

  async getKey(): Promise<string | null> {
    const value: unknown = await request(this.store('kv').get(KEY_ENTRY))
    return typeof value === 'string' ? value : null
  }

  async setKey(key: string): Promise<void> {
    await request(this.store('kv', 'readwrite').put(key, KEY_ENTRY))
  }

  // Última versión del contenido que se pudo descifrar (sigue cifrada).
  async getLastGoodContent(): Promise<Bytes | null> {
    const value: unknown = await request(this.store('kv').get(LAST_GOOD_ENTRY))
    return value instanceof ArrayBuffer ? new Uint8Array(value) : null
  }

  async setLastGoodContent(sealed: Bytes): Promise<void> {
    await request(this.store('kv', 'readwrite').put(sealed.slice().buffer, LAST_GOOD_ENTRY))
  }

  async getPref<K extends keyof Prefs>(name: K): Promise<Prefs[K]> {
    const value: unknown = await request(this.store('kv').get(`pref:${name}`))
    return value === undefined ? DEFAULT_PREFS[name] : (value as Prefs[K])
  }

  async setPref<K extends keyof Prefs>(name: K, value: Prefs[K]): Promise<void> {
    await request(this.store('kv', 'readwrite').put(value, `pref:${name}`))
  }

  async markRead(messageId: string, readAt: string): Promise<void> {
    const existing: unknown = await request(this.store('reads').get(messageId))
    if (existing) return
    await request(this.store('reads', 'readwrite').put({ messageId, readAt }))
  }

  async readMessageIds(): Promise<Set<string>> {
    const keys = await request(this.store('reads').getAllKeys())
    return new Set(keys.map(String))
  }

  async markDone(reminderId: string, occurrence: string, doneAt: string): Promise<void> {
    const id = LocalStore.doneKey(reminderId, occurrence)
    await request(this.store('done', 'readwrite').put({ id, reminderId, occurrence, doneAt }))
  }

  async doneOccurrences(): Promise<Set<string>> {
    const keys = await request(this.store('done').getAllKeys())
    return new Set(keys.map(String))
  }

  async addBalanceNote(note: BalanceNote): Promise<void> {
    await request(this.store('balances', 'readwrite').add({ ...note }))
  }

  async balanceNotes(): Promise<BalanceNote[]> {
    return (await request(this.store('balances').getAll())) as BalanceNote[]
  }
}
