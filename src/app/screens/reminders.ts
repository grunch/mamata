import { formatLongDate, formatTime, groupReminders, type Occurrence } from '../../shared/dates.ts'
import { markReminderDone, type AppContext } from '../context.ts'
import { LocalStore } from '../local-store.ts'
import { bigButton, h, screen } from '../ui.ts'

interface GroupOptions {
  id: string
  title: string
  showDate: boolean
  canMarkDone: boolean
}

function reminderItem(ctx: AppContext, occurrence: Occurrence, options: GroupOptions): HTMLLIElement {
  const { reminder, at, dateKey } = occurrence
  const doneKey = LocalStore.doneKey(reminder.id, dateKey)
  const isDone = ctx.state.done.has(doneKey)

  const onDone = async () => {
    await markReminderDone(ctx, doneKey, reminder.id, dateKey)
    ctx.announce('¡Listo! Lo marcaste como hecho.')
  }

  return h('li', { class: `reminder${isDone ? ' is-done' : ''}` }, [
    h('span', { class: 'reminder-icon', text: reminder.icon, attrs: { 'aria-hidden': 'true' } }),
    h('div', { class: 'reminder-text' }, [
      options.showDate && h('p', { class: 'reminder-date', text: formatLongDate(at) }),
      h('p', { class: 'time', text: formatTime(at) }),
      h('p', { class: 'row-title', text: reminder.title }),
      reminder.description && h('p', { class: 'body', text: reminder.description }),
      isDone && h('p', { class: 'done', text: '✔ Hecho' }),
      !isDone && options.canMarkDone && bigButton('✅', 'Ya lo hice', () => void onDone()),
    ]),
  ])
}

function group(ctx: AppContext, occurrences: Occurrence[], options: GroupOptions): HTMLElement | null {
  if (occurrences.length === 0) return null
  return h('section', { attrs: { 'aria-labelledby': options.id } }, [
    h('h2', { text: options.title, attrs: { id: options.id } }),
    h('ul', { class: 'plain-list' }, occurrences.map((o) => reminderItem(ctx, o, options))),
  ])
}

export function remindersScreen(ctx: AppContext): HTMLElement {
  const groups = groupReminders(ctx.state.content.reminders, ctx.now())
  const isEmpty = groups.today.length + groups.upcoming.length + groups.past.length === 0

  return screen('Recordatorios', [
    isEmpty && h('p', { class: 'empty', text: 'No hay recordatorios por ahora.' }),
    group(ctx, groups.today, { id: 'hoy', title: 'Hoy', showDate: false, canMarkDone: true }),
    group(ctx, groups.upcoming, { id: 'proximos', title: 'Próximos', showDate: true, canMarkDone: false }),
    group(ctx, groups.past, { id: 'pasados', title: 'Pasados', showDate: true, canMarkDone: true }),
  ])
}
