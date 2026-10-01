// Estado de la app del usuario y las únicas tres acciones que puede hacer.
// Todas agregan información en su teléfono; ninguna toca lo que cargó el admin.
import type { BalanceNote } from '../shared/balance.ts'
import type { Content } from '../shared/model.ts'
import type { LocalStore } from './local-store.ts'
import type { Route } from './router.ts'

export interface AppState {
  content: Content
  reads: Set<string>
  done: Set<string>
  notes: BalanceNote[]
  offline: boolean
}

export interface AppContext {
  readonly state: AppState
  readonly store: LocalStore
  now(): Date
  update(patch: Partial<AppState>): void
  go(route: Route): void
  imageUrl(id: string): Promise<string | null>
  announce(message: string): void
}

export async function markMessageRead(ctx: AppContext, messageId: string): Promise<void> {
  await ctx.store.markRead(messageId, ctx.now().toISOString())
  ctx.update({ reads: new Set([...ctx.state.reads, messageId]) })
}

export async function markReminderDone(ctx: AppContext, doneKey: string, reminderId: string, dateKey: string): Promise<void> {
  await ctx.store.markDone(reminderId, dateKey, ctx.now().toISOString())
  ctx.update({ done: new Set([...ctx.state.done, doneKey]) })
}

export async function noteBalance(ctx: AppContext, cardId: string, amount: number): Promise<void> {
  const note: BalanceNote = { cardId, amount, at: ctx.now().toISOString() }
  await ctx.store.addBalanceNote(note)
  ctx.update({ notes: [...ctx.state.notes, note] })
}

export function unreadMessages(state: AppState) {
  return state.content.messages
    .filter((m) => !m.archivedAt && !state.reads.has(m.id))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}
