// Conexión con los relays. Envuelve SimplePool (que ya verifica las firmas) detrás de
// una interfaz chica, así la app y el panel se pueden probar con un pool falso.
import type { Event, Filter } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import { MIN_RELAYS_OK, RELAYS } from './constants.ts'

const QUERY_MAX_WAIT_MS = 4000

export interface PoolLike {
  querySync(relays: string[], filter: Filter, params?: { maxWait?: number }): Promise<Event[]>
  subscribeMany(
    relays: string[],
    filter: Filter,
    params: { onevent?: (event: Event) => void; oneose?: () => void },
  ): { close(): void }
  publish(relays: string[], event: Event): Promise<string>[]
  destroy(): void
}

export interface PublishResult {
  ok: string[]
  failed: { relay: string; reason: string }[]
}

export function publishedEnough(result: PublishResult): boolean {
  return result.ok.length >= MIN_RELAYS_OK
}

export class Relays {
  constructor(
    private readonly pool: PoolLike = new SimplePool(),
    private readonly urls: string[] = RELAYS,
  ) {}

  query(filter: Filter): Promise<Event[]> {
    return this.pool.querySync(this.urls, filter, { maxWait: QUERY_MAX_WAIT_MS })
  }

  // onReady: cuando los relays terminaron de mandar lo guardado (EOSE).
  subscribe(filter: Filter, onEvent: (event: Event) => void, onReady?: () => void): () => void {
    const sub = this.pool.subscribeMany(this.urls, filter, {
      onevent: onEvent,
      ...(onReady ? { oneose: onReady } : {}),
    })
    return () => sub.close()
  }

  async publish(event: Event): Promise<PublishResult> {
    const settled = await Promise.allSettled(this.pool.publish(this.urls, event))
    const result: PublishResult = { ok: [], failed: [] }
    settled.forEach((outcome, i) => {
      const relay = this.urls[i] ?? '?'
      if (outcome.status === 'fulfilled') result.ok.push(relay)
      else result.failed.push({ relay, reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) })
    })
    return result
  }

  close(): void {
    this.pool.destroy()
  }
}
