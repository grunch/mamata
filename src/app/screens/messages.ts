import { formatNoted } from '../../shared/dates.ts'
import type { Message, MessageStyle } from '../../shared/model.ts'
import { markMessageRead, unreadMessages, type AppContext } from '../context.ts'
import { asyncImage, canSpeak, speak } from '../media.ts'
import { routeHref } from '../router.ts'
import { bigButton, bigLink, h, screen } from '../ui.ts'
import { notFoundScreen } from './status.ts'

const STYLE_LABEL: Record<MessageStyle, string> = {
  normal: 'Mensaje',
  importante: 'Aviso importante',
  'buena-noticia': 'Buena noticia',
  urgente: 'Urgente',
}

const newestFirst = (a: Message, b: Message) => Date.parse(b.createdAt) - Date.parse(a.createdAt)

function messageRow(ctx: AppContext, message: Message, isNew: boolean): HTMLLIElement {
  return h('li', {}, [
    h('a', { class: `message-row style-${message.style}`, attrs: { href: routeHref({ name: 'message', id: message.id }) } }, [
      isNew && h('span', { class: 'badge', text: 'Nuevo' }),
      h('span', { class: 'row-title', text: [message.emoji, message.title].filter(Boolean).join(' ') }),
      h('span', { class: 'row-date', text: `Enviado ${formatNoted(new Date(message.createdAt), ctx.now())}` }),
    ]),
  ])
}

export function messagesScreen(ctx: AppContext): HTMLElement {
  const unread = unreadMessages(ctx.state)
  const unreadIds = new Set(unread.map((m) => m.id))
  const others = ctx.state.content.messages.filter((m) => !unreadIds.has(m.id)).sort(newestFirst)

  return screen('Mensajes', [
    unread.length === 0 && others.length === 0 && h('p', { class: 'empty', text: 'Todavía no hay mensajes.' }),
    unread.length > 0 &&
      h('section', { attrs: { 'aria-labelledby': 'nuevos' } }, [
        h('h2', { text: 'Nuevos', attrs: { id: 'nuevos' } }),
        h('ul', { class: 'plain-list' }, unread.map((m) => messageRow(ctx, m, true))),
      ]),
    others.length > 0 &&
      h('section', { attrs: { 'aria-labelledby': 'anteriores' } }, [
        h('h2', { text: 'Mensajes anteriores', attrs: { id: 'anteriores' } }),
        h('ul', { class: 'plain-list' }, others.map((m) => messageRow(ctx, m, false))),
      ]),
  ])
}

export function messageScreen(ctx: AppContext, id: string): HTMLElement {
  const message = ctx.state.content.messages.find((m) => m.id === id)
  if (!message) return notFoundScreen('No encontré ese mensaje.')
  const isRead = ctx.state.reads.has(id)

  const onUnderstood = async () => {
    await markMessageRead(ctx, id)
    ctx.announce('¡Listo! Lo marcaste como leído.')
  }

  return screen(message.title, [
    h('article', { class: `message-card style-${message.style}` }, [
      h('p', { class: 'kind', text: STYLE_LABEL[message.style] }),
      message.emoji && h('p', { class: 'big-emoji', text: message.emoji, attrs: { 'aria-hidden': 'true' } }),
      ...message.body.split(/\n+/).map((line) => h('p', { class: 'body', text: line })),
      message.imageId && asyncImage(ctx, message.imageId, 'Foto del mensaje'),
      h('p', { class: 'row-date', text: `Enviado ${formatNoted(new Date(message.createdAt), ctx.now())}` }),
    ]),
    h('div', { class: 'actions' }, [
      isRead
        ? h('p', { class: 'done', text: '✔ Ya lo leíste' })
        : bigButton('✅', 'Entendido', () => void onUnderstood()),
      canSpeak() && bigButton('🔊', 'Leer en voz alta', () => speak(`${message.title}. ${message.body}`), 'secondary'),
      bigLink('💌', 'Ver todos los mensajes', '#/mensajes', 'quiet'),
    ]),
  ])
}
