// Link público de vinculación y código de 6 dígitos para comparar teléfono y panel.
import { decode, npubEncode } from 'nostr-tools/nip19'
import { SITE_URL } from './constants.ts'

// 6 dígitos: fácil de leer en voz alta y con pocas coincidencias casuales.
// Igual alguien podría buscar una clave con el mismo código: por eso el panel marca
// como sospechosos los pedidos que comparten código.
const CODE_MODULO = 1_000_000

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

// Una pubkey ya es aleatoria: sus primeros bytes alcanzan para un código estable.
export function pairingCode(pubkey: string): string {
  const value = Number.parseInt(pubkey.slice(0, 8), 16) % CODE_MODULO
  return String(value).padStart(6, '0')
}
