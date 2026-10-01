import { describe, expect, it, vi } from 'vitest'
import type { FileChange } from '../src/admin/github.ts'
import { DATA_FILE, imageFile, openContent, publish, rotateKey, type Repo } from '../src/admin/publisher.ts'
import {
  DATA_AAD,
  DecryptError,
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  generateKey,
  imageAad,
  importKey,
  type Bytes,
} from '../src/shared/crypto.ts'
import { sampleContent } from './fixtures.ts'

const NOW = '2026-10-01T15:00:00.000Z'

// Repo en memoria: cada commit es una foto completa de los archivos de la rama.
function memoryRepo(initial: Record<string, Bytes> | null = {}) {
  const commits = new Map<string, Map<string, Bytes>>()
  let head: string | null = null
  if (initial) {
    commits.set('c0', new Map(Object.entries(initial)))
    head = 'c0'
  }
  const requestDeploy = vi.fn(async () => undefined)
  const repo: Repo = {
    headCommit: async () => head,
    readFile: async (path, ref) => commits.get(ref)?.get(path) ?? null,
    listFiles: async (dir, ref) =>
      [...(commits.get(ref)?.keys() ?? [])].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1)),
    commitFiles: async (base: string | null, files: FileChange[]) => {
      const next = new Map(base ? commits.get(base) : [])
      for (const file of files) {
        if (file.bytes) next.set(file.path, file.bytes)
        // Como GitHub: borrar algo que no existe hace fallar el commit.
        else if (!next.delete(file.path)) throw new Error(`no existe ${file.path}`)
      }
      head = `c${commits.size + 1}`
      commits.set(head, next)
      return head
    },
    requestDeploy,
  }
  return { repo, requestDeploy, files: () => (head ? commits.get(head) : undefined) ?? new Map<string, Bytes>() }
}

describe('paths on the data branch', () => {
  it('stores content at the root of the branch', () => {
    expect(DATA_FILE).toBe('data.enc')
    expect(imageFile('abc')).toBe('img/abc.enc')
  })
})

describe('openContent', () => {
  it('starts an empty document when the data branch does not exist yet', async () => {
    const key = await importKey(await generateKey())
    const { repo } = memoryRepo(null)

    const opened = await openContent(repo, key, { userName: 'Marta', adminName: 'Fer' })

    expect(opened.isNew).toBe(true)
    expect(opened.baseCommit).toBeNull()
    expect(opened.content).toMatchObject({ userName: 'Marta', adminName: 'Fer', messages: [] })
  })

  it('decrypts the published document', async () => {
    const key = await importKey(await generateKey())
    const { repo } = memoryRepo({ [DATA_FILE]: await encryptJson(key, sampleContent(), DATA_AAD) })

    const opened = await openContent(repo, key, { userName: '', adminName: '' })

    expect(opened.isNew).toBe(false)
    expect(opened.content).toEqual(sampleContent())
  })

  it('fails when the key does not match', async () => {
    const key = await importKey(await generateKey())
    const other = await importKey(await generateKey())
    const { repo } = memoryRepo({ [DATA_FILE]: await encryptJson(other, sampleContent(), DATA_AAD) })

    await expect(openContent(repo, key, { userName: '', adminName: '' })).rejects.toBeInstanceOf(DecryptError)
  })
})

describe('publish', () => {
  it('encrypts the content and new images in one commit and stamps updatedAt', async () => {
    const key = await importKey(await generateKey())
    const { repo, files } = memoryRepo()
    const images = new Map([['img1', new Uint8Array([9, 9])]])

    const result = await publish(repo, key, 'c0', sampleContent(), images, NOW)

    expect(result).toEqual({ commit: 'c2', deployRequested: true })
    const stored = await decryptJson(key, files().get(DATA_FILE)!, DATA_AAD)
    expect(stored).toMatchObject({ updatedAt: NOW, userName: 'Marta' })
    expect(Array.from(await decryptBytes(key, files().get(imageFile('img1'))!, imageAad('img1')))).toEqual([9, 9])
  })

  it('creates the data branch on the first publication and asks to deploy', async () => {
    const key = await importKey(await generateKey())
    const { repo, files, requestDeploy } = memoryRepo(null)

    const result = await publish(repo, key, null, sampleContent(), new Map(), NOW)

    expect(result.deployRequested).toBe(true)
    expect(files().has(DATA_FILE)).toBe(true)
    expect(requestDeploy).toHaveBeenCalledTimes(1)
  })

  it('keeps the commit when the deploy request fails', async () => {
    const key = await importKey(await generateKey())
    const { repo, requestDeploy } = memoryRepo()
    requestDeploy.mockRejectedValueOnce(new Error('sin permiso'))

    const result = await publish(repo, key, 'c0', sampleContent(), new Map(), NOW)

    expect(result).toEqual({ commit: 'c2', deployRequested: false })
  })

  it('skips new images that are no longer used', async () => {
    const key = await importKey(await generateKey())
    const { repo, files } = memoryRepo()
    const images = new Map([['huerfana', new Uint8Array([1])]])

    await publish(repo, key, 'c0', sampleContent(), images, NOW)

    expect(files().has(imageFile('huerfana'))).toBe(false)
  })
})

describe('rotateKey', () => {
  it('re-encrypts content and every used image with a new key and drops orphans', async () => {
    const oldEncoded = await generateKey()
    const oldKey = await importKey(oldEncoded)
    const { repo, files } = memoryRepo({
      [DATA_FILE]: await encryptJson(oldKey, sampleContent(), DATA_AAD),
      [imageFile('img1')]: await encryptBytes(oldKey, new Uint8Array([1]), imageAad('img1')),
      [imageFile('img2')]: await encryptBytes(oldKey, new Uint8Array([2]), imageAad('img2')),
      [imageFile('vieja')]: await encryptBytes(oldKey, new Uint8Array([3]), imageAad('vieja')),
      'img/.gitkeep': new Uint8Array(),
    })

    const rotated = await rotateKey(repo, oldKey, 'c0', sampleContent(), new Map(), NOW)

    expect(rotated.encodedKey).not.toBe(oldEncoded)
    const newKey = await importKey(rotated.encodedKey)
    expect(await decryptJson(newKey, files().get(DATA_FILE)!, DATA_AAD)).toMatchObject({ updatedAt: NOW })
    expect(Array.from(await decryptBytes(newKey, files().get(imageFile('img2'))!, imageAad('img2')))).toEqual([2])
    expect(files().has(imageFile('vieja'))).toBe(false)
    expect(files().has('img/.gitkeep')).toBe(true)
    expect(rotated.deployRequested).toBe(true)
    await expect(decryptJson(oldKey, files().get(DATA_FILE)!, DATA_AAD)).rejects.toBeInstanceOf(DecryptError)
  })

  it('uses pending images that were not published yet', async () => {
    const oldKey = await importKey(await generateKey())
    const { repo, files } = memoryRepo()
    const content = { ...sampleContent(), messages: [], giftCards: [{ ...sampleContent().giftCards[0]!, imageId: 'nueva' }] }

    const rotated = await rotateKey(repo, oldKey, 'c0', content, new Map([['nueva', new Uint8Array([7])]]), NOW)

    const newKey = await importKey(rotated.encodedKey)
    expect(Array.from(await decryptBytes(newKey, files().get(imageFile('nueva'))!, imageAad('nueva')))).toEqual([7])
  })
})
