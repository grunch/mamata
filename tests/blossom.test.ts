import { generateSecretKey } from 'nostr-tools/pure'
import { verifyEvent } from 'nostr-tools/pure'
import { describe, expect, it, vi } from 'vitest'
import { BlossomError, downloadBlob, sha256Hex, uploadAuthTemplate, uploadBlobs } from '../src/shared/nostr/blossom.ts'
import { LocalSigner } from '../src/shared/nostr/signer.ts'

const A = 'https://a.example'
const B = 'https://b.example'

describe('sha256Hex', () => {
  it('hashes bytes as lowercase hex', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('uploadAuthTemplate', () => {
  it('authorizes uploading exactly these blobs for a short time (BUD-02)', () => {
    const template = uploadAuthTemplate(['h1', 'h2'], 1000)

    expect(template.kind).toBe(24242)
    expect(template.tags).toEqual([
      ['t', 'upload'],
      ['expiration', String(1000 + 3600)],
      ['x', 'h1'],
      ['x', 'h2'],
    ])
  })
})

describe('uploadBlobs', () => {
  it('signs once and uploads every blob to every server', async () => {
    const signer = new LocalSigner(generateSecretKey())
    const signSpy = vi.spyOn(signer, 'signEvent')
    const blobs = [new Uint8Array([1]), new Uint8Array([2, 2])]
    const calls: { url: string; auth: string; hash: string }[] = []
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      calls.push({ url, auth: headers.Authorization ?? '', hash: headers['X-SHA-256'] ?? '' })
      return Response.json({ sha256: headers['X-SHA-256'], size: 1 })
    })

    const result = await uploadBlobs(blobs, signer, [A, B], fetchFn, 1000)

    expect(signSpy).toHaveBeenCalledTimes(1)
    expect(calls.map((c) => c.url)).toEqual([`${A}/upload`, `${B}/upload`, `${A}/upload`, `${B}/upload`])
    // El header es base64 de JSON en UTF-8 (el contenido tiene acentos).
    const authBytes = Uint8Array.from(atob(calls[0]!.auth.replace(/^Nostr /, '')), (c) => c.charCodeAt(0))
    const auth = JSON.parse(new TextDecoder().decode(authBytes))
    expect(verifyEvent(auth)).toBe(true)
    expect(auth.tags.filter((t: string[]) => t[0] === 'x').map((t: string[]) => t[1])).toEqual([
      await sha256Hex(blobs[0]!),
      await sha256Hex(blobs[1]!),
    ])
    expect(result).toEqual([
      { sha256: await sha256Hex(blobs[0]!), size: 1, servers: [A, B] },
      { sha256: await sha256Hex(blobs[1]!), size: 2, servers: [A, B] },
    ])
  })

  it('is fine if at least one server keeps each blob', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      return url.startsWith(A) ? new Response('lleno', { status: 507 }) : Response.json({ sha256: headers['X-SHA-256'] })
    })

    const [stored] = await uploadBlobs([new Uint8Array([9])], new LocalSigner(generateSecretKey()), [A, B], fetchFn, 1)

    expect(stored?.servers).toEqual([B])
  })

  it('fails when no server accepts a blob or a server answers with another hash', async () => {
    const signer = new LocalSigner(generateSecretKey())
    const refuse = vi.fn(async () => new Response('no', { status: 401 }))
    const lie = vi.fn(async () => Response.json({ sha256: '0'.repeat(64) }))
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(uploadBlobs([new Uint8Array([1])], signer, [A], refuse, 1)).rejects.toBeInstanceOf(BlossomError)
    await expect(uploadBlobs([new Uint8Array([1])], signer, [A], lie, 1)).rejects.toBeInstanceOf(BlossomError)
    await expect(uploadBlobs([new Uint8Array([1])], signer, [A], offline, 1)).rejects.toBeInstanceOf(BlossomError)
  })

  it('does nothing when there is nothing to upload', async () => {
    const fetchFn = vi.fn()

    expect(await uploadBlobs([], new LocalSigner(generateSecretKey()), [A], fetchFn, 1)).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('downloadBlob', () => {
  it('returns the first copy whose hash matches, trying servers in order', async () => {
    const good = new Uint8Array([7, 7, 7])
    const hash = await sha256Hex(good)
    const fetchFn = vi.fn(async (url: string) =>
      url.startsWith(A) ? new Response(new Uint8Array([6, 6, 6])) : new Response(good),
    )

    const bytes = await downloadBlob(hash, [A, B], fetchFn)

    expect(Array.from(bytes)).toEqual([7, 7, 7])
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([`${A}/${hash}`, `${B}/${hash}`])
  })

  it('fails when no server has a valid copy', async () => {
    const fetchFn = vi.fn(async () => new Response('no', { status: 404 }))

    await expect(downloadBlob('a'.repeat(64), [A, B], fetchFn)).rejects.toBeInstanceOf(BlossomError)
  })

  it('rejects hashes that are not sha256 hex', async () => {
    await expect(downloadBlob('../x', [A], vi.fn())).rejects.toBeInstanceOf(BlossomError)
  })
})
