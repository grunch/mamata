// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadVoices, pickSpanishVoice, speakButton, speakSpanish, type Synth } from '../src/app/speech.ts'

const voice = (lang: string, name = lang, localService = true) => ({ lang, name, localService }) as SpeechSynthesisVoice

// Sintetizador falso: las voces pueden "llegar tarde", como en Chrome para Android.
function fakeSynth(voices: SpeechSynthesisVoice[], { late = false } = {}) {
  let available = late ? [] : voices
  const listeners: (() => void)[] = []
  const synth = {
    getVoices: () => available,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    removeEventListener: vi.fn(),
    cancel: vi.fn(),
    speak: vi.fn(),
    arrive: () => {
      available = voices
      for (const fn of listeners) fn()
    },
  }
  return synth as typeof synth & Synth
}

class FakeUtterance {
  lang = ''
  rate = 1
  voice: SpeechSynthesisVoice | null = null
  constructor(readonly text: string) {}
}

beforeEach(() => {
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('pickSpanishVoice', () => {
  it('prefers Argentine Spanish, then Latin American, then any Spanish', () => {
    const voices = [voice('en-US'), voice('es-ES'), voice('es-US'), voice('es-AR')]

    expect(pickSpanishVoice(voices)?.lang).toBe('es-AR')
    expect(pickSpanishVoice(voices.slice(0, 3))?.lang).toBe('es-US')
    expect(pickSpanishVoice(voices.slice(0, 2))?.lang).toBe('es-ES')
  })

  it('understands Android language codes with underscores', () => {
    expect(pickSpanishVoice([voice('en_US'), voice('es_US')])?.lang).toBe('es_US')
  })

  it('prefers voices installed on the phone', () => {
    const online = voice('es-AR', 'online', false)
    const local = voice('es-AR', 'local', true)

    expect(pickSpanishVoice([online, local])?.name).toBe('local')
  })

  it('returns null when there is no Spanish voice', () => {
    expect(pickSpanishVoice([voice('en-US'), voice('pt-BR')])).toBeNull()
  })
})

describe('loadVoices', () => {
  it('waits for voices that arrive late', async () => {
    const synth = fakeSynth([voice('es-AR')], { late: true })

    const pending = loadVoices(synth)
    synth.arrive()

    expect((await pending).map((v) => v.lang)).toEqual(['es-AR'])
  })

  it('gives up after a while if no voices arrive', async () => {
    vi.useFakeTimers()
    const synth = fakeSynth([], { late: true })

    const pending = loadVoices(synth)
    await vi.advanceTimersByTimeAsync(5000)

    expect(await pending).toEqual([])
  })
})

describe('speakSpanish', () => {
  it('speaks with a Spanish voice and its language, never the default English one', async () => {
    const synth = fakeSynth([voice('en-US'), voice('es_US')], { late: true })

    const pending = speakSpanish('hola', synth)
    synth.arrive()

    expect(await pending).toBe(true)
    const utterance = synth.speak.mock.calls[0]?.[0] as unknown as FakeUtterance
    expect(utterance.text).toBe('hola')
    expect(utterance.voice?.lang).toBe('es_US')
    expect(utterance.lang).toBe('es-US')
  })

  it('does not speak when there is no Spanish voice', async () => {
    const synth = fakeSynth([voice('en-US')])

    expect(await speakSpanish('hola', synth)).toBe(false)
    expect(synth.speak).not.toHaveBeenCalled()
  })
})

describe('speakButton', () => {
  it('only shows up when the phone has a Spanish voice', async () => {
    const withSpanish = speakButton('hola', fakeSynth([voice('es-AR')]))
    const withoutSpanish = speakButton('hola', fakeSynth([voice('en-US')]))
    await vi.waitFor(() => expect(withSpanish.hidden).toBe(false))

    expect(withoutSpanish.hidden).toBe(true)
    expect(withSpanish.textContent).toContain('Leer en voz alta')
  })

  it('reads the text in Spanish when tapped', async () => {
    const synth = fakeSynth([voice('es-AR')])
    const button = speakButton('hola', synth)
    await vi.waitFor(() => expect(button.hidden).toBe(false))

    button.click()

    await vi.waitFor(() => expect(synth.speak).toHaveBeenCalledTimes(1))
  })

  it('is hidden when the browser cannot speak at all', () => {
    expect(speakButton('hola', null).hidden).toBe(true)
  })
})
