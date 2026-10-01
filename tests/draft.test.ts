import { describe, expect, it } from 'vitest'
import {
  addAdminBalance,
  newId,
  moveToTrash,
  referencedImageIds,
  restoreFromTrash,
  setArchived,
  setPaused,
  upsert,
} from '../src/admin/draft.ts'
import { sampleContent } from './fixtures.ts'

const NOW = '2026-10-01T15:00:00.000Z'

describe('newId', () => {
  it('creates url-safe ids that work as image file names', () => {
    expect(newId()).toMatch(/^[A-Za-z0-9_-]{12}$/)
    expect(newId()).not.toBe(newId())
  })
})

describe('upsert', () => {
  it('appends a new item', () => {
    const doc = sampleContent()
    const message = { ...doc.messages[0]!, id: 'nuevo', title: 'Hola' }

    const next = upsert(doc, 'messages', message)

    expect(next.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'nuevo'])
  })

  it('replaces an existing item by id without mutating the original', () => {
    const doc = sampleContent()
    const edited = { ...doc.messages[0]!, title: 'Editado' }

    const next = upsert(doc, 'messages', edited)

    expect(next.messages[0]?.title).toBe('Editado')
    expect(doc.messages[0]?.title).not.toBe('Editado')
  })
})

describe('moveToTrash / restoreFromTrash', () => {
  it('moves an item to the trash with the deletion date', () => {
    const next = moveToTrash(sampleContent(), 'reminder', 'r1', NOW)

    expect(next.reminders).toEqual([])
    expect(next.trash).toEqual([{ kind: 'reminder', item: sampleContent().reminders[0], deletedAt: NOW }])
  })

  it('does nothing for an unknown id', () => {
    const doc = sampleContent()

    expect(moveToTrash(doc, 'giftCard', 'nope', NOW)).toEqual(doc)
  })

  it('restores an item to its collection', () => {
    const trashed = moveToTrash(sampleContent(), 'giftCard', 'g1', NOW)

    const restored = restoreFromTrash(trashed, 0)

    expect(restored.giftCards.map((c) => c.id)).toEqual(['g1'])
    expect(restored.trash).toEqual([])
  })

  it('works for messages too', () => {
    const trashed = moveToTrash(sampleContent(), 'message', 'm2', NOW)

    expect(trashed.messages.map((m) => m.id)).toEqual(['m1'])
    expect(restoreFromTrash(trashed, 0).messages.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('ignores an invalid trash index', () => {
    const doc = sampleContent()

    expect(restoreFromTrash(doc, 5)).toEqual(doc)
  })
})

describe('setArchived', () => {
  it('archives and unarchives a message', () => {
    const archived = setArchived(sampleContent(), 'm1', NOW)

    expect(archived.messages[0]?.archivedAt).toBe(NOW)
    expect(setArchived(archived, 'm1', null).messages[0]).not.toHaveProperty('archivedAt')
  })
})

describe('setPaused', () => {
  it('pauses and resumes a reminder', () => {
    const paused = setPaused(sampleContent(), 'r1', NOW)

    expect(paused.reminders[0]?.pausedAt).toBe(NOW)
    expect(setPaused(paused, 'r1', null).reminders[0]).not.toHaveProperty('pausedAt')
  })
})

describe('addAdminBalance', () => {
  it('appends a corrected balance', () => {
    const next = addAdminBalance(sampleContent(), 'g1', 90000, NOW)

    expect(next.giftCards[0]?.adminBalances.at(-1)).toEqual({ amount: 90000, at: NOW })
    expect(next.giftCards[0]?.adminBalances).toHaveLength(2)
  })
})

describe('referencedImageIds', () => {
  it('collects images from messages, cards and the trash', () => {
    const trashed = moveToTrash(sampleContent(), 'message', 'm2', NOW)

    expect(referencedImageIds(trashed)).toEqual(new Set(['img1', 'img2']))
  })
})
