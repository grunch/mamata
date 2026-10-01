import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { npubEncode } from 'nostr-tools/nip19'
import { describe, expect, it } from 'vitest'
import { BLOSSOM_SERVERS, ITEM_KINDS, KIND, RELAYS } from '../src/shared/nostr/constants.ts'
import {
  ItemCryptoError,
  MAX_ITEM_BYTES,
  deriveImageKey,
  generateContentKey,
  openItem,
  sealItem,
} from '../src/shared/nostr/content-key.ts'
import {
  buildContent,
  itemTemplate,
  latestByAddress,
  parseEnvelope,
  type ItemEnvelope,
} from '../src/shared/nostr/events.ts'
import { adminFromHash, linkFor, pairingCode } from '../src/shared/nostr/pairing.ts'
import { decryptBytes, encryptBytes, imageAad } from '../src/shared/crypto.ts'
import { sampleContent } from './fixtures.ts'

describe('constants', () => {
  it('uses the agreed kinds, relays and Blossom servers', () => {
    expect(KIND).toEqual({
      message: 36000,
      reminder: 36001,
      giftCard: 36002,
      profile: 36003,
      pairingRequest: 36010,
      deviceKey: 36011,
      adminKey: 36012,
    })
    expect(ITEM_KINDS).toEqual([36000, 36001, 36002, 36003])
    expect(RELAYS).toEqual(['wss://relay.mostro.network', 'wss://relay.shadowbip.com', 'wss://nos.lol'])
    expect(BLOSSOM_SERVERS).toEqual(['https://nostr.download', 'https://blossom.yakihonne.com'])
  })
})

describe('item encryption with the content key', () => {
  it('round-trips a JSON value with NIP-44 v2', () => {
    const key = generateContentKey()
    const value = { titulo: 'Hola mamá', n: 1 }

    const sealed = sealItem(key, value)

    expect(sealed).not.toContain('Hola')
    expect(openItem(key, sealed)).toEqual(value)
  })

  it('generates 32 random bytes', () => {
    const a = generateContentKey()

    expect(a).toHaveLength(32)
    expect(Array.from(a)).not.toEqual(Array.from(generateContentKey()))
  })

  it('fails with ItemCryptoError when the key is wrong', () => {
    const sealed = sealItem(generateContentKey(), { a: 1 })

    expect(() => openItem(generateContentKey(), sealed)).toThrow(ItemCryptoError)
  })

  it('fails with ItemCryptoError on garbage', () => {
    expect(() => openItem(generateContentKey(), 'no-es-nip44')).toThrow(ItemCryptoError)
  })

  it('refuses items too big for one event', () => {
    expect(() => sealItem(generateContentKey(), { texto: 'x'.repeat(MAX_ITEM_BYTES) })).toThrow(ItemCryptoError)
  })

  it('derives an AES key for images that only that content key can use', async () => {
    const key = generateContentKey()
    const imageKey = await deriveImageKey(key)
    const sealed = await encryptBytes(imageKey, new Uint8Array([1, 2, 3]), imageAad('foto'))

    expect(Array.from(await decryptBytes(await deriveImageKey(key), sealed, imageAad('foto')))).toEqual([1, 2, 3])
    await expect(decryptBytes(await deriveImageKey(generateContentKey()), sealed, imageAad('foto'))).rejects.toThrow()
  })
})

describe('pairing', () => {
  const adminHex = getPublicKey(generateSecretKey())

  it('builds the public link with the admin npub', () => {
    expect(linkFor(adminHex)).toBe(`https://mamata.live/#npub=${npubEncode(adminHex)}`)
  })

  it('reads the admin pubkey back from the link', () => {
    expect(adminFromHash(`#npub=${npubEncode(adminHex)}`)).toBe(adminHex)
  })

  it('ignores routes and invalid npubs', () => {
    expect(adminFromHash('#/mensajes')).toBeNull()
    expect(adminFromHash('#npub=npub1nada')).toBeNull()
    expect(adminFromHash('')).toBeNull()
  })

  it('derives a stable 6-digit code from a pubkey', () => {
    const code = pairingCode(adminHex)

    expect(code).toMatch(/^\d{6}$/)
    expect(pairingCode(adminHex)).toBe(code)
    expect(pairingCode(getPublicKey(generateSecretKey()))).toMatch(/^\d{6}$/)
  })
})

describe('events', () => {
  const secret = generateSecretKey()
  const sign = (kind: number, d: string, content: string, createdAt: number) =>
    finalizeEvent(itemTemplate(kind, d, content, createdAt), secret)

  it('builds an addressable event template with its d tag', () => {
    expect(itemTemplate(36000, 'm1', 'cifrado', 100)).toEqual({
      kind: 36000,
      created_at: 100,
      tags: [['d', 'm1']],
      content: 'cifrado',
    })
  })

  it('keeps only the newest version of each item', () => {
    const old = sign(36000, 'm1', 'viejo', 100)
    const recent = sign(36000, 'm1', 'nuevo', 200)
    const other = sign(36001, 'm1', 'otro', 50)

    const latest = latestByAddress([recent, old, other])

    expect(latest.map((e) => e.content).sort()).toEqual(['nuevo', 'otro'])
  })

  it('breaks created_at ties with the lowest id, as NIP-01 says', () => {
    const a = sign(36000, 'm1', 'a', 100)
    const b = sign(36000, 'm1', 'b', 100)
    const expected = a.id < b.id ? 'a' : 'b'

    expect(latestByAddress([a, b])[0]?.content).toBe(expected)
    expect(latestByAddress([b, a])[0]?.content).toBe(expected)
  })

  it('validates the item inside an envelope according to its kind', () => {
    const message = sampleContent().messages[0]!

    expect(parseEnvelope(36000, { v: 1, item: message })).toEqual({ kind: 36000, item: message })
    expect(() => parseEnvelope(36000, { v: 1, item: { id: 'x' } })).toThrow(/title/)
    expect(() => parseEnvelope(36000, { v: 2, item: message })).toThrow(/versión/)
    expect(() => parseEnvelope(36099, { v: 1, item: message })).toThrow(/kind/)
  })

  it('keeps the deletion date and the image reference', () => {
    const card = sampleContent().giftCards[0]!
    const sha256 = 'a'.repeat(64)

    const parsed = parseEnvelope(36002, {
      v: 1,
      item: card,
      deletedAt: '2026-10-01T10:00:00.000Z',
      image: { sha256 },
    })

    expect(parsed).toMatchObject({ deletedAt: '2026-10-01T10:00:00.000Z', image: { sha256 } })
    expect(() => parseEnvelope(36002, { v: 1, item: card, image: { sha256: 'corto' } })).toThrow(/sha256/)
  })

  it('assembles the Content the screens already use, with deleted items in the trash', () => {
    const doc = sampleContent()
    const envelopes: ItemEnvelope[] = [
      { kind: 36000, item: doc.messages[0]! },
      { kind: 36000, item: doc.messages[1]!, deletedAt: '2026-10-01T10:00:00.000Z' },
      { kind: 36001, item: doc.reminders[0]! },
      { kind: 36002, item: doc.giftCards[0]!, image: { sha256: 'b'.repeat(64) } },
    ]

    const { content, images } = buildContent({ userName: 'Marta', adminName: 'Fer' }, envelopes, 1_790_000_000)

    expect(content.userName).toBe('Marta')
    expect(content.messages.map((m) => m.id)).toEqual(['m1'])
    expect(content.reminders.map((r) => r.id)).toEqual(['r1'])
    expect(content.giftCards.map((c) => c.id)).toEqual(['g1'])
    expect(content.trash).toEqual([{ kind: 'message', item: doc.messages[1], deletedAt: '2026-10-01T10:00:00.000Z' }])
    expect(content.updatedAt).toBe(new Date(1_790_000_000 * 1000).toISOString())
    expect(images.get('img2')).toBe('b'.repeat(64))
  })
})
