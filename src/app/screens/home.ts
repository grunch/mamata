import { formatLongDate, formatTime, groupReminders } from '../../shared/dates.ts'
import { unreadMessages, type AppContext } from '../context.ts'
import { LocalStore } from '../local-store.ts'
import { routeHref } from '../router.ts'
import { bigLink, h, screen } from '../ui.ts'

function newMessagesLabel(count: number): string {
  return count === 1 ? 'Tenés un mensaje nuevo' : `Tenés ${count} mensajes nuevos`
}

export function homeScreen(ctx: AppContext): HTMLElement {
  const { content, done } = ctx.state
  const now = ctx.now()
  const unread = unreadMessages(ctx.state)
  const [latest] = unread
  const todayPending = groupReminders(content.reminders, now).today.filter(
    (o) => !done.has(LocalStore.doneKey(o.reminder.id, o.dateKey)),
  )

  return screen(
    `¡Hola, ${content.userName}!`,
    [
      h('p', { class: 'today', text: formatLongDate(now) }),
      latest &&
        h('section', { class: `message-card style-${latest.style} highlight`, attrs: { 'aria-labelledby': 'aviso-nuevo' } }, [
          h('p', { class: 'badge', text: newMessagesLabel(unread.length), attrs: { id: 'aviso-nuevo' } }),
          h('h2', { text: [latest.emoji, latest.title].filter(Boolean).join(' ') }),
          bigLink('💌', 'Ver mensaje', routeHref({ name: 'message', id: latest.id })),
        ]),
      todayPending.length > 0 &&
        h('section', { class: 'today-reminders', attrs: { 'aria-labelledby': 'para-hoy' } }, [
          h('h2', { text: 'Para hoy', attrs: { id: 'para-hoy' } }),
          h(
            'ul',
            { class: 'plain-list' },
            todayPending.map((o) =>
              h('li', {}, [
                h('span', { class: 'time', text: formatTime(o.at) }),
                ` ${o.reminder.icon} ${o.reminder.title}`,
              ]),
            ),
          ),
        ]),
      h('nav', { class: 'main-menu', attrs: { 'aria-label': 'Secciones' } }, [
        bigLink('💌', unread.length > 0 ? `Mensajes (${unread.length} sin leer)` : 'Mensajes', '#/mensajes'),
        bigLink('⏰', 'Recordatorios', '#/recordatorios'),
        bigLink('🎁', 'Tarjetas de regalo', '#/tarjetas'),
      ]),
      bigLink('⚙️', 'Ajustes', '#/ajustes', 'quiet'),
    ],
    { showHome: false },
  )
}
