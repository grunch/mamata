// Cifrado de los ítems con la clave de contenido (32 bytes), usando NIP-44 v2 con esa
// clave como conversation key: cada ítem se cifra una sola vez, sirva para cuantos
// teléfonos sirva. Las imágenes usan AES-GCM con una clave derivada (NIP-44 no admite
// textos de más de 64 KB).
import { v2 as nip44 } from 'nostr-tools/nip44'

const CONTENT_KEY_BYTES = 32
// NIP-44 admite hasta 65535 bytes; se deja margen y espacio para el resto del evento.
export const MAX_ITEM_BYTES = 60_000
const IMAGE_KEY_INFO = 'mamata:v1:imagenes'

export class ItemCryptoError extends Error {
  constructor(message = 'No se pudo descifrar el contenido') {
    super(message)
    this.name = 'ItemCryptoError'
  }
}

export function generateContentKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(CONTENT_KEY_BYTES))
}

export function sealItem(contentKey: Uint8Array, value: unknown): string {
  const text = JSON.stringify(value)
  if (new TextEncoder().encode(text).length > MAX_ITEM_BYTES) {
    throw new ItemCryptoError('El contenido es demasiado largo para publicarlo')
  }
  return nip44.encrypt(text, contentKey)
}

export function openItem(contentKey: Uint8Array, payload: string): unknown {
  try {
    return JSON.parse(nip44.decrypt(payload, contentKey))
  } catch {
    throw new ItemCryptoError()
  }
}

export async function deriveImageKey(contentKey: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new Uint8Array(contentKey), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: new TextEncoder().encode(IMAGE_KEY_INFO) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}
