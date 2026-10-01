// Quién firma: la nsec pegada en el panel (LocalSigner) o una extensión NIP-07
// (nos2x y compañía). Las dos se usan igual desde el resto del código.
import type { Event, EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import { decode } from 'nostr-tools/nip19'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { hexToBytes } from 'nostr-tools/utils'

export type { WindowNostr } from 'nostr-tools/nip07'
import type { WindowNostr } from 'nostr-tools/nip07'

export interface Signer {
  getPublicKey(): Promise<string>
  signEvent(template: EventTemplate): Promise<Event>
  nip44Encrypt(pubkey: string, plaintext: string): Promise<string>
  nip44Decrypt(pubkey: string, payload: string): Promise<string>
}

export class SignerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignerError'
  }
}

// Acepta "nsec1…" o la clave en hex (64 caracteres).
export function parseSecretKey(input: string): Uint8Array | null {
  const trimmed = input.trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return hexToBytes(trimmed.toLowerCase())
  if (!trimmed.startsWith('nsec1')) return null
  try {
    const decoded = decode(trimmed)
    return decoded.type === 'nsec' ? decoded.data : null
  } catch {
    return null
  }
}

export class LocalSigner implements Signer {
  private readonly pubkey: string

  constructor(private readonly secretKey: Uint8Array) {
    this.pubkey = getPublicKey(secretKey)
  }

  async getPublicKey(): Promise<string> {
    return this.pubkey
  }

  async signEvent(template: EventTemplate): Promise<VerifiedEvent> {
    return finalizeEvent(template, this.secretKey)
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return nip44.encrypt(plaintext, nip44.utils.getConversationKey(this.secretKey, pubkey))
  }

  async nip44Decrypt(pubkey: string, payload: string): Promise<string> {
    return nip44.decrypt(payload, nip44.utils.getConversationKey(this.secretKey, pubkey))
  }
}

export class Nip07Signer implements Signer {
  private constructor(
    private readonly nostr: WindowNostr,
    private readonly nip44Api: NonNullable<WindowNostr['nip44']>,
  ) {}

  static from(nostr: WindowNostr | undefined): Nip07Signer {
    if (!nostr) throw new SignerError('No encontré una extensión de Nostr en este navegador (por ejemplo nos2x).')
    if (!nostr.nip44) throw new SignerError('La extensión no soporta NIP-44, que hace falta para cifrar. Probá con otra.')
    return new Nip07Signer(nostr, nostr.nip44)
  }

  getPublicKey(): Promise<string> {
    return this.nostr.getPublicKey()
  }

  signEvent(template: EventTemplate): Promise<Event> {
    return this.nostr.signEvent(template)
  }

  nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return this.nip44Api.encrypt(pubkey, plaintext)
  }

  nip44Decrypt(pubkey: string, payload: string): Promise<string> {
    return this.nip44Api.decrypt(pubkey, payload)
  }
}
