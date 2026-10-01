import { v2 as nip44 } from 'nostr-tools/nip44'
import { nsecEncode } from 'nostr-tools/nip19'
import { bytesToHex } from 'nostr-tools/utils'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { describe, expect, it } from 'vitest'
import { generateContentKey } from '../src/shared/nostr/content-key.ts'
import {
  adminKeyTemplate,
  deviceKeyTemplate,
  openAdminKey,
  openDeviceKey,
  pairingRequestTemplate,
  revokedDeviceKeyTemplate,
} from '../src/shared/nostr/keys.ts'
import { LocalSigner, Nip07Signer, SignerError, parseSecretKey, type WindowNostr } from '../src/shared/nostr/signer.ts'

describe('parseSecretKey', () => {
  it('accepts an nsec and a 64-char hex key', () => {
    const secret = generateSecretKey()

    expect(parseSecretKey(nsecEncode(secret))).toEqual(secret)
    expect(parseSecretKey(`  ${bytesToHex(secret)}\n`)).toEqual(secret)
  })

  it('rejects npubs and garbage', () => {
    expect(parseSecretKey('npub1abc')).toBeNull()
    expect(parseSecretKey('hola')).toBeNull()
  })
})

describe('LocalSigner', () => {
  it('signs valid events with its key', async () => {
    const secret = generateSecretKey()
    const signer = new LocalSigner(secret)

    const event = await signer.signEvent({ kind: 36000, created_at: 1, tags: [], content: 'x' })

    expect(await signer.getPublicKey()).toBe(getPublicKey(secret))
    expect(event.pubkey).toBe(getPublicKey(secret))
    expect(verifyEvent(event)).toBe(true)
  })

  it('encrypts with NIP-44 for another pubkey', async () => {
    const admin = generateSecretKey()
    const phone = generateSecretKey()

    const payload = await new LocalSigner(admin).nip44Encrypt(getPublicKey(phone), 'secreto')

    expect(await new LocalSigner(phone).nip44Decrypt(getPublicKey(admin), payload)).toBe('secreto')
  })
})

describe('Nip07Signer', () => {
  // Extensión falsa con la forma de window.nostr (nos2x y compañía).
  function fakeExtension(secret: Uint8Array, withNip44 = true): WindowNostr {
    const local = new LocalSigner(secret)
    return {
      getPublicKey: () => local.getPublicKey(),
      signEvent: (t) => local.signEvent(t),
      ...(withNip44
        ? { nip44: { encrypt: (pk, text) => local.nip44Encrypt(pk, text), decrypt: (pk, text) => local.nip44Decrypt(pk, text) } }
        : {}),
    }
  }

  it('delegates signing and encryption to the extension', async () => {
    const secret = generateSecretKey()
    const signer = Nip07Signer.from(fakeExtension(secret))

    const event = await signer.signEvent({ kind: 1, created_at: 1, tags: [], content: 'hola' })
    const payload = await signer.nip44Encrypt(getPublicKey(secret), 'a mí')

    expect(verifyEvent(event)).toBe(true)
    expect(await signer.nip44Decrypt(getPublicKey(secret), payload)).toBe('a mí')
  })

  it('explains when there is no extension or it lacks NIP-44', () => {
    expect(() => Nip07Signer.from(undefined)).toThrow(SignerError)
    expect(() => Nip07Signer.from(fakeExtension(generateSecretKey(), false))).toThrow(/NIP-44/)
  })
})

describe('content key distribution', () => {
  const adminSecret = generateSecretKey()
  const admin = new LocalSigner(adminSecret)
  const adminPubkey = getPublicKey(adminSecret)
  const phoneSecret = generateSecretKey()
  const phonePubkey = getPublicKey(phoneSecret)

  it('the phone asks to be paired with an event addressed to the admin', () => {
    const event = finalizeEvent(pairingRequestTemplate(adminPubkey, 100), phoneSecret)

    expect(event).toMatchObject({ kind: 36010, pubkey: phonePubkey, content: '' })
    expect(event.tags).toEqual([
      ['d', 'vincular'],
      ['p', adminPubkey],
    ])
  })

  it('only the approved phone can open its copy of the content key', async () => {
    const contentKey = generateContentKey()
    const event = await admin.signEvent(await deviceKeyTemplate(admin, phonePubkey, contentKey, 100))

    expect(event.kind).toBe(36011)
    expect(event.tags).toEqual([
      ['d', phonePubkey],
      ['p', phonePubkey],
    ])
    expect(openDeviceKey(phoneSecret, event)).toEqual(contentKey)
    expect(() => openDeviceKey(generateSecretKey(), event)).toThrow()
  })

  it('a revoked phone gets an empty key event', async () => {
    const event = await admin.signEvent(revokedDeviceKeyTemplate(phonePubkey, 200))

    expect(event.content).toBe('')
    expect(openDeviceKey(phoneSecret, event)).toBeNull()
  })

  it('rejects a key event that is not 32 bytes', () => {
    const conversation = nip44.utils.getConversationKey(adminSecret, phonePubkey)
    const event = finalizeEvent(
      { kind: 36011, created_at: 1, tags: [['d', phonePubkey], ['p', phonePubkey]], content: nip44.encrypt('abcd', conversation) },
      adminSecret,
    )

    expect(() => openDeviceKey(phoneSecret, event)).toThrow(/clave/)
  })

  it('the admin keeps a copy for itself to open the panel elsewhere', async () => {
    const contentKey = generateContentKey()
    const event = await admin.signEvent(await adminKeyTemplate(admin, contentKey, 100))

    expect(event).toMatchObject({ kind: 36012, tags: [['d', 'admin'], ['p', adminPubkey]] })
    expect(await openAdminKey(admin, event)).toEqual(contentKey)
  })
})
