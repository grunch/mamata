// Cómo firma el panel en este navegador: la nsec pegada (guardada acá) o una extensión
// NIP-07. Nada de esto sale del navegador.

export type SignerSetting = { mode: 'nsec'; nsec: string } | { mode: 'nip07' }

const STORAGE_KEY = 'mamata:admin:firmante'

export function loadSignerSetting(): SignerSetting | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<{ mode: string; nsec: unknown }>
    if (value.mode === 'nip07') return { mode: 'nip07' }
    if (value.mode === 'nsec' && typeof value.nsec === 'string') return { mode: 'nsec', nsec: value.nsec }
    return null
  } catch {
    return null
  }
}

export function saveSignerSetting(setting: SignerSetting): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(setting))
}

export function clearSignerSetting(): void {
  localStorage.removeItem(STORAGE_KEY)
}
