// Fechas en hora de Argentina (UTC-3 fijo, sin horario de verano desde 2009).
// Si eso cambiara, alcanza con reemplazar toLocal/fromLocal por Intl con zona horaria.
import type { Reminder } from './model.ts'

const AR_OFFSET_MS = -3 * 60 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
const PAST_WINDOW_DAYS = 7
const LOOKAHEAD_DAYS = 40

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

// Un Date "corrido" cuyos getUTC* devuelven la hora de Argentina.
const toLocal = (date: Date): Date => new Date(date.getTime() + AR_OFFSET_MS)
const fromLocalParts = (y: number, m: number, d: number, h = 0, min = 0): Date =>
  new Date(Date.UTC(y, m, d, h, min) - AR_OFFSET_MS)

const pad = (n: number): string => String(n).padStart(2, '0')
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export function localDateKey(date: Date): string {
  const l = toLocal(date)
  return `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}`
}

export function startOfLocalDay(date: Date): Date {
  const l = toLocal(date)
  return fromLocalParts(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate())
}

export function formatLongDate(date: Date): string {
  const l = toLocal(date)
  const weekday = WEEKDAYS[l.getUTCDay()] ?? ''
  return `${capitalize(weekday)} ${l.getUTCDate()} de ${MONTHS[l.getUTCMonth()]}`
}

export function formatDayMonth(date: Date): string {
  const l = toLocal(date)
  return `${l.getUTCDate()} de ${MONTHS[l.getUTCMonth()]}`
}

export function formatTime(date: Date): string {
  const l = toLocal(date)
  return `${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}`
}

// "hoy a las 10:30", "ayer a las 10:30", "el 28 de septiembre a las 10:30"
export function formatNoted(date: Date, now: Date): string {
  const days = Math.round((startOfLocalDay(now).getTime() - startOfLocalDay(date).getTime()) / DAY_MS)
  const time = `a las ${formatTime(date)}`
  if (days === 0) return `hoy ${time}`
  if (days === 1) return `ayer ${time}`
  return `el ${formatDayMonth(date)} ${time}`
}

// Días de calendario entre hoy (Argentina) y una fecha AAAA-MM-DD.
export function daysUntil(dateKey: string, now: Date): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  const target = fromLocalParts(y ?? 0, (m ?? 1) - 1, d ?? 1)
  return Math.round((target.getTime() - startOfLocalDay(now).getTime()) / DAY_MS)
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

function fixedStepOccurrences(start: Date, step: number, from: Date, to: Date): Date[] {
  const first = Math.max(0, Math.ceil((from.getTime() - start.getTime()) / step))
  const result: Date[] = []
  for (let t = start.getTime() + first * step; t < to.getTime(); t += step) result.push(new Date(t))
  return result
}

function monthlyOccurrences(start: Date, from: Date, to: Date): Date[] {
  const s = toLocal(start)
  const f = toLocal(from)
  const monthsToFrom = (f.getUTCFullYear() - s.getUTCFullYear()) * 12 + f.getUTCMonth() - s.getUTCMonth()
  const result: Date[] = []
  for (let k = Math.max(0, monthsToFrom - 1); ; k++) {
    const year = s.getUTCFullYear() + Math.floor((s.getUTCMonth() + k) / 12)
    const month = (s.getUTCMonth() + k) % 12
    const day = Math.min(s.getUTCDate(), daysInMonth(year, month))
    const occurrence = fromLocalParts(year, month, day, s.getUTCHours(), s.getUTCMinutes())
    if (occurrence >= to) return result
    if (occurrence >= from) result.push(occurrence)
  }
}

// Ocurrencias de un recordatorio en [from, to).
export function occurrencesBetween(reminder: Reminder, from: Date, to: Date): Date[] {
  if (reminder.pausedAt) return []
  const start = new Date(reminder.startsAt)
  switch (reminder.repeat) {
    case 'once':
      return start >= from && start < to ? [start] : []
    case 'daily':
      return fixedStepOccurrences(start, DAY_MS, from, to)
    case 'weekly':
      return fixedStepOccurrences(start, WEEK_MS, from, to)
    case 'monthly':
      return monthlyOccurrences(start, from, to)
  }
}

export interface Occurrence {
  reminder: Reminder
  at: Date
  dateKey: string
}

export interface ReminderGroups {
  today: Occurrence[]
  upcoming: Occurrence[]
  past: Occurrence[]
}

const toOccurrence = (reminder: Reminder, at: Date): Occurrence => ({ reminder, at, dateKey: localDateKey(at) })
const byTime = (a: Occurrence, b: Occurrence): number => a.at.getTime() - b.at.getTime()

export function groupReminders(reminders: Reminder[], now: Date): ReminderGroups {
  const todayStart = startOfLocalDay(now)
  const tomorrowStart = new Date(todayStart.getTime() + DAY_MS)
  const horizon = new Date(tomorrowStart.getTime() + LOOKAHEAD_DAYS * DAY_MS)
  const pastStart = new Date(todayStart.getTime() - PAST_WINDOW_DAYS * DAY_MS)

  const today = reminders.flatMap((r) =>
    occurrencesBetween(r, todayStart, tomorrowStart).map((at) => toOccurrence(r, at)),
  )
  const upcoming = reminders.flatMap((r) => {
    const [next] = occurrencesBetween(r, tomorrowStart, horizon)
    return next ? [toOccurrence(r, next)] : []
  })
  const past = reminders.flatMap((r) => {
    const last = occurrencesBetween(r, pastStart, todayStart).at(-1)
    return last ? [toOccurrence(r, last)] : []
  })

  return {
    today: today.sort(byTime),
    upcoming: upcoming.sort(byTime),
    past: past.sort((a, b) => byTime(b, a)),
  }
}
