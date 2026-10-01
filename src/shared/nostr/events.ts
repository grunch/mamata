// Eventos de ítems (mensajes, recordatorios, gift cards) y cómo se arma el Content
// que ya usan las pantallas a partir de ellos.
import type { Event, EventTemplate } from 'nostr-tools/core'
import {
  ContentError,
  SCHEMA_VERSION,
  parseGiftCard,
  parseMessage,
  parseReminder,
  type Content,
  type GiftCard,
  type Message,
  type Reminder,
  type TrashItem,
} from '../model.ts'
import { KIND } from './constants.ts'

const ENVELOPE_VERSION = 1
const SHA256_HEX = /^[0-9a-f]{64}$/

export interface Profile {
  userName: string
  adminName: string
}

interface EnvelopeExtras {
  // Si tiene fecha de borrado, el ítem está en la papelera.
  deletedAt?: string
  // Dónde está la imagen en Blossom (por hash del archivo cifrado).
  image?: { sha256: string }
}

export type ItemEnvelope =
  | ({ kind: typeof KIND.message; item: Message } & EnvelopeExtras)
  | ({ kind: typeof KIND.reminder; item: Reminder } & EnvelopeExtras)
  | ({ kind: typeof KIND.giftCard; item: GiftCard } & EnvelopeExtras)

export function itemTemplate(kind: number, d: string, content: string, createdAt: number): EventTemplate {
  return { kind, created_at: createdAt, tags: [['d', d]], content }
}

export function dTag(event: Pick<Event, 'tags'>): string {
  return event.tags.find((t) => t[0] === 'd')?.[1] ?? ''
}

// Por cada dirección (kind, autor, d) queda la versión más nueva; empate: id más bajo (NIP-01).
export function latestByAddress<E extends Event>(events: E[]): E[] {
  const latest = new Map<string, E>()
  for (const event of events) {
    const address = `${event.kind}:${event.pubkey}:${dTag(event)}`
    const current = latest.get(address)
    const isNewer =
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    if (isNewer) latest.set(address, event)
  }
  return [...latest.values()]
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContentError(path, 'tiene que ser un objeto')
  }
  return value as Record<string, unknown>
}

function parseExtras(o: Record<string, unknown>): EnvelopeExtras {
  const extras: EnvelopeExtras = {}
  if (o.deletedAt !== undefined) {
    if (typeof o.deletedAt !== 'string' || Number.isNaN(Date.parse(o.deletedAt))) {
      throw new ContentError('deletedAt', 'fecha inválida')
    }
    extras.deletedAt = o.deletedAt
  }
  if (o.image !== undefined) {
    const sha256 = asObject(o.image, 'image').sha256
    if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) throw new ContentError('image.sha256', 'hash inválido')
    extras.image = { sha256 }
  }
  return extras
}

export function parseEnvelope(kind: number, raw: unknown): ItemEnvelope {
  const o = asObject(raw, 'sobre')
  if (o.v !== ENVELOPE_VERSION) throw new ContentError('v', 'versión de sobre no soportada')
  const extras = parseExtras(o)
  switch (kind) {
    case KIND.message:
      return { kind, item: parseMessage(o.item, 'item'), ...extras }
    case KIND.reminder:
      return { kind, item: parseReminder(o.item, 'item'), ...extras }
    case KIND.giftCard:
      return { kind, item: parseGiftCard(o.item, 'item'), ...extras }
    default:
      throw new ContentError('kind', `kind ${kind} no es un ítem`)
  }
}

export function envelopeFor(entry: ItemEnvelope): Record<string, unknown> {
  const { kind: _kind, ...rest } = entry
  return { v: ENVELOPE_VERSION, ...rest }
}

export function parseProfile(raw: unknown): Profile {
  const o = asObject(raw, 'perfil')
  if (typeof o.userName !== 'string' || typeof o.adminName !== 'string') {
    throw new ContentError('perfil', 'faltan los nombres')
  }
  return { userName: o.userName, adminName: o.adminName }
}

function toTrash(entry: ItemEnvelope, deletedAt: string): TrashItem {
  switch (entry.kind) {
    case KIND.message:
      return { kind: 'message', item: entry.item, deletedAt }
    case KIND.reminder:
      return { kind: 'reminder', item: entry.item, deletedAt }
    case KIND.giftCard:
      return { kind: 'giftCard', item: entry.item, deletedAt }
  }
}

export interface BuiltContent {
  content: Content
  // imageId → sha256 del archivo cifrado en Blossom.
  images: Map<string, string>
}

export function buildContent(profile: Profile, envelopes: ItemEnvelope[], latestCreatedAt: number): BuiltContent {
  const content: Content = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date(latestCreatedAt * 1000).toISOString(),
    userName: profile.userName,
    adminName: profile.adminName,
    messages: [],
    reminders: [],
    giftCards: [],
    trash: [],
  }
  const images = new Map<string, string>()
  for (const entry of envelopes) {
    const imageId = 'imageId' in entry.item ? entry.item.imageId : undefined
    if (entry.image && imageId) images.set(imageId, entry.image.sha256)
    if (entry.deletedAt) content.trash.push(toTrash(entry, entry.deletedAt))
    else if (entry.kind === KIND.message) content.messages.push(entry.item)
    else if (entry.kind === KIND.reminder) content.reminders.push(entry.item)
    else content.giftCards.push(entry.item)
  }
  return { content, images }
}
