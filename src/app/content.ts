// Descarga y descifra lo que publicó el admin. El service worker se encarga de la
// caché (stale-while-revalidate), así que acá solo se pide el archivo.
import { DATA_AAD, DecryptError, decryptBytes, decryptJson, imageAad, type Bytes } from '../shared/crypto.ts'
import { ContentError, parseContent, type Content } from '../shared/model.ts'

export const DATA_PATH = 'data/data.enc'
export const imagePath = (id: string): string => `data/img/${id}.enc`

const IMAGE_ID = /^[A-Za-z0-9_-]+$/

export type LoadFailure = 'offline' | 'empty' | 'wrong-key' | 'invalid'

export class ContentLoadError extends Error {
  constructor(
    readonly reason: LoadFailure,
    cause?: unknown,
  ) {
    super(`No se pudo cargar el contenido: ${reason}`, { cause })
    this.name = 'ContentLoadError'
  }
}

type Fetch = (url: string) => Promise<Response>

export function keyFromHash(hash: string): string | null {
  const match = /^#k=([A-Za-z0-9_-]+)$/.exec(hash)
  return match?.[1] ?? null
}

async function fetchBytes(url: string, fetchFn: Fetch): Promise<Bytes> {
  let response: Response
  try {
    response = await fetchFn(url)
  } catch (error) {
    throw new ContentLoadError('offline', error)
  }
  if (response.status === 404) throw new ContentLoadError('empty')
  if (!response.ok) throw new ContentLoadError('offline', new Error(`HTTP ${response.status}`))
  return new Uint8Array(await response.arrayBuffer())
}

function translateDecryptError(error: unknown): never {
  if (error instanceof DecryptError) throw new ContentLoadError('wrong-key', error)
  throw error
}

export interface LoadedContent {
  content: Content
  // Los bytes cifrados, para guardar la última versión buena en el teléfono.
  sealed: Bytes
}

export async function decryptContent(key: CryptoKey, sealed: Bytes): Promise<Content> {
  const raw = await decryptJson(key, sealed, DATA_AAD).catch(translateDecryptError)
  try {
    return parseContent(raw)
  } catch (error) {
    if (error instanceof ContentError) throw new ContentLoadError('invalid', error)
    throw error
  }
}

// GitHub Pages sirve con max-age=600: sin esto el navegador podría mostrar una copia de
// hasta 10 minutos. Con no-cache pregunta si cambió (si no cambió, la respuesta es mínima).
const fetchFresh: Fetch = (u) => fetch(u, { cache: 'no-cache' })

export async function loadContent(key: CryptoKey, fetchFn: Fetch = fetchFresh): Promise<LoadedContent> {
  const sealed = await fetchBytes(DATA_PATH, fetchFn)
  return { content: await decryptContent(key, sealed), sealed }
}

export async function loadImageBytes(key: CryptoKey, id: string, fetchFn: Fetch = (u) => fetch(u)): Promise<Bytes> {
  if (!IMAGE_ID.test(id)) throw new ContentLoadError('invalid')
  const sealed = await fetchBytes(imagePath(id), fetchFn)
  return decryptBytes(key, sealed, imageAad(id)).catch(translateDecryptError)
}
