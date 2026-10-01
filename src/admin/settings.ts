// Token de GitHub y clave del contenido, guardados solo en el navegador del admin.
// Nunca se mandan a otro lado que no sea la API de GitHub (el token) y nunca al repo.

export const SITE_URL = 'https://mamata.live/'
export const REPO = { owner: 'grunch', repo: 'mamata', branch: 'main' } as const

const STORAGE_KEY = 'mamata:admin'
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/

export interface AdminSettings {
  token: string
  key: string
}

// Acepta la clave sola o el link de vinculación completo.
export function parseKeyInput(input: string): string | null {
  const trimmed = input.trim()
  const fromLink = /#k=([A-Za-z0-9_-]+)$/.exec(trimmed)?.[1]
  const candidate = fromLink ?? trimmed
  return KEY_PATTERN.test(candidate) ? candidate : null
}

export function linkFor(key: string): string {
  return `${SITE_URL}#k=${key}`
}

export function loadSettings(): AdminSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<AdminSettings>
    if (typeof value.token !== 'string' || typeof value.key !== 'string') return null
    return { token: value.token, key: value.key }
  } catch {
    return null
  }
}

export function saveSettings(settings: AdminSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function clearSettings(): void {
  localStorage.removeItem(STORAGE_KEY)
}
