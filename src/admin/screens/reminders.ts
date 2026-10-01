import { h } from '../../app/ui.ts'
import { formatLongDate, formatTime, localDateKey } from '../../shared/dates.ts'
import { REPEATS, type Reminder, type Repeat } from '../../shared/model.ts'
import type { AdminContext } from '../context.ts'
import { moveToTrash, newId, setPaused, upsert } from '../draft.ts'
import { field, formError, selectInput, showError, smallButton, textInput } from '../forms.ts'

const REPEAT_LABELS: Record<Repeat, string> = {
  once: 'Una vez',
  daily: 'Todos los días',
  weekly: 'Todas las semanas',
  monthly: 'Todos los meses',
}

// La fecha y hora se cargan en hora de Argentina (UTC-3).
function toIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const parsed = new Date(`${date}T${time}:00-03:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function reminderForm(ctx: AdminContext, existing: Reminder | null, onDone: () => void): HTMLElement {
  const start = existing ? new Date(existing.startsAt) : null
  const title = textInput(existing?.title)
  const description = textInput(existing?.description)
  const icon = textInput(existing?.icon ?? '⏰', { maxlength: '8' })
  const date = textInput(start ? localDateKey(start) : '', { type: 'date' })
  const time = textInput(start ? formatTime(start) : '09:00', { type: 'time' })
  const repeat = selectInput(
    REPEATS.map((r) => ({ value: r, label: REPEAT_LABELS[r] })),
    existing?.repeat ?? 'once',
  )
  const error = formError()

  const save = (event: Event) => {
    event.preventDefault()
    const startsAt = toIso(date.value, time.value)
    if (!title.value.trim()) return showError(error, 'Falta el título.')
    if (!startsAt) return showError(error, 'Falta la fecha o la hora.')
    const reminder: Reminder = {
      id: existing?.id ?? newId(),
      title: title.value.trim(),
      description: description.value.trim(),
      icon: icon.value.trim() || '⏰',
      startsAt,
      repeat: repeat.value as Repeat,
      createdAt: existing?.createdAt ?? ctx.now(),
      ...(existing?.pausedAt ? { pausedAt: existing.pausedAt } : {}),
    }
    ctx.edit(upsert(ctx.session.content, 'reminders', reminder))
    ctx.toast('Recordatorio guardado. Acordate de publicar.')
    onDone()
  }

  return h('form', { class: 'admin-form', on: { submit: save } }, [
    h('h2', { text: existing ? 'Editar recordatorio' : 'Nuevo recordatorio' }),
    field('Título', title),
    field('Descripción (opcional)', description),
    field('Ícono (un emoji)', icon),
    field('Fecha', date, 'Si se repite, es el primer día.'),
    field('Hora (Argentina)', time),
    field('Repetición', repeat),
    error,
    h('div', { class: 'row' }, [
      h('button', { class: 'small-button primary', text: 'Guardar', attrs: { type: 'submit' } }),
      smallButton('Cancelar', onDone),
    ]),
  ])
}

export function remindersSection(ctx: AdminContext): HTMLElement {
  const container = h('section', { class: 'admin-section' })

  const showList = () => {
    const reminders = [...ctx.session.content.reminders].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    container.replaceChildren(
      h('h2', { text: 'Recordatorios' }),
      h('p', { class: 'hint', text: 'No suenan: se ven al abrir la app. "Ya lo hice" queda solo en su teléfono.' }),
      smallButton('＋ Nuevo recordatorio', () => showForm(null), 'primary'),
      ...(reminders.length === 0 ? [h('p', { class: 'hint', text: 'Todavía no hay recordatorios.' })] : []),
      h(
        'ul',
        { class: 'admin-list' },
        reminders.map((r) => {
          const start = new Date(r.startsAt)
          return h('li', {}, [
            h('p', { class: 'item-title', text: `${r.icon} ${r.title}` }),
            h('p', {
              class: 'hint',
              text: `${REPEAT_LABELS[r.repeat]} · desde ${formatLongDate(start)} a las ${formatTime(start)}${r.pausedAt ? ' · Pausado' : ''}`,
            }),
            h('div', { class: 'row' }, [
              smallButton('Editar', () => showForm(r)),
              smallButton(r.pausedAt ? 'Reanudar' : 'Pausar', () =>
                ctx.edit(setPaused(ctx.session.content, r.id, r.pausedAt ? null : ctx.now())),
              ),
              smallButton('Borrar', () => {
                ctx.edit(moveToTrash(ctx.session.content, 'reminder', r.id, ctx.now()))
                ctx.toast('Lo mandaste a la papelera.')
              }, 'danger'),
            ]),
          ])
        }),
      ),
    )
  }

  const showForm = (reminder: Reminder | null) => {
    container.replaceChildren(reminderForm(ctx, reminder, ctx.rerender))
    container.querySelector('input')?.focus()
  }

  showList()
  return container
}
