// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { clearSignerSetting, loadSignerSetting, saveSignerSetting } from '../src/admin/settings.ts'

describe('signer setting', () => {
  beforeEach(() => localStorage.clear())

  it('returns null when nothing was saved', () => {
    expect(loadSignerSetting()).toBeNull()
  })

  it('round-trips the nsec mode', () => {
    saveSignerSetting({ mode: 'nsec', nsec: 'nsec1abc' })

    expect(loadSignerSetting()).toEqual({ mode: 'nsec', nsec: 'nsec1abc' })
  })

  it('round-trips the extension mode', () => {
    saveSignerSetting({ mode: 'nip07' })

    expect(loadSignerSetting()).toEqual({ mode: 'nip07' })
  })

  it('ignores corrupted or unknown data', () => {
    localStorage.setItem('mamata:admin:firmante', '{roto')
    expect(loadSignerSetting()).toBeNull()

    localStorage.setItem('mamata:admin:firmante', JSON.stringify({ mode: 'otro' }))
    expect(loadSignerSetting()).toBeNull()
  })

  it('forgets everything on clear', () => {
    saveSignerSetting({ mode: 'nip07' })

    clearSignerSetting()

    expect(loadSignerSetting()).toBeNull()
  })
})
