import { generateSecretKey } from 'nostr-tools/pure'
import { describe, expect, it, vi } from 'vitest'
import {
  changedEntries,
  findConflicts,
  loadAdmin,
  publishEntries,
  type AdminState,
  type Entry,
} from '../src/admin/nostr-admin.ts'
import { moveToTrash } from '../src/admin/draft.ts'
import { decryptBytes, imageAad } from '../src/shared/crypto.ts'
import { KIND } from '../src/shared/nostr/constants.ts'
import { deriveImageKey, generateContentKey, openItem, sealItem } from '../src/shared/nostr/content-key.ts'
import { envelopeFor, itemTemplate } from '../src/shared/nostr/events.ts'
import { adminKeyTemplate } from '../src/shared/nostr/keys.ts'
import { LocalSigner } from '../src/shared/nostr/signer.ts'
import { sampleContent } from './fixtures.ts'
import { memoryRelays } from './memory-relays.ts'

const NOW = 2_000_000_000

async function publishedState() {
  const signer = new LocalSigner(generateSecretKey())
  const relays = memoryRelays()
  const state = await loadAdmin(relays, signer, { userName: 'Marta', adminName: 'Fer' })
  return { signer, relays, state }
}

const ctxFor = (relays: ReturnType<typeof memoryRelays>, signer: LocalSigner, state: AdminState) => ({
  relays,
  signer,
  contentKey: state.contentKey,
  isNew: state.isNew,
  now: () => NOW,
  upload: vi.fn(async (blobs: Uint8Array[]) => blobs.map((_, i) => ({ sha256: String(i).repeat(64), size: 1, servers: ['x'] }))),
})

describe('loadAdmin', () => {
  it('starts fresh with a new content key when nothing was published', async () => {
    const { state } = await publishedState()

    expect(state.isNew).toBe(true)
    expect(state.contentKey).toHaveLength(32)
    expect(state.content).toMatchObject({ userName: 'Marta', adminName: 'Fer', messages: [] })
  })

  it('recovers the content key and every item published before', async () => {
    const signer = new LocalSigner(generateSecretKey())
    const key = generateContentKey()
    const message = sampleContent().messages[0]!
    const events = [
      await signer.signEvent(await adminKeyTemplate(signer, key, 1)),
      await signer.signEvent(itemTemplate(KIND.profile, 'perfil', sealItem(key, { userName: 'Marta', adminName: 'Fer' }), 1)),
      await signer.signEvent(itemTemplate(KIND.message, 'm1', sealItem(key, envelopeFor({ kind: KIND.message, item: message })), 5)),
    ]

    const state = await loadAdmin(memoryRelays(events), signer, { userName: '', adminName: '' })

    expect(state.isNew).toBe(false)
    expect(Array.from(state.contentKey)).toEqual(Array.from(key))
    expect(state.content.messages).toEqual([message])
    expect(state.versions.get(`${KIND.message}:m1`)).toBe(5)
  })
})

describe('changedEntries', () => {
  it('finds exactly the items that changed, including the profile and moves to the trash', () => {
    const before = sampleContent()
    const edited = { ...before.messages[0]!, title: 'Otro título' }
    const after = moveToTrash(
      { ...before, userName: 'Mamá', messages: [edited, before.messages[1]!] },
      'reminder',
      'r1',
      '2026-10-01T10:00:00.000Z',
    )

    const entries = changedEntries(before, after, new Map())

    expect(entries.map((e) => `${e.kind}:${e.d}`).sort()).toEqual(['36000:m1', '36001:r1', '36003:perfil'])
    expect(entries.find((e) => e.d === 'r1')?.value).toMatchObject({ deletedAt: '2026-10-01T10:00:00.000Z' })
  })

  it('always includes the names on the first publication, even if they did not change', () => {
    const doc = sampleContent()
    const edited = { ...doc, messages: [{ ...doc.messages[0]!, title: 'Nuevo' }, doc.messages[1]!] }

    const first = changedEntries(doc, edited, new Map(), { isNew: true })
    const later = changedEntries(doc, edited, new Map(), { isNew: false })

    expect(first.map((e) => e.d).sort()).toEqual(['m1', 'perfil'])
    expect(later.map((e) => e.d)).toEqual(['m1'])
  })

  it('returns nothing when nothing changed', () => {
    expect(changedEntries(sampleContent(), sampleContent(), new Map())).toEqual([])
  })
})

describe('publishEntries', () => {
  it('encrypts each entry with the content key and publishes it signed by the admin', async () => {
    const { signer, relays, state } = await publishedState()
    const message = sampleContent().messages[0]!
    const entries: Entry[] = [{ kind: KIND.message, d: 'm1', value: envelopeFor({ kind: KIND.message, item: message }) }]

    const report = await publishEntries(entries, new Map(), ctxFor(relays, signer, state))

    expect(report.failed).toEqual([])
    const event = relays.stored.find((e) => e.kind === KIND.message)!
    expect(event.pubkey).toBe(await signer.getPublicKey())
    expect(event.content).not.toContain(message.title)
    expect(openItem(state.contentKey, event.content)).toMatchObject({ item: { title: message.title } })
    expect(report.versions.get(`${KIND.message}:m1`)).toBe(NOW)
  })

  it('uploads pending images encrypted and records their hash in the item', async () => {
    const { signer, relays, state } = await publishedState()
    const card = sampleContent().giftCards[0]!
    const ctx = ctxFor(relays, signer, state)
    const pending = new Map([[card.imageId!, new Uint8Array([1, 2, 3])]])

    const report = await publishEntries(
      [{ kind: KIND.giftCard, d: card.id, value: envelopeFor({ kind: KIND.giftCard, item: card }) }],
      pending,
      ctx,
    )

    const uploaded = ctx.upload.mock.calls[0]?.[0]?.[0] as Uint8Array
    const imageKey = await deriveImageKey(state.contentKey)
    expect(Array.from(await decryptBytes(imageKey, new Uint8Array(uploaded), imageAad(card.imageId!)))).toEqual([1, 2, 3])
    expect(report.images.get(card.imageId!)).toBe('0'.repeat(64))
    const event = relays.stored.find((e) => e.kind === KIND.giftCard)!
    expect(openItem(state.contentKey, event.content)).toMatchObject({ image: { sha256: '0'.repeat(64) } })
  })

  it('reports entries that reached fewer than 2 relays', async () => {
    const signer = new LocalSigner(generateSecretKey())
    const relays = memoryRelays([], { okCount: 1 })
    const state = await loadAdmin(relays, signer, { userName: 'Marta', adminName: 'Fer' })
    const entries: Entry[] = [{ kind: KIND.profile, d: 'perfil', value: { userName: 'Marta', adminName: 'Fer' } }]

    const report = await publishEntries(entries, new Map(), ctxFor(relays, signer, state))

    expect(report.failed.map((f) => f.d)).toEqual(['admin', 'perfil'])
  })

  it('on the first publication stores a copy of the content key so another browser can open the panel', async () => {
    const { signer, relays, state } = await publishedState()

    await publishEntries(
      [{ kind: KIND.profile, d: 'perfil', value: { userName: 'Marta', adminName: 'Fer' } }],
      new Map(),
      ctxFor(relays, signer, state),
    )

    const reloaded = await loadAdmin(relays, signer, { userName: '', adminName: '' })
    expect(reloaded.isNew).toBe(false)
    expect(Array.from(reloaded.contentKey)).toEqual(Array.from(state.contentKey))
    expect(reloaded.content.userName).toBe('Marta')
  })

  it('refuses to overwrite a content key that appeared on the relays meanwhile', async () => {
    const { signer, relays, state } = await publishedState()
    // Otro navegador del admin publicó primero (o un relay no respondió al cargar).
    relays.stored.push(await signer.signEvent(await adminKeyTemplate(signer, generateContentKey(), NOW - 5)))

    await expect(
      publishEntries([{ kind: KIND.profile, d: 'perfil', value: { userName: 'Marta', adminName: 'Fer' } }], new Map(), ctxFor(relays, signer, state)),
    ).rejects.toThrow(/ya hay contenido publicado/i)
    expect(relays.stored.filter((e) => e.kind === KIND.adminKey)).toHaveLength(1)
  })
})

describe('findConflicts', () => {
  it('detects items that someone published after we loaded them', async () => {
    const { signer, relays, state } = await publishedState()
    const key = state.contentKey
    relays.stored.push(
      await signer.signEvent(itemTemplate(KIND.message, 'm1', sealItem(key, { v: 1 }), 50)),
      await signer.signEvent(itemTemplate(KIND.message, 'm2', sealItem(key, { v: 1 }), 10)),
    )
    const versions = new Map([
      [`${KIND.message}:m1`, 40],
      [`${KIND.message}:m2`, 10],
    ])
    const entries: Entry[] = [
      { kind: KIND.message, d: 'm1', value: {} },
      { kind: KIND.message, d: 'm2', value: {} },
    ]

    const conflicts = await findConflicts(relays, await signer.getPublicKey(), entries, versions)

    expect(conflicts.map((e) => e.d)).toEqual(['m1'])
  })
})
