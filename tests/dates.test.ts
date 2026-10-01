import { describe, expect, it } from 'vitest'
import {
  daysUntil,
  formatLongDate,
  formatNoted,
  formatTime,
  groupReminders,
  localDateKey,
  occurrencesBetween,
} from '../src/shared/dates.ts'
import type { Reminder } from '../src/shared/model.ts'

// Argentina es UTC-3 todo el año: 13:00Z = 10:00 en Buenos Aires.
const at = (iso: string) => new Date(iso)

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r',
    title: 'Pastilla',
    description: '',
    icon: '💊',
    startsAt: '2026-09-01T13:00:00.000Z',
    repeat: 'daily',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('formatLongDate', () => {
  it('writes the full date in Spanish with a capitalized weekday', () => {
    expect(formatLongDate(at('2026-10-01T13:00:00Z'))).toBe('Jueves 1 de octubre')
  })

  it('uses the Argentina day, not the UTC day', () => {
    // 01:00Z del 2 de octubre todavía es 1 de octubre en Buenos Aires
    expect(formatLongDate(at('2026-10-02T01:00:00Z'))).toBe('Jueves 1 de octubre')
  })
})

describe('formatTime', () => {
  it('formats 24h Argentina time', () => {
    expect(formatTime(at('2026-10-01T13:30:00Z'))).toBe('10:30')
  })
})

describe('localDateKey', () => {
  it('returns the Argentina calendar day', () => {
    expect(localDateKey(at('2026-10-02T01:00:00Z'))).toBe('2026-10-01')
  })
})

describe('formatNoted', () => {
  const now = at('2026-10-01T18:00:00Z')

  it('says "hoy" for today', () => {
    expect(formatNoted(at('2026-10-01T13:30:00Z'), now)).toBe('hoy a las 10:30')
  })

  it('says "ayer" for yesterday', () => {
    expect(formatNoted(at('2026-09-30T13:30:00Z'), now)).toBe('ayer a las 10:30')
  })

  it('writes the date for older days', () => {
    expect(formatNoted(at('2026-09-28T13:30:00Z'), now)).toBe('el 28 de septiembre a las 10:30')
  })
})

describe('daysUntil', () => {
  it('counts calendar days in Argentina until a YYYY-MM-DD date', () => {
    expect(daysUntil('2026-10-11', at('2026-10-01T23:00:00Z'))).toBe(10)
  })

  it('is zero on the same day and negative after', () => {
    expect(daysUntil('2026-10-01', at('2026-10-01T13:00:00Z'))).toBe(0)
    expect(daysUntil('2026-09-30', at('2026-10-01T13:00:00Z'))).toBe(-1)
  })
})

describe('occurrencesBetween', () => {
  const from = at('2026-10-01T03:00:00Z') // 1 oct 00:00 AR
  const to = at('2026-10-04T03:00:00Z') // 4 oct 00:00 AR

  it('returns one occurrence per day for daily reminders', () => {
    const result = occurrencesBetween(reminder(), from, to)

    expect(result.map((d) => d.toISOString())).toEqual([
      '2026-10-01T13:00:00.000Z',
      '2026-10-02T13:00:00.000Z',
      '2026-10-03T13:00:00.000Z',
    ])
  })

  it('returns the single date for "once" only when inside the range', () => {
    const once = reminder({ repeat: 'once', startsAt: '2026-10-02T15:00:00.000Z' })

    expect(occurrencesBetween(once, from, to)).toEqual([at('2026-10-02T15:00:00.000Z')])
    expect(occurrencesBetween(once, at('2026-10-03T03:00:00Z'), to)).toEqual([])
  })

  it('repeats weekly on the same weekday', () => {
    const weekly = reminder({ repeat: 'weekly', startsAt: '2026-09-03T13:00:00.000Z' }) // jueves

    const result = occurrencesBetween(weekly, at('2026-09-01T03:00:00Z'), at('2026-09-25T03:00:00Z'))

    expect(result.map(localDateKey)).toEqual(['2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24'])
  })

  it('repeats monthly and clamps to the last day of short months', () => {
    const monthly = reminder({ repeat: 'monthly', startsAt: '2026-01-31T13:00:00.000Z' })

    const result = occurrencesBetween(monthly, at('2026-01-01T03:00:00Z'), at('2026-05-01T03:00:00Z'))

    expect(result.map(localDateKey)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('never returns occurrences before the start date', () => {
    const late = reminder({ startsAt: '2026-10-03T13:00:00.000Z' })

    expect(occurrencesBetween(late, from, to).map(localDateKey)).toEqual(['2026-10-03'])
  })

  it('returns nothing for paused reminders', () => {
    const paused = reminder({ pausedAt: '2026-09-15T00:00:00.000Z' })

    expect(occurrencesBetween(paused, from, to)).toEqual([])
  })
})

describe('groupReminders', () => {
  const now = at('2026-10-01T15:00:00Z') // 1 oct 12:00 AR

  it('puts today occurrences in "today" sorted by time', () => {
    const morning = reminder({ id: 'a', startsAt: '2026-09-01T11:00:00.000Z' })
    const evening = reminder({ id: 'b', startsAt: '2026-09-01T22:00:00.000Z' })

    const groups = groupReminders([evening, morning], now)

    expect(groups.today.map((o) => o.reminder.id)).toEqual(['a', 'b'])
    expect(groups.today[0]?.dateKey).toBe('2026-10-01')
  })

  it('shows only the next occurrence of each reminder in "upcoming"', () => {
    const groups = groupReminders([reminder()], now)

    expect(groups.upcoming).toHaveLength(1)
    expect(groups.upcoming[0]?.dateKey).toBe('2026-10-02')
  })

  it('lists one-time reminders from the last week in "past", newest first', () => {
    const old = reminder({ id: 'old', repeat: 'once', startsAt: '2026-09-26T13:00:00.000Z' })
    const recent = reminder({ id: 'recent', repeat: 'once', startsAt: '2026-09-30T13:00:00.000Z' })
    const tooOld = reminder({ id: 'tooOld', repeat: 'once', startsAt: '2026-09-01T13:00:00.000Z' })

    const groups = groupReminders([old, recent, tooOld], now)

    expect(groups.past.map((o) => o.reminder.id)).toEqual(['recent', 'old'])
  })

  it('shows only the latest past occurrence of repeating reminders', () => {
    const groups = groupReminders([reminder()], now)

    expect(groups.past.map((o) => o.dateKey)).toEqual(['2026-09-30'])
  })

  it('looks ahead far enough to find a monthly reminder', () => {
    const monthly = reminder({ repeat: 'monthly', startsAt: '2026-09-20T13:00:00.000Z' })

    const groups = groupReminders([monthly], now)

    expect(groups.upcoming.map((o) => o.dateKey)).toEqual(['2026-10-20'])
  })

  it('skips paused reminders everywhere', () => {
    const groups = groupReminders([reminder({ pausedAt: '2026-09-15T00:00:00.000Z' })], now)

    expect(groups).toEqual({ today: [], upcoming: [], past: [] })
  })
})
