import { describe, expect, it } from 'vitest'
import {
  DATA_AAD,
  DecryptError,
  FORMAT_VERSION,
  InvalidKeyError,
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  fromBase64Url,
  generateKey,
  imageAad,
  importKey,
  toBase64Url,
} from '../src/shared/crypto.ts'

describe('base64url', () => {
  it('round-trips arbitrary bytes without padding or url-unsafe chars', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255, 62, 63])

    const encoded = toBase64Url(bytes)

    expect(encoded).not.toMatch(/[+/=]/)
    expect(fromBase64Url(encoded)).toEqual(bytes)
  })

  it('throws InvalidKeyError on characters outside the alphabet', () => {
    expect(() => fromBase64Url('abc$')).toThrow(InvalidKeyError)
  })
})

describe('generateKey / importKey', () => {
  it('generates a 32-byte key encoded as 43 base64url chars', async () => {
    const key = await generateKey()

    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(fromBase64Url(key)).toHaveLength(32)
  })

  it('generates different keys each time', async () => {
    expect(await generateKey()).not.toBe(await generateKey())
  })

  it('rejects keys that are not 32 bytes', async () => {
    await expect(importKey(toBase64Url(new Uint8Array(16)))).rejects.toThrow(InvalidKeyError)
  })

  it('rejects empty keys', async () => {
    await expect(importKey('')).rejects.toThrow(InvalidKeyError)
  })
})

describe('encryptBytes / decryptBytes', () => {
  it('round-trips bytes with the same key and aad', async () => {
    const key = await importKey(await generateKey())
    const plain = new TextEncoder().encode('hola mamá')

    const sealed = await encryptBytes(key, plain, DATA_AAD)

    expect(await decryptBytes(key, sealed, DATA_AAD)).toEqual(plain)
  })

  it('prefixes the version byte and a 12-byte iv', async () => {
    const key = await importKey(await generateKey())
    const plain = new Uint8Array([1, 2, 3])

    const sealed = await encryptBytes(key, plain, DATA_AAD)

    expect(sealed[0]).toBe(FORMAT_VERSION)
    // version + iv + ciphertext + 16-byte GCM tag
    expect(sealed).toHaveLength(1 + 12 + plain.length + 16)
  })

  it('uses a fresh iv for every encryption', async () => {
    const key = await importKey(await generateKey())
    const plain = new Uint8Array([1, 2, 3])

    const a = await encryptBytes(key, plain, DATA_AAD)
    const b = await encryptBytes(key, plain, DATA_AAD)

    expect(a.slice(1, 13)).not.toEqual(b.slice(1, 13))
  })

  it('fails with DecryptError when the key is wrong', async () => {
    const key = await importKey(await generateKey())
    const other = await importKey(await generateKey())
    const sealed = await encryptBytes(key, new Uint8Array([1]), DATA_AAD)

    await expect(decryptBytes(other, sealed, DATA_AAD)).rejects.toThrow(DecryptError)
  })

  it('fails with DecryptError when a file is swapped for another (aad mismatch)', async () => {
    const key = await importKey(await generateKey())
    const sealed = await encryptBytes(key, new Uint8Array([1]), imageAad('a'))

    await expect(decryptBytes(key, sealed, imageAad('b'))).rejects.toThrow(DecryptError)
  })

  it('fails with DecryptError when the ciphertext was tampered with', async () => {
    const key = await importKey(await generateKey())
    const sealed = await encryptBytes(key, new Uint8Array([1, 2, 3]), DATA_AAD)
    const tampered = sealed.slice()
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff

    await expect(decryptBytes(key, tampered, DATA_AAD)).rejects.toThrow(DecryptError)
  })

  it('fails with DecryptError on an unknown format version', async () => {
    const key = await importKey(await generateKey())
    const sealed = await encryptBytes(key, new Uint8Array([1]), DATA_AAD)
    sealed[0] = 99

    await expect(decryptBytes(key, sealed, DATA_AAD)).rejects.toThrow(DecryptError)
  })

  it('fails with DecryptError when the data is too short', async () => {
    const key = await importKey(await generateKey())

    await expect(decryptBytes(key, new Uint8Array([1, 2]), DATA_AAD)).rejects.toThrow(DecryptError)
  })
})

describe('encryptJson / decryptJson', () => {
  it('round-trips a JSON value', async () => {
    const key = await importKey(await generateKey())
    const value = { nombre: 'Marta', montos: [1, 2.5], ok: true }

    const sealed = await encryptJson(key, value, DATA_AAD)

    expect(await decryptJson(key, sealed, DATA_AAD)).toEqual(value)
  })
})

describe('imageAad', () => {
  it('binds the aad to the image id', () => {
    expect(imageAad('abc')).toBe('mamata:v1:img:abc')
    expect(DATA_AAD).toBe('mamata:v1:data')
  })
})
