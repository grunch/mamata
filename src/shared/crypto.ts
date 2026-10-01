// Cifrado del contenido publicado en el repo (AES-GCM 256, Web Crypto).
// Formato de archivo: [versión 1 byte][iv 12 bytes][texto cifrado + tag 16 bytes].
// El AAD ata cada archivo a su rol, así no se puede cambiar un archivo por otro.

export const FORMAT_VERSION = 1
export const DATA_AAD = 'mamata:v1:data'
export const imageAad = (id: string): string => `mamata:v1:img:${id}`

const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = 1 + IV_BYTES

// Web Crypto exige bytes respaldados por un ArrayBuffer común (no compartido).
export type Bytes = Uint8Array<ArrayBuffer>

export class InvalidKeyError extends Error {
  constructor(message = 'La clave no es válida') {
    super(message)
    this.name = 'InvalidKeyError'
  }
}

export class DecryptError extends Error {
  constructor(message = 'No se pudo descifrar el contenido') {
    super(message)
    this.name = 'DecryptError'
  }
}

export function toBase64Url(bytes: Bytes): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new InvalidKeyError()
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
  } catch {
    throw new InvalidKeyError()
  }
}

export async function generateKey(): Promise<string> {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(KEY_BYTES)))
}

export async function importKey(encoded: string): Promise<CryptoKey> {
  const raw = fromBase64Url(encoded)
  if (raw.length !== KEY_BYTES) throw new InvalidKeyError()
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

const encodeAad = (aad: string): Bytes => new TextEncoder().encode(aad)

export async function encryptBytes(
  key: CryptoKey,
  plain: Bytes,
  aad: string,
): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encodeAad(aad) },
    key,
    plain,
  )
  const sealed = new Uint8Array(HEADER_BYTES + cipher.byteLength)
  sealed[0] = FORMAT_VERSION
  sealed.set(iv, 1)
  sealed.set(new Uint8Array(cipher), HEADER_BYTES)
  return sealed
}

export async function decryptBytes(
  key: CryptoKey,
  sealed: Bytes,
  aad: string,
): Promise<Bytes> {
  if (sealed.length < HEADER_BYTES + TAG_BYTES) throw new DecryptError('Archivo incompleto')
  if (sealed[0] !== FORMAT_VERSION) throw new DecryptError('Versión de archivo desconocida')
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.slice(1, HEADER_BYTES), additionalData: encodeAad(aad) },
      key,
      sealed.slice(HEADER_BYTES),
    )
    return new Uint8Array(plain)
  } catch {
    throw new DecryptError()
  }
}

export async function encryptJson(key: CryptoKey, value: unknown, aad: string): Promise<Bytes> {
  return encryptBytes(key, new TextEncoder().encode(JSON.stringify(value)), aad)
}

export async function decryptJson(key: CryptoKey, sealed: Bytes, aad: string): Promise<unknown> {
  const plain = await decryptBytes(key, sealed, aad)
  return JSON.parse(new TextDecoder().decode(plain))
}
