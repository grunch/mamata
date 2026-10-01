import { beforeEach, describe, expect, it } from 'vitest'
import { LocalStore, deleteLocalDatabase } from '../src/app/local-store.ts'

describe('LocalStore', () => {
  beforeEach(async () => {
    await deleteLocalDatabase()
  })

  it('keeps the admin and the phone key across openings', async () => {
    const first = await LocalStore.open()
    await first.setAdminPubkey('b'.repeat(64))
    const secret = await first.phoneSecret()
    first.close()

    const second = await LocalStore.open()

    expect(await second.getAdminPubkey()).toBe('b'.repeat(64))
    expect(Array.from(await second.phoneSecret())).toEqual(Array.from(secret))
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

  it('creates the phone key once and keeps it', async () => {
    const store = await LocalStore.open()

    const first = await store.phoneSecret()
    const again = await store.phoneSecret()

    expect(first).toHaveLength(32)
    expect(Array.from(again)).toEqual(Array.from(first))
  })

  it('remembers which admin to trust', async () => {
    const store = await LocalStore.open()

    expect(await store.getAdminPubkey()).toBeNull()
    await store.setAdminPubkey('a'.repeat(64))

    expect(await store.getAdminPubkey()).toBe('a'.repeat(64))
  })

  it('keeps one event per address, replacing the previous one', async () => {
    const store = await LocalStore.open()
    const base = { pubkey: 'p', tags: [['d', 'm1']], content: '', sig: 's' }

    await store.saveEvent({ ...base, id: '1', kind: 36000, created_at: 1 })
    await store.saveEvent({ ...base, id: '2', kind: 36000, created_at: 2 })
    await store.saveEvent({ ...base, id: '3', kind: 36001, created_at: 1 })

    expect((await store.loadEvents()).map((e) => e.id).sort()).toEqual(['2', '3'])
  })

  it('stores simple preferences', async () => {
    const store = await LocalStore.open()

    expect(await store.getPref('skipBalanceExplainer')).toBe(false)
    await store.setPref('skipBalanceExplainer', true)

    expect(await store.getPref('skipBalanceExplainer')).toBe(true)
  })
})
