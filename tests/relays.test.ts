import type { Event, Filter } from 'nostr-tools'
import { describe, expect, it, vi } from 'vitest'
import { Relays, publishedEnough, type PoolLike } from '../src/shared/nostr/relays.ts'

const URLS = ['wss://a', 'wss://b', 'wss://c']
const event = { id: 'e1', kind: 36000, pubkey: 'p', created_at: 1, tags: [], content: '', sig: 's' } as Event

function fakePool(overrides: Partial<PoolLike> = {}): PoolLike {
  return {
    querySync: vi.fn(async () => [event]),
    subscribeMany: vi.fn(() => ({ close: vi.fn() })),
    publish: vi.fn(() => [Promise.resolve('ok'), Promise.reject(new Error('kind not allowed')), Promise.resolve('ok')]),
    destroy: vi.fn(),
    ...overrides,
  }
}

describe('Relays', () => {
  it('queries every relay with a time limit', async () => {
    const pool = fakePool()
    const filter: Filter = { kinds: [36000] }

    expect(await new Relays(pool, URLS).query(filter)).toEqual([event])
    expect(pool.querySync).toHaveBeenCalledWith(URLS, filter, { maxWait: 4000 })
  })

  it('subscribes and returns a function that closes the subscription', () => {
    const close = vi.fn()
    const pool = fakePool({ subscribeMany: vi.fn(() => ({ close })) })
    const onEvent = vi.fn()
    const onReady = vi.fn()

    const stop = new Relays(pool, URLS).subscribe({ kinds: [36000] }, onEvent, onReady)
    const params = vi.mocked(pool.subscribeMany).mock.calls[0]?.[2]
    params?.onevent?.(event)
    params?.oneose?.()
    stop()

    expect(onEvent).toHaveBeenCalledWith(event)
    expect(onReady).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })

  it('reports which relays accepted a publication and why the others did not', async () => {
    const result = await new Relays(fakePool(), URLS).publish(event)

    expect(result.ok).toEqual(['wss://a', 'wss://c'])
    expect(result.failed).toEqual([{ relay: 'wss://b', reason: 'kind not allowed' }])
    expect(publishedEnough(result)).toBe(true)
  })

  it('considers one relay not enough', () => {
    expect(publishedEnough({ ok: ['wss://a'], failed: [] })).toBe(false)
  })

  it('closes every connection', () => {
    const pool = fakePool()

    new Relays(pool, URLS).close()

    expect(pool.destroy).toHaveBeenCalled()
  })
})
