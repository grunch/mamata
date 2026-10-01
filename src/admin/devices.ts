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
import { publishedEnough } from '../shared/nostr/relays.ts'
import { allEntries, publishEntries, type AdminRelays, type AdminState } from './nostr-admin.ts'

export type DeviceStatus = 'pending' | 'approved' | 'revoked'

export interface Device {
  pubkey: string
  code: string
  status: DeviceStatus
  requestedAt: number
  // Otro teléfono tiene el mismo código: puede ser alguien haciéndose pasar por él.
  suspicious: boolean
  // created_at del último evento de clave (36011) de este teléfono, 0 si no hay.
  keyAt: number
}

// Lo que hace falta de cada teléfono habilitado para quitarle o reenviarle la clave.
export interface KeyHolder {
  pubkey: string
  keyAt: number
}

// Los eventos de clave siempre avanzan: así no empatan con el anterior.
const nextKeyTime = (now: number, keyAt: number): number => Math.max(now, keyAt + 1)

// Cuántos pedidos de vinculación se piden a los relays (cualquiera puede publicar pedidos).
const MAX_PAIRING_REQUESTS = 50

export function flagSuspicious(devices: Device[]): Device[] {
  const counts = new Map<string, number>()
  for (const d of devices) counts.set(d.code, (counts.get(d.code) ?? 0) + 1)
  return devices.map((d) => ({ ...d, suspicious: (counts.get(d.code) ?? 0) > 1 }))
}

const STATUS_ORDER: Record<DeviceStatus, number> = { pending: 0, approved: 1, revoked: 2 }

export async function loadDevices(relays: AdminRelays, admin: string): Promise<Device[]> {
  const requests = latestByAddress(
    await relays.query({ kinds: [KIND.pairingRequest], '#p': [admin], limit: MAX_PAIRING_REQUESTS }),
  )
  const keys = latestByAddress(await relays.query({ kinds: [KIND.deviceKey], authors: [admin] }))
  const devices = new Map<string, Device>()
  for (const request of requests) {
    devices.set(request.pubkey, {
      pubkey: request.pubkey,
      code: pairingCode(request.pubkey),
      status: 'pending',
      requestedAt: request.created_at,
      suspicious: false,
      keyAt: 0,
    })
  }
  for (const key of keys) {
    const pubkey = dTag(key)
    devices.set(pubkey, {
      pubkey,
      code: pairingCode(pubkey),
      status: key.content ? 'approved' : 'revoked',
      requestedAt: devices.get(pubkey)?.requestedAt ?? key.created_at,
      suspicious: false,
      keyAt: key.created_at,
    })
  }
  return flagSuspicious([...devices.values()]).sort(
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
async function reopenImages(ctx: RevokeContext): Promise<{ plain: Map<string, Bytes>; lost: string[] }> {
  const oldKey = await deriveImageKey(ctx.state.contentKey)
  const plain = new Map<string, Bytes>()
  const lost: string[] = []
  for (const [id, sha256] of ctx.state.images) {
    try {
      plain.set(id, await decryptBytes(oldKey, await ctx.download(sha256), imageAad(id)))
    } catch {
      lost.push(id)
    }
  }
  return { plain, lost }
}

export interface Revoked extends AdminState {
  // Fotos que ya no se pudieron bajar de Blossom para volver a cifrarlas.
  lostImages: string[]
  // Teléfonos habilitados a los que no les llegó la clave nueva (hay que reintentar).
  keyFailures: string[]
}

export class RevokeError extends Error {
  constructor() {
    super('No se pudo volver a publicar todo, así que no se quitó el acceso. Probá de nuevo.')
    this.name = 'RevokeError'
  }
}

// Orden: todo el contenido con la clave nueva (incluida la copia del admin); si eso no
// llegó a los relays, se corta acá sin tocar ninguna clave. Después la clave nueva a los
// teléfonos que quedan y por último el aviso de "sin acceso".
export async function revokeDevice(ctx: RevokeContext, devicePubkey: string, holders: KeyHolder[]): Promise<Revoked> {
  const contentKey = generateContentKey()
  const { plain, lost } = await reopenImages(ctx)
  const report = await publishEntries(allEntries(ctx.state.content, new Map()), plain, {
    relays: ctx.relays,
    signer: ctx.signer,
    contentKey,
    isNew: false,
    versions: ctx.state.versions,
    now: ctx.now,
    upload: ctx.upload,
  })
  if (report.failed.length > 0) throw new RevokeError()
  const keyReport = await publishEntries([], new Map(), {
    relays: ctx.relays,
    signer: ctx.signer,
    contentKey,
    isNew: true,
    versions: new Map([...ctx.state.versions, ...report.versions]),
    now: ctx.now,
    upload: ctx.upload,
  })
  if (keyReport.failed.length > 0) throw new RevokeError()

  const keyFailures: string[] = []
  for (const holder of holders.filter((h) => h.pubkey !== devicePubkey)) {
    const result = await approveDevice(ctx.relays, ctx.signer, contentKey, holder.pubkey, nextKeyTime(ctx.now(), holder.keyAt))
    if (!publishedEnough(result)) keyFailures.push(holder.pubkey)
  }
  const revokedAt = nextKeyTime(ctx.now(), holders.find((h) => h.pubkey === devicePubkey)?.keyAt ?? 0)
  await ctx.relays.publish(await ctx.signer.signEvent(revokedDeviceKeyTemplate(devicePubkey, revokedAt)))

  return {
    ...ctx.state,
    contentKey,
    images: report.images,
    versions: new Map([...ctx.state.versions, ...report.versions, ...keyReport.versions]),
    isNew: false,
    lostImages: lost,
    keyFailures,
  }
}
