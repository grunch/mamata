// Teléfonos: pedidos de vinculación (36010), aprobar (36011 con la clave) y quitar acceso
// (clave nueva para todo, que reciben solo los teléfonos que quedan).
import { decryptBytes, imageAad, type Bytes } from '../shared/crypto.ts'
import type { StoredBlob } from '../shared/nostr/blossom.ts'
import { KIND } from '../shared/nostr/constants.ts'
import { deriveImageKey, generateContentKey } from '../shared/nostr/content-key.ts'
import { dTag, latestByAddress } from '../shared/nostr/events.ts'
import { deviceKeyTemplate, revokedDeviceKeyTemplate } from '../shared/nostr/keys.ts'
import { pairingCode } from '../shared/nostr/pairing.ts'
import type { PublishResult } from '../shared/nostr/relays.ts'
import type { Signer } from '../shared/nostr/signer.ts'
import { allEntries, publishEntries, type AdminRelays, type AdminState, type PublishReport } from './nostr-admin.ts'

export type DeviceStatus = 'pending' | 'approved' | 'revoked'

export interface Device {
  pubkey: string
  code: string
  status: DeviceStatus
  requestedAt: number
}

const STATUS_ORDER: Record<DeviceStatus, number> = { pending: 0, approved: 1, revoked: 2 }

export async function loadDevices(relays: AdminRelays, admin: string): Promise<Device[]> {
  const requests = latestByAddress(await relays.query({ kinds: [KIND.pairingRequest], '#p': [admin] }))
  const keys = latestByAddress(await relays.query({ kinds: [KIND.deviceKey], authors: [admin] }))
  const devices = new Map<string, Device>()
  for (const request of requests) {
    devices.set(request.pubkey, {
      pubkey: request.pubkey,
      code: pairingCode(request.pubkey),
      status: 'pending',
      requestedAt: request.created_at,
    })
  }
  for (const key of keys) {
    const pubkey = dTag(key)
    devices.set(pubkey, {
      pubkey,
      code: pairingCode(pubkey),
      status: key.content ? 'approved' : 'revoked',
      requestedAt: devices.get(pubkey)?.requestedAt ?? key.created_at,
    })
  }
  return [...devices.values()].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.requestedAt - a.requestedAt,
  )
}

export async function approveDevice(
  relays: AdminRelays,
  signer: Signer,
  contentKey: Uint8Array,
  devicePubkey: string,
  now: number,
): Promise<PublishResult> {
  return relays.publish(await signer.signEvent(await deviceKeyTemplate(signer, devicePubkey, contentKey, now)))
}

export interface RevokeContext {
  relays: AdminRelays
  signer: Signer
  state: AdminState
  now: () => number
  upload: (blobs: Bytes[]) => Promise<StoredBlob[]>
  download: (sha256: string) => Promise<Bytes>
}

// Imágenes publicadas, descifradas con la clave vieja para volver a subirlas con la nueva.
async function reopenImages(ctx: RevokeContext): Promise<Map<string, Bytes>> {
  const oldKey = await deriveImageKey(ctx.state.contentKey)
  const plain = new Map<string, Bytes>()
  for (const [id, sha256] of ctx.state.images) {
    try {
      plain.set(id, await decryptBytes(oldKey, await ctx.download(sha256), imageAad(id)))
    } catch {
      // Si una imagen ya no se puede bajar, el resto sigue igual.
    }
  }
  return plain
}

// Orden: todo el contenido con la clave nueva (incluida la copia del admin), después la
// clave nueva a los teléfonos que quedan y por último el aviso de "sin acceso".
export async function revokeDevice(
  ctx: RevokeContext,
  devicePubkey: string,
  approvedPubkeys: string[],
): Promise<AdminState & { failed: PublishReport['failed'] }> {
  const contentKey = generateContentKey()
  const report = await publishEntries(allEntries(ctx.state.content, new Map()), await reopenImages(ctx), {
    relays: ctx.relays,
    signer: ctx.signer,
    contentKey,
    isNew: true,
    versions: ctx.state.versions,
    now: ctx.now,
    upload: ctx.upload,
  })
  for (const pubkey of approvedPubkeys.filter((p) => p !== devicePubkey)) {
    await approveDevice(ctx.relays, ctx.signer, contentKey, pubkey, ctx.now())
  }
  await ctx.relays.publish(await ctx.signer.signEvent(revokedDeviceKeyTemplate(devicePubkey, ctx.now())))
  return {
    ...ctx.state,
    contentKey,
    images: report.images,
    versions: new Map([...ctx.state.versions, ...report.versions]),
    isNew: false,
    failed: report.failed,
  }
}
