import type { Event, Filter } from 'nostr-tools'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { describe, expect, it, vi } from 'vitest'
import { ContentSync, type SyncCache, type SyncState } from '../src/app/content-sync.ts'
import { KIND } from '../src/shared/nostr/constants.ts'
import { generateContentKey, sealItem } from '../src/shared/nostr/content-key.ts'
import { envelopeFor, itemTemplate } from '../src/shared/nostr/events.ts'
import { deviceKeyTemplate, revokedDeviceKeyTemplate } from '../src/shared/nostr/keys.ts'
import { pairingCode } from '../src/shared/nostr/pairing.ts'
import { LocalSigner } from '../src/shared/nostr/signer.ts'
import { sampleContent } from './fixtures.ts'

const adminSecret = generateSecretKey()
const admin = new LocalSigner(adminSecret)
const adminPubkey = getPublicKey(adminSecret)

// Relays falsos: se pueden "empujar" eventos a las suscripciones abiertas.
function fakeRelays() {
  const subs: { filter: Filter; onEvent: (e: Event) => void; closed: boolean }[] = []
  const published: Event[] = []
  return {
    subs,
    published,
    subscribe: vi.fn((filter: Filter, onEvent: (e: Event) => void) => {
      const sub = { filter, onEvent, closed: false }
      subs.push(sub)
      return () => {
        sub.closed = true
      }
    }),
    publish: vi.fn(async (event: Event) => {
      published.push(event)
      return { ok: ['wss://a', 'wss://b'], failed: [] }
    }),
    push(event: Event) {
      for (const sub of subs) {
        if (!sub.closed && sub.filter.kinds?.includes(event.kind)) sub.onEvent(event)
      }
    },
  }
}

function memoryCache(initial: Event[] = []): SyncCache & { events: Event[] } {
  const cache = {
    events: [...initial],
    loadEvents: async () => [...cache.events],
    saveEvent: async (event: Event) => {
      cache.events.push(event)
    },
  }
  return cache
}

async function itemEvent(contentKey: Uint8Array, kind: number, d: string, value: unknown, createdAt: number) {
  return admin.signEvent(itemTemplate(kind, d, sealItem(contentKey, value), createdAt))
}

async function setup(cacheEvents: Event[] = []) {
  const phoneSecret = generateSecretKey()
  const relays = fakeRelays()
  const cache = memoryCache(cacheEvents)
  const states: SyncState[] = []
  const sync = new ContentSync({
    relays,
    cache,
    admin: adminPubkey,
    phoneSecret,
    onChange: (state) => states.push(state),
    now: () => 1_000,
  })
  return { sync, relays, cache, states, phoneSecret, phonePubkey: getPublicKey(phoneSecret), last: () => states.at(-1) }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('ContentSync', () => {
  it('waits for approval showing the pairing code and asks the admin once', async () => {
    const { sync, relays, last, phonePubkey } = await setup()

    await sync.start()

    expect(last()).toEqual({ status: 'waiting', code: pairingCode(phonePubkey) })
    expect(relays.published).toHaveLength(1)
    expect(relays.published[0]).toMatchObject({ kind: KIND.pairingRequest, pubkey: phonePubkey })
    expect(relays.published[0]?.tags).toContainEqual(['p', adminPubkey])
  })

  it('subscribes only to events signed by the admin', async () => {
    const { sync, relays, phonePubkey } = await setup()

    await sync.start()

    expect(relays.subs.map((s) => s.filter)).toEqual([
      { kinds: [KIND.deviceKey], authors: [adminPubkey], '#p': [phonePubkey] },
      { kinds: [36000, 36001, 36002, 36003], authors: [adminPubkey] },
    ])
  })

  it('shows the content once the admin approves the phone, whatever arrives first', async () => {
    const { sync, relays, last, phonePubkey } = await setup()
    const key = generateContentKey()
    const doc = sampleContent()
    await sync.start()

    relays.push(await itemEvent(key, KIND.message, 'm1', envelopeFor({ kind: KIND.message, item: doc.messages[0]! }), 10))
    relays.push(await itemEvent(key, KIND.profile, 'perfil', { userName: 'Marta', adminName: 'Fer' }, 10))
    relays.push(await admin.signEvent(await deviceKeyTemplate(admin, phonePubkey, key, 20)))
    await flush()

    const state = last()
    expect(state?.status).toBe('ready')
    if (state?.status !== 'ready') return
    expect(state.content.userName).toBe('Marta')
    expect(state.content.messages.map((m) => m.title)).toEqual([doc.messages[0]!.title])
  })

  it('keeps the newest version of an item and never goes back to an older one', async () => {
    const { sync, relays, last, phonePubkey } = await setup()
    const key = generateContentKey()
    const message = sampleContent().messages[0]!
    await sync.start()
    relays.push(await admin.signEvent(await deviceKeyTemplate(admin, phonePubkey, key, 1)))

    relays.push(await itemEvent(key, KIND.message, 'm1', envelopeFor({ kind: KIND.message, item: { ...message, title: 'Nuevo' } }), 20))
    relays.push(await itemEvent(key, KIND.message, 'm1', envelopeFor({ kind: KIND.message, item: { ...message, title: 'Viejo' } }), 10))
    await flush()

    const state = last()
    expect(state?.status === 'ready' && state.content.messages.map((m) => m.title)).toEqual(['Nuevo'])
  })

  it('goes back to waiting when the admin removes access', async () => {
    const { sync, relays, last, phonePubkey } = await setup()
    const key = generateContentKey()
    await sync.start()
    relays.push(await admin.signEvent(await deviceKeyTemplate(admin, phonePubkey, key, 1)))
    await flush()

    relays.push(await admin.signEvent(revokedDeviceKeyTemplate(phonePubkey, 2)))
    await flush()

    expect(last()).toEqual({ status: 'waiting', code: pairingCode(phonePubkey) })
  })

  it('ignores events that were not signed by the admin', async () => {
    const { sync, relays, last, phonePubkey } = await setup()
    const intruder = new LocalSigner(generateSecretKey())
    const key = generateContentKey()
    await sync.start()

    relays.push(await intruder.signEvent(await deviceKeyTemplate(intruder, phonePubkey, key, 5)))
    await flush()

    expect(last()?.status).toBe('waiting')
  })

  it('skips items it cannot decrypt (for example, from an older content key)', async () => {
    const { sync, relays, last, phonePubkey } = await setup()
    const key = generateContentKey()
    const message = sampleContent().messages[0]!
    await sync.start()
    relays.push(await admin.signEvent(await deviceKeyTemplate(admin, phonePubkey, key, 1)))

    relays.push(await itemEvent(generateContentKey(), KIND.message, 'viejo', envelopeFor({ kind: KIND.message, item: message }), 5))
    relays.push(await itemEvent(key, KIND.message, 'm1', envelopeFor({ kind: KIND.message, item: message }), 5))
    await flush()

    const state = last()
    expect(state?.status === 'ready' && state.content.messages).toHaveLength(1)
  })

  it('saves what it receives and shows it again without internet', async () => {
    const first = await setup()
    const key = generateContentKey()
    const message = sampleContent().messages[0]!
    await first.sync.start()
    first.relays.push(await admin.signEvent(await deviceKeyTemplate(admin, first.phonePubkey, key, 1)))
    first.relays.push(await itemEvent(key, KIND.message, 'm1', envelopeFor({ kind: KIND.message, item: message }), 5))
    await flush()

    // Otra apertura de la app, con lo guardado y sin relays que respondan.
    const states: SyncState[] = []
    const offline = new ContentSync({
      relays: fakeRelays(),
      cache: memoryCache(first.cache.events),
      admin: adminPubkey,
      phoneSecret: first.phoneSecret,
      onChange: (s) => states.push(s),
    })
    await offline.start()

    const state = states.at(-1)
    expect(state?.status === 'ready' && state.content.messages.map((m) => m.id)).toEqual(['m1'])
  })

  it('closes its subscriptions when stopped', async () => {
    const { sync, relays } = await setup()
    await sync.start()

    sync.stop()

    expect(relays.subs.every((s) => s.closed)).toBe(true)
  })
})
