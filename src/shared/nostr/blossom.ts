// Imágenes cifradas en servidores Blossom (BUD-01 para bajar, BUD-02 para subir).
// Los archivos se identifican por su SHA-256: al bajar se verifica, así un servidor no
// puede cambiar una imagen por otra.
import type { EventTemplate } from 'nostr-tools/core'
import type { Bytes } from '../crypto.ts'
import type { Signer } from './signer.ts'

const AUTH_KIND = 24242
const AUTH_TTL_SECONDS = 60 * 60
const SHA256_HEX = /^[0-9a-f]{64}$/

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export interface StoredBlob {
  sha256: string
  size: number
  // En qué servidores quedó guardado.
  servers: string[]
}

export class BlossomError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlossomError'
  }
}

export async function sha256Hex(bytes: Bytes): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Una sola autorización para todos los archivos de una publicación (un solo pedido al firmante).
export function uploadAuthTemplate(hashes: string[], now: number): EventTemplate {
  return {
    kind: AUTH_KIND,
    created_at: now,
    content: 'Subir imágenes de Mamata',
    tags: [['t', 'upload'], ['expiration', String(now + AUTH_TTL_SECONDS)], ...hashes.map((h) => ['x', h])],
  }
}

function base64Json(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function putBlob(server: string, blob: Bytes, sha256: string, auth: string, fetchFn: Fetch): Promise<boolean> {
  try {
    const response = await fetchFn(`${server}/upload`, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/octet-stream', 'X-SHA-256': sha256 },
      body: blob,
    })
    if (!response.ok) return false
    const descriptor = (await response.json()) as { sha256?: unknown }
    return descriptor.sha256 === sha256
  } catch {
    return false
  }
}

export async function uploadBlobs(
  blobs: Bytes[],
  signer: Signer,
  servers: string[],
  fetchFn: Fetch = (url, init) => fetch(url, init),
  now = Math.floor(Date.now() / 1000),
): Promise<StoredBlob[]> {
  if (blobs.length === 0) return []
  const hashes = await Promise.all(blobs.map(sha256Hex))
  const auth = `Nostr ${base64Json(await signer.signEvent(uploadAuthTemplate(hashes, now)))}`

  const stored: StoredBlob[] = []
  for (const [i, blob] of blobs.entries()) {
    const sha256 = hashes[i] as string
    const accepted: string[] = []
    for (const server of servers) {
      if (await putBlob(server, blob, sha256, auth, fetchFn)) accepted.push(server)
    }
    if (accepted.length === 0) throw new BlossomError('Ningún servidor de imágenes aceptó la foto. Probá de nuevo más tarde.')
    stored.push({ sha256, size: blob.length, servers: accepted })
  }
  return stored
}

export async function downloadBlob(
  sha256: string,
  servers: string[],
  fetchFn: Fetch = (url, init) => fetch(url, init),
): Promise<Bytes> {
  if (!SHA256_HEX.test(sha256)) throw new BlossomError('Identificador de imagen inválido')
  for (const server of servers) {
    try {
      const response = await fetchFn(`${server}/${sha256}`)
      if (!response.ok) continue
      const bytes = new Uint8Array(await response.arrayBuffer())
      if ((await sha256Hex(bytes)) === sha256) return bytes
    } catch {
      // Probar con el siguiente servidor.
    }
  }
  throw new BlossomError('No se pudo traer la imagen')
}
