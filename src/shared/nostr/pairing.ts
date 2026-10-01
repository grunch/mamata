// Link público de vinculación y código de 4 dígitos para comparar teléfono y panel.
import { decode, npubEncode } from 'nostr-tools/nip19'
import { SITE_URL } from './constants.ts'

const CODE_MODULO = 10_000

export function linkFor(adminPubkey: string): string {
  return `${SITE_URL}#npub=${npubEncode(adminPubkey)}`
}

export function adminFromHash(hash: string): string | null {
  const npub = /^#npub=(npub1[02-9ac-hj-np-z]+)$/.exec(hash)?.[1]
  if (!npub) return null
  try {
    const decoded = decode(npub)
    return decoded.type === 'npub' ? decoded.data : null
  } catch {
    return null
  }
}

// Una pubkey ya es aleatoria: sus primeros bytes alcanzan para un código corto y estable.
export function pairingCode(pubkey: string): string {
  const value = Number.parseInt(pubkey.slice(0, 8), 16) % CODE_MODULO
  return String(value).padStart(4, '0')
}
