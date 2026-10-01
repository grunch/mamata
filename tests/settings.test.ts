// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { SITE_URL, clearSettings, linkFor, loadSettings, parseKeyInput, saveSettings } from '../src/admin/settings.ts'

const KEY = 'qC8FpiQqZ7ZqHBEfxk4sd5eZUkVjutzu078hOO6I2_Y'

describe('parseKeyInput', () => {
  it('accepts a bare key', () => {
    expect(parseKeyInput(KEY)).toBe(KEY)
  })

  it('accepts the full link', () => {
    expect(parseKeyInput(`https://mamata.live/#k=${KEY}`)).toBe(KEY)
  })

  it('ignores surrounding spaces', () => {
    expect(parseKeyInput(`  ${KEY}\n`)).toBe(KEY)
  })

  it('rejects anything else', () => {
    expect(parseKeyInput('hola')).toBeNull()
    expect(parseKeyInput('https://mamata.live/')).toBeNull()
  })
})

describe('linkFor', () => {
  it('builds the pairing link on the real domain', () => {
    expect(SITE_URL).toBe('https://mamata.live/')
    expect(linkFor(KEY)).toBe(`https://mamata.live/#k=${KEY}`)
  })
})

describe('settings storage', () => {
  beforeEach(() => localStorage.clear())

  it('returns null when nothing was saved', () => {
    expect(loadSettings()).toBeNull()
  })

  it('round-trips token and key', () => {
    saveSettings({ token: 'tkn', key: KEY })

    expect(loadSettings()).toEqual({ token: 'tkn', key: KEY })
  })

  it('ignores corrupted data', () => {
    localStorage.setItem('mamata:admin', '{roto')

    expect(loadSettings()).toBeNull()
  })

  it('forgets everything on clear', () => {
    saveSettings({ token: 'tkn', key: KEY })

    clearSettings()

    expect(loadSettings()).toBeNull()
  })
})
