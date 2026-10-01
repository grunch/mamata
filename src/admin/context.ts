// Estado del panel admin: el borrador que se está editando y cómo publicarlo.
import type { Bytes } from '../shared/crypto.ts'
import type { Content } from '../shared/model.ts'
import type { GitHubRepo } from './github.ts'

export type Section = 'mensajes' | 'recordatorios' | 'tarjetas' | 'vincular' | 'papelera'

export const SECTIONS: { id: Section; icon: string; label: string }[] = [
  { id: 'mensajes', icon: '💌', label: 'Mensajes' },
  { id: 'recordatorios', icon: '⏰', label: 'Recordatorios' },
  { id: 'tarjetas', icon: '🎁', label: 'Tarjetas' },
  { id: 'vincular', icon: '📱', label: 'Vincular teléfono' },
  { id: 'papelera', icon: '🗑️', label: 'Papelera' },
]

export interface AdminSession {
  repo: GitHubRepo
  key: CryptoKey
  encodedKey: string
  baseCommit: string
  content: Content
  // Lo último publicado, para saber si hay cambios sin publicar.
  publishedJson: string
  // Imágenes nuevas (sin cifrar) que se suben al publicar.
  newImages: Map<string, Bytes>
}

export interface AdminContext {
  readonly session: AdminSession
  now(): string
  edit(next: Content): void
  addImage(bytes: Bytes): string
  imageUrl(id: string): Promise<string | null>
  toast(message: string): void
  rerender(): void
  rotate(): Promise<void>
  logout(): void
}

export function isDirty(session: AdminSession): boolean {
  return JSON.stringify(session.content) !== session.publishedJson
}
