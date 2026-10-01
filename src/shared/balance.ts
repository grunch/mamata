// Saldos de gift cards: lo que anota el usuario en su teléfono + lo que carga el admin.
import type { GiftCard } from './model.ts'

// Lo que anota el usuario; se guarda solo en su teléfono y nunca se pisa.
export interface BalanceNote {
  cardId: string
  amount: number
  at: string
}

export type BalanceSource = 'inicial' | 'admin' | 'usuario'

export interface BalanceEntry {
  amount: number
  at: string
  source: BalanceSource
  // Cuánto bajó desde el registro anterior (null en el primero).
  spent: number | null
}

export function balanceHistory(card: GiftCard, notes: BalanceNote[]): BalanceEntry[] {
  const entries = [
    { amount: card.initialAmount, at: card.createdAt, source: 'inicial' as const },
    ...card.adminBalances.map((b) => ({ ...b, source: 'admin' as const })),
    ...notes.filter((n) => n.cardId === card.id).map((n) => ({ amount: n.amount, at: n.at, source: 'usuario' as const })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))

  return entries.map((entry, i) => {
    const previous = entries[i - 1]
    return { ...entry, spent: previous ? previous.amount - entry.amount : null }
  })
}

export function currentBalance(card: GiftCard, notes: BalanceNote[]): BalanceEntry {
  const history = balanceHistory(card, notes)
  // Siempre hay al menos el monto inicial.
  return history[history.length - 1] as BalanceEntry
}

export function looksTooHigh(amount: number, card: GiftCard, notes: BalanceNote[]): boolean {
  return amount > currentBalance(card, notes).amount
}

// Lee montos como los escribe alguien en Argentina: "120.000", "120.000,50", "$ 99,9".
export function parseAmountInput(input: string): number | null {
  const cleaned = input.replace(/[$\s]/g, '')
  if (!/^[\d.,]+$/.test(cleaned)) return null

  let normalized: string
  if (cleaned.includes(',')) {
    if (cleaned.split(',').length > 2) return null
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, '')
  } else {
    normalized = cleaned
  }

  const value = Number(normalized)
  return Number.isFinite(value) && value >= 0 ? value : null
}

export function formatMoney(amount: number): string {
  const hasCents = !Number.isInteger(amount)
  const formatted = new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(amount)
  return `$ ${formatted}`
}
