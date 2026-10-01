// Abrir, publicar y rotar la clave del contenido cifrado en el repo.
import {
  DATA_AAD,
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  generateKey,
  imageAad,
  importKey,
  type Bytes,
} from '../shared/crypto.ts'
import { emptyContent, parseContent, type Content } from '../shared/model.ts'
import { referencedImageIds } from './draft.ts'
import type { FileChange, GitHubRepo } from './github.ts'

// Rutas en la rama de datos (no en main). El workflow las copia a public/data/ al publicar.
export const DATA_FILE = 'data.enc'
export const IMAGE_DIR = 'img'
export const imageFile = (id: string): string => `${IMAGE_DIR}/${id}.enc`

export type Repo = Pick<GitHubRepo, 'headCommit' | 'readFile' | 'listFiles' | 'commitFiles' | 'requestDeploy'>

export interface OpenedContent {
  content: Content
  // null: la rama de datos todavía no existe.
  baseCommit: string | null
  isNew: boolean
}

export interface Published {
  commit: string
  // false si el commit quedó pero GitHub no aceptó arrancar el despliegue.
  deployRequested: boolean
}

async function commitAndDeploy(repo: Repo, base: string | null, files: FileChange[], message: string): Promise<Published> {
  const commit = await repo.commitFiles(base, files, message)
  const deployRequested = await repo.requestDeploy().then(
    () => true,
    () => false,
  )
  return { commit, deployRequested }
}

export async function openContent(
  repo: Repo,
  key: CryptoKey,
  names: { userName: string; adminName: string },
): Promise<OpenedContent> {
  const baseCommit = await repo.headCommit()
  const sealed = baseCommit ? await repo.readFile(DATA_FILE, baseCommit) : null
  if (!sealed) return { content: emptyContent(names.userName, names.adminName), baseCommit, isNew: true }
  const content = parseContent(await decryptJson(key, sealed, DATA_AAD))
  return { content, baseCommit, isNew: false }
}

async function contentFile(key: CryptoKey, content: Content, now: string): Promise<FileChange> {
  const stamped = parseContent({ ...content, updatedAt: now })
  return { path: DATA_FILE, bytes: await encryptJson(key, stamped, DATA_AAD) }
}

// Publica el contenido y las imágenes nuevas (sin cifrar todavía) en un solo commit.
export async function publish(
  repo: Repo,
  key: CryptoKey,
  baseCommit: string | null,
  content: Content,
  newImages: Map<string, Bytes>,
  now: string,
): Promise<Published> {
  const used = referencedImageIds(content)
  const files = [await contentFile(key, content, now)]
  for (const [id, plain] of newImages) {
    if (used.has(id)) files.push({ path: imageFile(id), bytes: await encryptBytes(key, plain, imageAad(id)) })
  }
  return commitAndDeploy(repo, baseCommit, files, 'Publicar cambios desde el panel')
}

export interface RotatedKey extends Published {
  encodedKey: string
}

// Genera una clave nueva y vuelve a cifrar todo. Las imágenes que ya no se usan se borran.
export async function rotateKey(
  repo: Repo,
  oldKey: CryptoKey,
  baseCommit: string | null,
  content: Content,
  newImages: Map<string, Bytes>,
  now: string,
): Promise<RotatedKey> {
  const encodedKey = await generateKey()
  const key = await importKey(encodedKey)
  const used = referencedImageIds(content)
  const files = [await contentFile(key, content, now)]

  for (const id of used) {
    let plain = newImages.get(id)
    if (!plain && baseCommit) {
      const sealed = await repo.readFile(imageFile(id), baseCommit)
      if (!sealed) continue
      plain = await decryptBytes(oldKey, sealed, imageAad(id))
    }
    if (plain) files.push({ path: imageFile(id), bytes: await encryptBytes(key, plain, imageAad(id)) })
  }

  const existing = baseCommit ? await repo.listFiles(IMAGE_DIR, baseCommit) : []
  for (const name of existing.filter((n) => n.endsWith('.enc'))) {
    const id = name.replace(/\.enc$/, '')
    if (!used.has(id)) files.push({ path: imageFile(id), bytes: null })
  }

  const published = await commitAndDeploy(repo, baseCommit, files, 'Cambiar la clave y volver a cifrar el contenido')
  return { ...published, encodedKey }
}
