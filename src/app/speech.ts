// "Leer en voz alta" siempre en español.
// Chrome (sobre todo en Android) carga las voces tarde y, si no se elige una voz, usa la
// del sistema aunque se pida es-AR: por eso se espera a las voces y se elige una explícitamente.
import { bigButton } from './ui.ts'

export type Synth = Pick<SpeechSynthesis, 'getVoices' | 'addEventListener' | 'removeEventListener' | 'cancel' | 'speak'>

const VOICES_TIMEOUT_MS = 3000
const SPEECH_RATE = 0.9
// Orden de preferencia: Argentina, Latinoamérica, después cualquier español.
const PREFERRED = ['es-ar', 'es-419', 'es-us', 'es-mx']

// Android a veces informa "es_US" en vez de "es-US".
const normalizeLang = (lang: string): string => lang.replace(/_/g, '-')

function rank(voice: Pick<SpeechSynthesisVoice, 'lang' | 'localService'>): number {
  const lang = normalizeLang(voice.lang).toLowerCase()
  if (lang !== 'es' && !lang.startsWith('es-')) return -1
  const preferred = PREFERRED.indexOf(lang)
  const base = preferred === -1 ? PREFERRED.length : preferred
  // Entre voces del mismo idioma, mejor las instaladas en el teléfono (andan sin internet).
  return base * 2 + (voice.localService ? 0 : 1)
}

export function pickSpanishVoice<V extends Pick<SpeechSynthesisVoice, 'lang' | 'localService'>>(voices: V[]): V | null {
  const spanish = voices.filter((v) => rank(v) >= 0).sort((a, b) => rank(a) - rank(b))
  return spanish[0] ?? null
}

export function loadVoices(synth: Synth): Promise<SpeechSynthesisVoice[]> {
  const now = synth.getVoices()
  if (now.length > 0) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      synth.removeEventListener('voiceschanged', done)
      resolve(synth.getVoices())
    }
    const timer = setTimeout(done, VOICES_TIMEOUT_MS)
    synth.addEventListener('voiceschanged', done)
  })
}

// Devuelve false si el teléfono no tiene ninguna voz en español (no se lee en otro idioma).
export async function speakSpanish(text: string, synth: Synth): Promise<boolean> {
  const voice = pickSpanishVoice(await loadVoices(synth))
  if (!voice) return false
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.voice = voice
  utterance.lang = normalizeLang(voice.lang)
  utterance.rate = SPEECH_RATE
  synth.speak(utterance)
  return true
}

function browserSynth(): Synth | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
}

// El botón aparece solo si hay una voz en español: leer en inglés confunde más que no tenerlo.
export function speakButton(text: string, synth: Synth | null = browserSynth()): HTMLButtonElement {
  const button = bigButton('🔊', 'Leer en voz alta', () => {
    if (synth) void speakSpanish(text, synth)
  }, 'secondary')
  button.hidden = true
  if (synth) {
    void loadVoices(synth).then((voices) => {
      button.hidden = pickSpanishVoice(voices) === null
    })
  }
  return button
}
