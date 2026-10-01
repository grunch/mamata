import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { describe, expect, it, vi } from 'vitest'
import { approveDevice, flagSuspicious, loadDevices, revokeDevice, type Device } from '../src/admin/devices.ts'
import { allEntries, loadAdmin, publishEntries } from '../src/admin/nostr-admin.ts'
import { decryptBytes, imageAad, type Bytes } from '../src/shared/crypto.ts'
import { KIND } from '../src/shared/nostr/constants.ts'
import { deriveImageKey, openItem } from '../src/shared/nostr/content-key.ts'
import { openDeviceKey, pairingRequestTemplate } from '../src/shared/nostr/keys.ts'
import { pairingCode } from '../src/shared/nostr/pairing.ts'
import { LocalSigner } from '../src/shared/nostr/signer.ts'
import { sampleContent } from './fixtures.ts'
import { memoryRelays } from './memory-relays.ts'

const NOW = 2_000_000_000

function phone() {
  const secret = generateSecretKey()
  return { secret, pubkey: getPublicKey(secret) }
}

async function adminWithContent() {
  const signer = new LocalSigner(generateSecretKey())
  const admin = await signer.getPublicKey()
  const relays = memoryRelays()
  const loaded = await loadAdmin(relays, signer, { userName: 'Marta', adminName: 'Fer' })
  const content = { ...sampleContent(), messages: sampleContent().messages.slice(0, 1) }
  const blobs = new Map<string, Bytes>()
  const upload = vi.fn(async (sealed: Bytes[]) =>
    sealed.map((bytes, i) => {
      const sha256 = `${blobs.size + i}`.padStart(64, 'f')
      blobs.set(sha256, bytes)
      return { sha256, size: bytes.length, servers: ['x'] }
    }),
  )
  const pending = new Map([['img2', new Uint8Array([4, 5, 6])]])
  const report = await publishEntries(allEntries(content, new Map()), pending, {
    relays,
    signer,
    contentKey: loaded.contentKey,
    isNew: true,
    now: () => NOW,
    upload,
  })
  const state = { ...loaded, content, images: report.images, versions: report.versions, isNew: false }
  return { signer, admin, relays, state, blobs }
}

describe('loadDevices', () => {
  it('lists pairing requests as pending and approved or revoked phones by their key event', async () => {
    const { signer, admin, relays, state } = await adminWithContent()
    const [a, b, c] = [phone(), phone(), phone()]
    for (const p of [a, b, c]) relays.stored.push(finalizeEvent(pairingRequestTemplate(admin, NOW), p.secret))
    await approveDevice(relays, signer, state.contentKey, b.pubkey, NOW)
    await approveDevice(relays, signer, state.contentKey, c.pubkey, NOW)
    await revokeDevice(
      { relays, signer, state, now: () => NOW + 10, upload: vi.fn(async () => []), download: vi.fn() },
      c.pubkey,
      [
        { pubkey: b.pubkey, keyAt: NOW },
        { pubkey: c.pubkey, keyAt: NOW },
      ],
    )

    const devices = await loadDevices(relays, admin)

    expect(devices.find((d) => d.pubkey === a.pubkey)).toMatchObject({ status: 'pending', code: pairingCode(a.pubkey) })
    expect(devices.find((d) => d.pubkey === b.pubkey)?.status).toBe('approved')
    expect(devices.find((d) => d.pubkey === c.pubkey)?.status).toBe('revoked')
    expect(devices[0]?.status).toBe('pending')
  })

  it('flags phones that share a code with another one (someone may be impersonating)', () => {
    const device = (pubkey: string, code: string): Device => ({ pubkey, code, status: 'pending', requestedAt: 1, suspicious: false, keyAt: 0 })

    const flagged = flagSuspicious([device('a', '123456'), device('b', '123456'), device('c', '654321')])

    expect(flagged.map((d) => [d.pubkey, d.suspicious])).toEqual([
      ['a', true],
      ['b', true],
      ['c', false],
    ])
  })

  it('remembers when each phone last got a key event', async () => {
    const { signer, admin, relays, state } = await adminWithContent()
    const p = phone()
    await approveDevice(relays, signer, state.contentKey, p.pubkey, NOW + 5)

    const [device] = await loadDevices(relays, admin)

    expect(device?.keyAt).toBe(NOW + 5)
  })

  it('asks the relays for a bounded number of pairing requests', async () => {
    const { admin, relays } = await adminWithContent()

    await loadDevices(relays, admin)

    expect(relays.query).toHaveBeenCalledWith(expect.objectContaining({ kinds: [KIND.pairingRequest], limit: 50 }))
  })
})

describe('approveDevice', () => {
  it('sends the content key only that phone can open', async () => {
    const { signer, relays, state } = await adminWithContent()
    const p = phone()

    const result = await approveDevice(relays, signer, state.contentKey, p.pubkey, NOW)

    expect(result.ok.length).toBeGreaterThanOrEqual(2)
    const event = relays.stored.find((e) => e.kind === KIND.deviceKey)!
    expect(Array.from(openDeviceKey(p.secret, event)!)).toEqual(Array.from(state.contentKey))
  })
})

describe('revokeDevice', () => {
  it('re-encrypts everything with a new key that only the remaining phones receive', async () => {
    const { signer, relays, state, blobs } = await adminWithContent()
    const [keep, remove] = [phone(), phone()]
    await approveDevice(relays, signer, state.contentKey, keep.pubkey, NOW)
    await approveDevice(relays, signer, state.contentKey, remove.pubkey, NOW)
    const download = vi.fn(async (sha256: string) => blobs.get(sha256)!)
    const upload = vi.fn(async (sealed: Bytes[]) =>
      sealed.map((bytes, i) => {
        const sha256 = `${i}`.padStart(64, 'e')
        blobs.set(sha256, bytes)
        return { sha256, size: bytes.length, servers: ['x'] }
      }),
    )

    const next = await revokeDevice({ relays, signer, state, now: () => NOW + 10, upload, download }, remove.pubkey, [
      { pubkey: keep.pubkey, keyAt: NOW },
      { pubkey: remove.pubkey, keyAt: NOW },
    ])

    const latestKey = (pubkey: string) =>
      relays.stored.filter((e) => e.kind === KIND.deviceKey && e.tags.some((t) => t[1] === pubkey)).at(-1)!
    expect(openDeviceKey(remove.secret, latestKey(remove.pubkey))).toBeNull()
    const keptKey = openDeviceKey(keep.secret, latestKey(keep.pubkey))!
    expect(Array.from(keptKey)).toEqual(Array.from(next.contentKey))
    expect(Array.from(keptKey)).not.toEqual(Array.from(state.contentKey))

    const message = relays.stored.filter((e) => e.kind === KIND.message).at(-1)!
    expect(openItem(next.contentKey, message.content)).toMatchObject({ item: { id: 'm1' } })

    const newSha = next.images.get('img2')!
    const image = await decryptBytes(await deriveImageKey(next.contentKey), blobs.get(newSha)!, imageAad('img2'))
    expect(Array.from(image)).toEqual([4, 5, 6])

    const reloaded = await loadAdmin(relays, signer, { userName: '', adminName: '' })
    expect(Array.from(reloaded.contentKey)).toEqual(Array.from(next.contentKey))
  })

  it('keeps going if an old image cannot be downloaded, and says which one was lost', async () => {
    const { signer, relays, state } = await adminWithContent()
    const download = vi.fn(async () => {
      throw new Error('no está')
    })

    const next = await revokeDevice(
      { relays, signer, state, now: () => NOW + 10, upload: vi.fn(async () => []), download },
      'x'.repeat(64),
      [],
    )

    expect(next.images.has('img2')).toBe(false)
    expect(next.lostImages).toEqual(['img2'])
  })

  it('does not hand out keys nor revoke anything if republishing fails', async () => {
    const { signer, state } = await adminWithContent()
    const relays = memoryRelays([], { okCount: 1 })
    const [keep, remove] = [phone(), phone()]

    await expect(
      revokeDevice({ relays, signer, state, now: () => NOW + 10, upload: vi.fn(async () => []), download: vi.fn() }, remove.pubkey, [
        { pubkey: keep.pubkey, keyAt: NOW },
        { pubkey: remove.pubkey, keyAt: NOW },
      ]),
    ).rejects.toThrow(/no se pudo/i)
    expect(relays.stored.filter((e) => e.kind === KIND.deviceKey)).toEqual([])
  })

  it('never lets a revocation tie with the approval it replaces', async () => {
    const { signer, relays, state } = await adminWithContent()
    const p = phone()
    await approveDevice(relays, signer, state.contentKey, p.pubkey, NOW)

    await revokeDevice({ relays, signer, state, now: () => NOW, upload: vi.fn(async () => []), download: vi.fn() }, p.pubkey, [
      { pubkey: p.pubkey, keyAt: NOW },
    ])

    const keys = relays.stored.filter((e) => e.kind === KIND.deviceKey)
    expect(keys.at(-1)!.created_at).toBeGreaterThan(keys[0]!.created_at)
    expect(openDeviceKey(p.secret, (await relays.query({ kinds: [KIND.deviceKey] }))[0]!)).toBeNull()
  })
})
