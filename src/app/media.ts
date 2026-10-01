// Imágenes cifradas y lectura en voz alta.
import type { Bytes } from '../shared/crypto.ts'
import type { AppContext } from './context.ts'
import { h } from './ui.ts'

// El admin sube WebP o JPEG; se mira la firma del archivo para poner el tipo correcto.
export function sniffImageType(bytes: Bytes): string {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png'
  return 'application/octet-stream'
}

// La imagen aparece cuando termina de descifrarse; si falla, no se muestra nada roto.
export function asyncImage(ctx: AppContext, id: string, alt: string, className = 'photo'): HTMLImageElement {
  const img = h('img', { class: className, attrs: { alt, hidden: '' } })
  void ctx.imageUrl(id).then((url) => {
    if (!url) return
    img.src = url
    img.hidden = false
  })
  return img
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

const SPEECH_RATE = 0.9

export function speak(text: string): void {
  if (!canSpeak()) return
  speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'es-AR'
  utterance.rate = SPEECH_RATE
  const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('es'))
  if (voice) utterance.voice = voice
  speechSynthesis.speak(utterance)
}
