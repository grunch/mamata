import { beforeEach, describe, expect, it } from 'vitest'
import { LocalStore, deleteLocalDatabase } from '../src/app/local-store.ts'

describe('LocalStore', () => {
  beforeEach(async () => {
    await deleteLocalDatabase()
  })

  it('returns null when no key was saved', async () => {
    const store = await LocalStore.open()

    expect(await store.getKey()).toBeNull()
  })

  it('persists the key across openings', async () => {
    const first = await LocalStore.open()
    await first.setKey('clave-de-prueba')
    first.close()

    const second = await LocalStore.open()

    expect(await second.getKey()).toBe('clave-de-prueba')
  })

  it('records read messages without duplicates', async () => {
    const store = await LocalStore.open()

    await store.markRead('m1', '2026-10-01T10:00:00.000Z')
    await store.markRead('m1', '2026-10-01T11:00:00.000Z')
    await store.markRead('m2', '2026-10-01T12:00:00.000Z')

    expect(await store.readMessageIds()).toEqual(new Set(['m1', 'm2']))
  })

  it('records done reminders per occurrence', async () => {
    const store = await LocalStore.open()

    await store.markDone('r1', '2026-10-01', '2026-10-01T10:00:00.000Z')

    const done = await store.doneOccurrences()
    expect(done.has(LocalStore.doneKey('r1', '2026-10-01'))).toBe(true)
    expect(done.has(LocalStore.doneKey('r1', '2026-10-02'))).toBe(false)
  })

  it('appends balance notes and never overwrites them', async () => {
    const store = await LocalStore.open()

    await store.addBalanceNote({ cardId: 'g1', amount: 100, at: '2026-10-01T10:00:00.000Z' })
    await store.addBalanceNote({ cardId: 'g1', amount: 100, at: '2026-10-01T10:00:00.000Z' })
    await store.addBalanceNote({ cardId: 'g1', amount: 80, at: '2026-10-02T10:00:00.000Z' })

    expect(await store.balanceNotes()).toHaveLength(3)
  })

  it('keeps the last good encrypted content', async () => {
    const store = await LocalStore.open()
    const sealed = new Uint8Array([1, 2, 3])

    expect(await store.getLastGoodContent()).toBeNull()
    await store.setLastGoodContent(sealed)

    expect(Array.from((await store.getLastGoodContent()) ?? [])).toEqual([1, 2, 3])
  })

  it('stores simple preferences', async () => {
    const store = await LocalStore.open()

    expect(await store.getPref('skipBalanceExplainer')).toBe(false)
    await store.setPref('skipBalanceExplainer', true)

    expect(await store.getPref('skipBalanceExplainer')).toBe(true)
  })
})
