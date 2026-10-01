// Lo que el usuario hace en su teléfono (IndexedDB). Solo se agrega: nada se borra
// cuando el admin publica contenido nuevo.
import type { Event } from 'nostr-tools'
import { generateSecretKey } from 'nostr-tools/pure'
import type { BalanceNote } from '../shared/balance.ts'
import { dTag } from '../shared/nostr/events.ts'

const DB_NAME = 'mamata'
// v2: identidad Nostr del teléfono y eventos recibidos de los relays.
const DB_VERSION = 2
const PHONE_SECRET_ENTRY = 'phoneSecret'
const ADMIN_ENTRY = 'adminPubkey'

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
  // Crea solo lo que falta: al pasar de v1 a v2 no se pierde nada de lo anotado.
  req.onupgradeneeded = () => {
    const db = req.result
    const create = (name: string, options?: IDBObjectStoreParameters) => {
      if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, options)
    }
    create('kv')
    create('reads', { keyPath: 'messageId' })
    create('done', { keyPath: 'id' })
    create('balances', { autoIncrement: true })
    create('events')
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





  // Clave Nostr del teléfono: se crea la primera vez y nunca sale de acá.
  async phoneSecret(): Promise<Uint8Array> {
    const stored: unknown = await request(this.store('kv').get(PHONE_SECRET_ENTRY))
    if (stored instanceof ArrayBuffer) return new Uint8Array(stored)
    const secret = generateSecretKey()
    await request(this.store('kv', 'readwrite').put(secret.slice().buffer, PHONE_SECRET_ENTRY))
    return secret
  }

  async getAdminPubkey(): Promise<string | null> {
    const value: unknown = await request(this.store('kv').get(ADMIN_ENTRY))
    return typeof value === 'string' ? value : null
  }

  async setAdminPubkey(pubkey: string): Promise<void> {
    await request(this.store('kv', 'readwrite').put(pubkey, ADMIN_ENTRY))
  }

  // Un evento por dirección (kind, autor, d): guardar reemplaza al anterior.
  async saveEvent(event: Event): Promise<void> {
    await request(this.store('events', 'readwrite').put(event, `${event.kind}:${event.pubkey}:${dTag(event)}`))
  }

  async loadEvents(): Promise<Event[]> {
    return (await request(this.store('events').getAll())) as Event[]
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
