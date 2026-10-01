// Estado del panel admin y lo que las pantallas pueden hacer con él.
import type { Bytes } from '../shared/crypto.ts'
import type { Content } from '../shared/model.ts'
import type { Device } from './devices.ts'

export type Section = 'mensajes' | 'recordatorios' | 'tarjetas' | 'vincular' | 'papelera' | 'ajustes'

export const SECTIONS: { id: Section; icon: string; label: string }[] = [
  { id: 'mensajes', icon: '💌', label: 'Mensajes' },
  { id: 'recordatorios', icon: '⏰', label: 'Recordatorios' },
  { id: 'tarjetas', icon: '🎁', label: 'Tarjetas' },
  { id: 'vincular', icon: '📱', label: 'Vincular teléfono' },
  { id: 'papelera', icon: '🗑️', label: 'Papelera' },
  { id: 'ajustes', icon: '⚙️', label: 'Ajustes' },
]

export interface AdminSession {
  adminPubkey: string
  content: Content
  devices: Device[]
  publishing: boolean
  // Cambios que no llegaron a suficientes relays (se pueden reintentar).
  unpublished: number
}

export interface AdminContext {
  readonly session: AdminSession
  now(): string
  // Cada cambio se publica enseguida: solo los ítems que cambiaron.
  edit(next: Content): void
  addImage(bytes: Bytes): string
  imageUrl(id: string): Promise<string | null>
  toast(message: string): void
  rerender(): void
  approve(devicePubkey: string): Promise<void>
  revoke(devicePubkey: string): Promise<void>
  refreshDevices(): Promise<void>
  retry(): Promise<void>
  logout(): void
}
