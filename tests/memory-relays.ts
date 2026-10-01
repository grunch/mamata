import type { Event, Filter } from 'nostr-tools'
import { vi } from 'vitest'
import { dTag, latestByAddress } from '../src/shared/nostr/events.ts'

// Relays en memoria que se comportan como uno de verdad: guardan, filtran y reemplazan.
export function memoryRelays(initial: Event[] = [], { okCount = 3 } = {}) {
  const stored: Event[] = [...initial]
  const matches = (e: Event, f: Filter) =>
    (!f.kinds || f.kinds.includes(e.kind)) &&
    (!f.authors || f.authors.includes(e.pubkey)) &&
    (!f['#d'] || f['#d'].includes(dTag(e))) &&
    (!f['#p'] || e.tags.some((t) => t[0] === 'p' && f['#p']!.includes(t[1]!)))
  return {
    stored,
    query: vi.fn(async (f: Filter) => latestByAddress(stored.filter((e) => matches(e, f)))),
    subscribe: vi.fn(() => () => undefined),
    publish: vi.fn(async (e: Event) => {
      stored.push(e)
      const relays = ['wss://a', 'wss://b', 'wss://c']
      return { ok: relays.slice(0, okCount), failed: relays.slice(okCount).map((relay) => ({ relay, reason: 'no' })) }
    }),
  }
}
