// Relay Nostr simulado para los tests e2e: intercepta los websockets de la página y
// responde como un relay de verdad (REQ / EVENT / CLOSE, reemplazables por dirección).
import type { Page, WebSocketRoute } from '@playwright/test'
import type { Event, Filter } from 'nostr-tools'

const tagValue = (event: Event, name: string) => event.tags.find((t) => t[0] === name)?.[1] ?? ''
const isAddressable = (kind: number) => kind >= 30000 && kind < 40000
const address = (e: Event) => `${e.kind}:${e.pubkey}:${tagValue(e, 'd')}`

function matches(event: Event, filter: Filter): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith('#') || !Array.isArray(values)) continue
    const name = key.slice(1)
    if (!event.tags.some((t) => t[0] === name && (values as string[]).includes(t[1] as string))) return false
  }
  return true
}

export class FakeRelay {
  readonly events: Event[] = []
  private readonly subs = new Map<string, { ws: WebSocketRoute; id: string; filters: Filter[] }>()

  static async attach(page: Page): Promise<FakeRelay> {
    const relay = new FakeRelay()
    await page.routeWebSocket(/^wss:\/\//, (ws) => relay.connect(ws))
    return relay
  }

  // Lo que publica "otro" (por ejemplo, el admin desde el test) llega a las suscripciones abiertas.
  publish(event: Event): void {
    if (isAddressable(event.kind)) {
      const i = this.events.findIndex((e) => address(e) === address(event))
      if (i >= 0) {
        if ((this.events[i] as Event).created_at > event.created_at) return
        this.events.splice(i, 1)
      }
    }
    this.events.push(event)
    for (const sub of this.subs.values()) {
      if (sub.filters.some((f) => matches(event, f))) sub.ws.send(JSON.stringify(['EVENT', sub.id, event]))
    }
  }

  find(filter: Filter): Event[] {
    return this.events.filter((e) => matches(e, filter))
  }

  private connect(ws: WebSocketRoute): void {
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as [string, ...unknown[]]
      const [type, ...rest] = message
      if (type === 'EVENT') {
        const event = rest[0] as Event
        this.publish(event)
        ws.send(JSON.stringify(['OK', event.id, true, '']))
      } else if (type === 'REQ') {
        const [id, ...filters] = rest as [string, ...Filter[]]
        const key = `${ws.url()}|${id}`
        this.subs.set(key, { ws, id, filters })
        for (const event of this.events.filter((e) => filters.some((f) => matches(e, f)))) {
          ws.send(JSON.stringify(['EVENT', id, event]))
        }
        ws.send(JSON.stringify(['EOSE', id]))
      } else if (type === 'CLOSE') {
        this.subs.delete(`${ws.url()}|${rest[0] as string}`)
      }
    })
  }
}
