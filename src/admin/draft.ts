// Ediciones del contenido en el panel admin. Funciones puras: siempre devuelven
// un Content nuevo y nunca modifican el original.
import { toBase64Url } from '../shared/crypto.ts'
import type { Content, GiftCard, Message, Reminder, TrashItem, TrashKind } from '../shared/model.ts'

const ID_BYTES = 9

export function newId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(ID_BYTES)))
}

type Collections = { messages: Message; reminders: Reminder; giftCards: GiftCard }
type CollectionKey = keyof Collections

const COLLECTION_OF: Record<TrashKind, CollectionKey> = {
  message: 'messages',
  reminder: 'reminders',
  giftCard: 'giftCards',
}

export function upsert<K extends CollectionKey>(content: Content, key: K, item: Collections[K]): Content {
  const list = content[key] as Collections[K][]
  const exists = list.some((existing) => existing.id === item.id)
  const next = exists ? list.map((existing) => (existing.id === item.id ? item : existing)) : [...list, item]
  return { ...content, [key]: next }
}

export function moveToTrash(content: Content, kind: TrashKind, id: string, now: string): Content {
  const key = COLLECTION_OF[kind]
  const list = content[key] as { id: string }[]
  const item = list.find((existing) => existing.id === id)
  if (!item) return content
  const entry = { kind, item, deletedAt: now } as TrashItem
  return {
    ...content,
    [key]: list.filter((existing) => existing.id !== id),
    trash: [...content.trash, entry],
  }
}

export function restoreFromTrash(content: Content, index: number): Content {
  const entry = content.trash[index]
  if (!entry) return content
  const withoutEntry = { ...content, trash: content.trash.filter((_, i) => i !== index) }
  switch (entry.kind) {
    case 'message':
      return upsert(withoutEntry, 'messages', entry.item)
    case 'reminder':
      return upsert(withoutEntry, 'reminders', entry.item)
    case 'giftCard':
      return upsert(withoutEntry, 'giftCards', entry.item)
  }
}

// Saca una clave opcional sin dejar `undefined` en el JSON.
function without<T extends object, K extends keyof T>(item: T, key: K): T {
  const copy = { ...item }
  delete copy[key]
  return copy
}

export function setArchived(content: Content, messageId: string, archivedAt: string | null): Content {
  return {
    ...content,
    messages: content.messages.map((m) => {
      if (m.id !== messageId) return m
      return archivedAt ? { ...m, archivedAt } : without(m, 'archivedAt')
    }),
  }
}

export function setPaused(content: Content, reminderId: string, pausedAt: string | null): Content {
  return {
    ...content,
    reminders: content.reminders.map((r) => {
      if (r.id !== reminderId) return r
      return pausedAt ? { ...r, pausedAt } : without(r, 'pausedAt')
    }),
  }
}

export function addAdminBalance(content: Content, cardId: string, amount: number, at: string): Content {
  return {
    ...content,
    giftCards: content.giftCards.map((c) =>
      c.id === cardId ? { ...c, adminBalances: [...c.adminBalances, { amount, at }] } : c,
    ),
  }
}

export function referencedImageIds(content: Content): Set<string> {
  const items = [...content.messages, ...content.giftCards, ...content.trash.map((entry) => entry.item)]
  return new Set(items.flatMap((item) => ('imageId' in item && item.imageId ? [item.imageId] : [])))
}
