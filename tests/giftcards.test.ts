import { describe, expect, it } from 'vitest'
import {
  balanceHistory,
  currentBalance,
  formatMoney,
  looksTooHigh,
  parseAmountInput,
} from '../src/shared/balance.ts'
import { balanceUrl, parseRedeemInput, PROVIDERS } from '../src/shared/providers.ts'
import { sampleContent } from './fixtures.ts'

const card = () => {
  const [first] = sampleContent().giftCards
  if (!first) throw new Error('fixture sin tarjetas')
  return first
}

describe('providers', () => {
  it('registers oh! Gift Card', () => {
    expect(PROVIDERS.ohgiftcard?.name).toBe('oh! Gift Card')
  })

  it('builds the balance url from the redeem code', () => {
    expect(balanceUrl(card())).toBe('https://tienda.ohgiftcard.com.ar/redeem?redeemCode=0000111122223333')
  })

  it('returns null for an unknown provider', () => {
    expect(balanceUrl({ ...card(), providerId: 'otro' })).toBeNull()
  })

  it('encodes the code safely', () => {
    expect(balanceUrl({ ...card(), redeemCode: 'a&b' })).toContain('redeemCode=a%26b')
  })
})

describe('parseRedeemInput', () => {
  it('accepts a 16-digit code with spaces', () => {
    expect(parseRedeemInput('0000 1111 2222 3333')).toBe('0000111122223333')
  })

  it('extracts the code from a balance url', () => {
    expect(parseRedeemInput('https://tienda.ohgiftcard.com.ar/redeem?redeemCode=0000111122223333')).toBe(
      '0000111122223333',
    )
  })

  it('rejects anything else', () => {
    expect(parseRedeemInput('hola')).toBeNull()
    expect(parseRedeemInput('https://example.com/?x=1')).toBeNull()
  })
})

describe('parseAmountInput', () => {
  it.each([
    ['120000', 120000],
    ['120.000', 120000],
    ['$ 120.000', 120000],
    ['1.250.000', 1250000],
    ['120.000,50', 120000.5],
    ['99,9', 99.9],
    ['15.5', 15.5],
    ['0', 0],
  ])('reads %s as %d', (input, expected) => {
    expect(parseAmountInput(input)).toBe(expected)
  })

  it.each(['', 'abc', '-5', '1,2,3'])('rejects %s', (input) => {
    expect(parseAmountInput(input)).toBeNull()
  })
})

describe('formatMoney', () => {
  it('uses Argentine thousands separators without decimals for integers', () => {
    expect(formatMoney(150000)).toBe('$ 150.000')
  })

  it('shows two decimals when needed', () => {
    expect(formatMoney(99.5)).toBe('$ 99,50')
  })
})

describe('balanceHistory', () => {
  it('merges admin records and user notes oldest first', () => {
    const notes = [{ cardId: 'g1', amount: 120000, at: '2026-09-25T15:00:00.000Z' }]

    const history = balanceHistory(card(), notes)

    expect(history.map((e) => [e.amount, e.source])).toEqual([
      [200000, 'inicial'],
      [150000, 'admin'],
      [120000, 'usuario'],
    ])
  })

  it('ignores notes from other cards', () => {
    const notes = [{ cardId: 'otra', amount: 1, at: '2026-09-25T15:00:00.000Z' }]

    expect(balanceHistory(card(), notes)).toHaveLength(2)
  })

  it('computes how much was spent since the previous entry', () => {
    const notes = [{ cardId: 'g1', amount: 120000, at: '2026-09-25T15:00:00.000Z' }]

    const history = balanceHistory(card(), notes)

    expect(history.map((e) => e.spent)).toEqual([null, 50000, 30000])
  })
})

describe('currentBalance', () => {
  it('is the most recent entry', () => {
    const notes = [{ cardId: 'g1', amount: 120000, at: '2026-09-25T15:00:00.000Z' }]

    expect(currentBalance(card(), notes)).toMatchObject({ amount: 120000, source: 'usuario' })
  })

  it('falls back to the initial amount when nothing was noted', () => {
    const fresh = { ...card(), adminBalances: [] }

    expect(currentBalance(fresh, [])).toMatchObject({ amount: 200000, source: 'inicial' })
  })
})

describe('looksTooHigh', () => {
  it('flags amounts above the current balance', () => {
    expect(looksTooHigh(160000, card(), [])).toBe(true)
  })

  it('accepts amounts equal or below the current balance', () => {
    expect(looksTooHigh(150000, card(), [])).toBe(false)
    expect(looksTooHigh(10, card(), [])).toBe(false)
  })
})
