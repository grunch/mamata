// Sincronización del teléfono con los relays: guarda la versión más nueva de cada evento
// del admin (nunca vuelve atrás), abre la clave de contenido cuando el admin aprueba el
// teléfono y arma el Content que usan las pantallas. Funciona igual con lo guardado y sin internet.
import type { Event } from 'nostr-tools'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import type { Content } from '../shared/model.ts'
import { ITEM_KINDS, KIND } from '../shared/nostr/constants.ts'
import { openItem } from '../shared/nostr/content-key.ts'
import { buildContent, dTag, parseEnvelope, parseProfile, type ItemEnvelope, type Profile } from '../shared/nostr/events.ts'
import { openDeviceKey, pairingRequestTemplate } from '../shared/nostr/keys.ts'
import { pairingCode } from '../shared/nostr/pairing.ts'
import { publishedEnough, type Relays } from '../shared/nostr/relays.ts'

export interface SyncCache {
  loadEvents(): Promise<Event[]>
  saveEvent(event: Event): Promise<void>
}

export type RelayLike = Pick<Relays, 'subscribe' | 'publish'>

export type SyncState =
  | { status: 'waiting'; code: string }
  | { status: 'ready'; content: Content; images: Map<string, string>; contentKey: Uint8Array }

interface SyncOptions {
  relays: RelayLike
  cache: SyncCache
  admin: string
  phoneSecret: Uint8Array
  onChange: (state: SyncState) => void
  now?: () => number
}

const DEFAULT_PROFILE: Profile = { userName: '', adminName: 'tu familiar' }

const addressOf = (event: Event): string => `${event.kind}:${event.pubkey}:${dTag(event)}`

export class ContentSync {
  private readonly latest = new Map<string, Event>()
  // Último valor que se pudo descifrar de cada ítem: si llega una versión con una clave
  // que todavía no tenemos (rotación en curso), se sigue mostrando la anterior.
  private readonly lastReadable = new Map<string, unknown>()
  private stops: (() => void)[] = []
  private readonly phonePubkey: string
  private running = false
  private generation = 0
  private pairingDelivered = false
  private pairingInFlight = false

  constructor(private readonly opts: SyncOptions) {
    this.phonePubkey = getPublicKey(opts.phoneSecret)
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    const generation = ++this.generation
    const cached = await this.opts.cache.loadEvents().catch(() => [])
    // Si se paró (o se volvió a arrancar) mientras se leía lo guardado, no abrir nada.
    if (!this.running || generation !== this.generation) return
    for (const event of cached) this.keep(event)
    this.recompute()
    const { relays, admin } = this.opts
    this.stops = [
      relays.subscribe({ kinds: [KIND.deviceKey], authors: [admin], '#p': [this.phonePubkey] }, (e) => this.receive(e)),
      relays.subscribe({ kinds: [...ITEM_KINDS], authors: [admin] }, (e) => this.receive(e)),
    ]
  }

  stop(): void {
    this.running = false
    this.generation++
    for (const stop of this.stops.splice(0)) stop()
  }

  private receive(event: Event): void {
    if (!this.keep(event)) return
    void this.opts.cache.saveEvent(event).catch(() => undefined)
    this.recompute()
  }

  // Solo vale lo que firmó el admin, de los kinds esperados (no se confía en el filtro del relay).
  private accepts(event: Event): boolean {
    if (event.pubkey !== this.opts.admin) return false
    if (event.kind === KIND.deviceKey) return dTag(event) === this.phonePubkey
    return (ITEM_KINDS as readonly number[]).includes(event.kind)
  }

  // true si el evento es más nuevo que lo que había para su dirección.
  private keep(event: Event): boolean {
    if (!this.accepts(event)) return false
    const current = this.latest.get(addressOf(event))
    const isNewer =
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    if (isNewer) this.latest.set(addressOf(event), event)
    return isNewer
  }

  private contentKey(): Uint8Array | null {
    const keyEvent = this.latest.get(`${KIND.deviceKey}:${this.opts.admin}:${this.phonePubkey}`)
    if (!keyEvent) return null
    try {
      return openDeviceKey(this.opts.phoneSecret, keyEvent)
    } catch {
      return null
    }
  }

  private recompute(): void {
    const key = this.contentKey()
    if (!key) {
      this.lastReadable.clear()
      this.opts.onChange({ status: 'waiting', code: pairingCode(this.phonePubkey) })
      this.askForPairing()
      return
    }
    const { profile, envelopes, latestCreatedAt } = this.openItems(key)
    const { content, images } = buildContent(profile, envelopes, latestCreatedAt)
    this.opts.onChange({ status: 'ready', content, images, contentKey: key })
  }

  private readItem(key: Uint8Array, event: Event): unknown {
    const address = addressOf(event)
    try {
      const value = openItem(key, event.content)
      this.lastReadable.set(address, value)
      return value
    } catch {
      // Cifrado con una clave que no tenemos: lo último legible, o nada si nunca se pudo leer.
      return this.lastReadable.get(address)
    }
  }

  private openItems(key: Uint8Array) {
    let profile = DEFAULT_PROFILE
    const envelopes: ItemEnvelope[] = []
    let latestCreatedAt = 0
    for (const event of this.latest.values()) {
      if (!(ITEM_KINDS as readonly number[]).includes(event.kind)) continue
      const value = this.readItem(key, event)
      if (value === undefined) continue
      try {
        if (event.kind === KIND.profile) profile = parseProfile(value)
        else envelopes.push(parseEnvelope(event.kind, value))
        latestCreatedAt = Math.max(latestCreatedAt, event.created_at)
      } catch {
        // Mal formado: se ignora.
      }
    }
    return { profile, envelopes, latestCreatedAt }
  }

  // "Quiero acceso" (reemplazable, así no se acumulan pedidos). Se reintenta en cada
  // arranque hasta que llegue a suficientes relays.
  private askForPairing(): void {
    if (this.pairingDelivered || this.pairingInFlight) return
    this.pairingInFlight = true
    const now = this.opts.now?.() ?? Math.floor(Date.now() / 1000)
    const request = finalizeEvent(pairingRequestTemplate(this.opts.admin, now), this.opts.phoneSecret)
    void this.opts.relays
      .publish(request)
      .then((result) => {
        this.pairingDelivered = publishedEnough(result)
      })
      .catch(() => undefined)
      .finally(() => {
        this.pairingInFlight = false
      })
  }
}
