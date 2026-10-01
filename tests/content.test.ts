import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContentLoadError, keyFromHash, loadContent, loadImageBytes } from '../src/app/content.ts'
import { DATA_AAD, encryptBytes, encryptJson, generateKey, imageAad, importKey } from '../src/shared/crypto.ts'
import { sampleContent } from './fixtures.ts'

type FakeFetch = (url: string) => Promise<Response>

function serve(files: Record<string, Uint8Array<ArrayBuffer>>): FakeFetch {
  return async (url) => {
    const body = files[url]
    return body ? new Response(body) : new Response('no', { status: 404 })
  }
}

const offline: FakeFetch = async () => {
  throw new TypeError('Failed to fetch')
}

describe('keyFromHash', () => {
  it('reads the key from #k=', () => {
    expect(keyFromHash('#k=abc_-123')).toBe('abc_-123')
  })

  it('ignores other hash routes', () => {
    expect(keyFromHash('#/mensajes')).toBeNull()
    expect(keyFromHash('')).toBeNull()
  })
})

describe('loadContent', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('asks the browser to revalidate instead of using a stale copy', async () => {
    const key = await importKey(await generateKey())
    const fetchSpy = vi.fn(async () => new Response('no', { status: 404 }))
    vi.stubGlobal('fetch', fetchSpy)

    await loadContent(key).catch(() => undefined)

    expect(fetchSpy).toHaveBeenCalledWith('data/data.enc', { cache: 'no-cache' })
  })

  it('downloads, decrypts and validates the content', async () => {
    const key = await importKey(await generateKey())
    const sealed = await encryptJson(key, sampleContent(), DATA_AAD)

    const loaded = await loadContent(key, serve({ 'data/data.enc': sealed }))

    expect(loaded.content).toEqual(sampleContent())
    expect(loaded.sealed).toEqual(sealed)
  })

  it('reports "empty" when nothing was published yet', async () => {
    const key = await importKey(await generateKey())

    await expect(loadContent(key, serve({}))).rejects.toMatchObject({ reason: 'empty' })
  })

  it('reports "offline" when the network fails', async () => {
    const key = await importKey(await generateKey())

    await expect(loadContent(key, offline)).rejects.toMatchObject({ reason: 'offline' })
  })

  it('reports "offline" when the server answers with an error', async () => {
    const key = await importKey(await generateKey())
    const failing: FakeFetch = async () => new Response('boom', { status: 500 })

    await expect(loadContent(key, failing)).rejects.toMatchObject({ reason: 'offline' })
  })

  it('reports "wrong-key" when the content was encrypted with another key', async () => {
    const key = await importKey(await generateKey())
    const other = await importKey(await generateKey())
    const sealed = await encryptJson(other, sampleContent(), DATA_AAD)

    await expect(loadContent(key, serve({ 'data/data.enc': sealed }))).rejects.toMatchObject({
      reason: 'wrong-key',
    })
  })

  it('reports "invalid" when the decrypted content is malformed', async () => {
    const key = await importKey(await generateKey())
    const sealed = await encryptJson(key, { schemaVersion: 1 }, DATA_AAD)

    const error = await loadContent(key, serve({ 'data/data.enc': sealed })).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ContentLoadError)
    expect(error).toMatchObject({ reason: 'invalid' })
  })
})

describe('loadImageBytes', () => {
  it('decrypts an image bound to its id', async () => {
    const key = await importKey(await generateKey())
    const pixels = new Uint8Array([1, 2, 3, 4])
    const sealed = await encryptBytes(key, pixels, imageAad('img1'))

    const bytes = await loadImageBytes(key, 'img1', serve({ 'data/img/img1.enc': sealed }))

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4])
  })

  it('rejects ids that could escape the image folder', async () => {
    const key = await importKey(await generateKey())

    await expect(loadImageBytes(key, '../data', serve({}))).rejects.toMatchObject({ reason: 'invalid' })
  })
})
