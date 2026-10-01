// Registro de proveedores de gift cards. No tiene datos sensibles: vive en el código.
// Para sumar un proveedor alcanza con agregar una entrada acá.
import type { GiftCard } from './model.ts'

export interface Provider {
  id: string
  name: string
  color: string
  // {codigo} se reemplaza por el código de canje de la tarjeta.
  balanceUrlTemplate: string
  balanceUrlParam: string
}

export const PROVIDERS: Record<string, Provider> = {
  ohgiftcard: {
    id: 'ohgiftcard',
    name: 'oh! Gift Card',
    color: '#471e90',
    balanceUrlTemplate: 'https://tienda.ohgiftcard.com.ar/redeem?redeemCode={codigo}',
    balanceUrlParam: 'redeemCode',
  },
}

export function balanceUrl(card: GiftCard): string | null {
  const provider = PROVIDERS[card.providerId]
  if (!provider) return null
  return provider.balanceUrlTemplate.replace('{codigo}', encodeURIComponent(card.redeemCode))
}

const REDEEM_CODE = /^\d{16}$/

// Acepta el código (con o sin espacios) o el link de consulta de saldo del proveedor.
export function parseRedeemInput(input: string): string | null {
  const trimmed = input.trim()
  const digits = trimmed.replace(/\s+/g, '')
  if (REDEEM_CODE.test(digits)) return digits

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  for (const provider of Object.values(PROVIDERS)) {
    const code = url.searchParams.get(provider.balanceUrlParam)
    if (code && REDEEM_CODE.test(code)) return code
  }
  return null
}
