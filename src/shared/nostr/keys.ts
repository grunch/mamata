// Vinculación y reparto de la clave de contenido:
//   36010 teléfono → admin: "quiero acceso" (sin contenido: la pubkey es el autor).
//   36011 admin → teléfono: la clave de contenido cifrada con NIP-44 (vacía = sin acceso).
//   36012 admin → admin: copia de la clave, para abrir el panel en otro navegador.
import type { Event, EventTemplate } from 'nostr-tools/core'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { bytesToHex, hexToBytes } from 'nostr-tools/utils'
import { KIND } from './constants.ts'
import type { Signer } from './signer.ts'

const KEY_HEX = /^[0-9a-f]{64}$/

export function pairingRequestTemplate(adminPubkey: string, createdAt: number): EventTemplate {
  return {
    kind: KIND.pairingRequest,
    created_at: createdAt,
    tags: [
      ['d', 'vincular'],
      ['p', adminPubkey],
    ],
    content: '',
  }
}

export async function deviceKeyTemplate(
  admin: Signer,
  devicePubkey: string,
  contentKey: Uint8Array,
  createdAt: number,
): Promise<EventTemplate> {
  return {
    kind: KIND.deviceKey,
    created_at: createdAt,
    tags: [
      ['d', devicePubkey],
      ['p', devicePubkey],
    ],
    content: await admin.nip44Encrypt(devicePubkey, bytesToHex(contentKey)),
  }
}

// Quitar acceso: misma dirección, sin clave.
export function revokedDeviceKeyTemplate(devicePubkey: string, createdAt: number): EventTemplate {
  return {
    kind: KIND.deviceKey,
    created_at: createdAt,
    tags: [
      ['d', devicePubkey],
      ['p', devicePubkey],
    ],
    content: '',
  }
}

export async function adminKeyTemplate(admin: Signer, contentKey: Uint8Array, createdAt: number): Promise<EventTemplate> {
  const adminPubkey = await admin.getPublicKey()
  return {
    kind: KIND.adminKey,
    created_at: createdAt,
    tags: [
      ['d', 'admin'],
      ['p', adminPubkey],
    ],
    content: await admin.nip44Encrypt(adminPubkey, bytesToHex(contentKey)),
  }
}

function toContentKey(hex: string): Uint8Array {
  if (!KEY_HEX.test(hex)) throw new Error('La clave de contenido recibida no es válida')
  return hexToBytes(hex)
}

// En el teléfono. null = el admin le quitó el acceso.
export function openDeviceKey(deviceSecret: Uint8Array, event: Event): Uint8Array | null {
  if (event.content === '') return null
  const conversation = nip44.utils.getConversationKey(deviceSecret, event.pubkey)
  return toContentKey(nip44.decrypt(event.content, conversation))
}

export async function openAdminKey(admin: Signer, event: Event): Promise<Uint8Array> {
  return toContentKey(await admin.nip44Decrypt(event.pubkey, event.content))
}
