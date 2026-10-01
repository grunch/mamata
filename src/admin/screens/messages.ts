import { h } from '../../app/ui.ts'
import { formatNoted } from '../../shared/dates.ts'
import { MESSAGE_STYLES, type Message, type MessageStyle } from '../../shared/model.ts'
import type { AdminContext } from '../context.ts'
import { moveToTrash, newId, setArchived, upsert } from '../draft.ts'
import { field, fileInput, formError, selectInput, showError, smallButton, textArea, textInput } from '../forms.ts'
import { compressImage } from '../image.ts'

const STYLE_LABELS: Record<MessageStyle, string> = {
  normal: 'Normal',
  importante: 'Aviso importante',
  'buena-noticia': 'Buena noticia',
  urgente: 'Urgente',
}

// Vista previa con los mismos estilos que ve el usuario.
function preview(title: string, body: string, style: MessageStyle, emoji: string): HTMLElement {
  return h('article', { class: `message-card style-${style} preview`, attrs: { 'aria-label': 'Vista previa' } }, [
    h('p', { class: 'kind', text: STYLE_LABELS[style] }),
    emoji && h('p', { class: 'big-emoji', text: emoji }),
    h('p', { class: 'row-title', text: title || 'Título' }),
    ...body.split(/\n+/).map((line) => h('p', { class: 'body', text: line })),
  ])
}

function messageForm(ctx: AdminContext, existing: Message | null, onDone: () => void): HTMLElement {
  const title = textInput(existing?.title)
  const body = textArea(existing?.body, 5)
  const style = selectInput(
    MESSAGE_STYLES.map((s) => ({ value: s, label: STYLE_LABELS[s] })),
    existing?.style ?? 'normal',
  )
  const emoji = textInput(existing?.emoji ?? '', { maxlength: '8' })
  const image = fileInput()
  const removeImage = h('input', { attrs: { type: 'checkbox' } })
  const error = formError()
  const previewBox = h('div', {}, [preview(title.value, body.value, style.value as MessageStyle, emoji.value)])

  const refreshPreview = () =>
    previewBox.replaceChildren(preview(title.value, body.value, style.value as MessageStyle, emoji.value))
  for (const control of [title, body, style, emoji]) control.addEventListener('input', refreshPreview)

  const save = async (event: Event) => {
    event.preventDefault()
    if (!title.value.trim() || !body.value.trim()) return showError(error, 'Faltan el título o el texto.')
    let imageId = removeImage.checked ? undefined : existing?.imageId
    const file = image.files?.[0]
    if (file) {
      try {
        imageId = ctx.addImage(await compressImage(file))
      } catch {
        return showError(error, 'No se pudo usar esa imagen. Probá con otra.')
      }
    }
    const message: Message = {
      id: existing?.id ?? newId(),
      title: title.value.trim(),
      body: body.value.trim(),
      style: style.value as MessageStyle,
      createdAt: existing?.createdAt ?? ctx.now(),
      ...(emoji.value.trim() ? { emoji: emoji.value.trim() } : {}),
      ...(imageId ? { imageId } : {}),
      ...(existing?.archivedAt ? { archivedAt: existing.archivedAt } : {}),
    }
    ctx.edit(upsert(ctx.session.content, 'messages', message))
    ctx.toast('Mensaje guardado. Acordate de publicar.')
    onDone()
  }

  return h('form', { class: 'admin-form', on: { submit: (e) => void save(e) } }, [
    h('h2', { text: existing ? 'Editar mensaje' : 'Nuevo mensaje' }),
    field('Título', title),
    field('Texto', body),
    field('Estilo', style),
    field('Emoji (opcional)', emoji),
    field('Imagen (opcional)', image, 'Se achica y se cifra antes de subirla.'),
    existing?.imageId && h('label', { class: 'inline' }, [removeImage, ' Quitar la imagen actual']),
    h('h3', { text: 'Así lo va a ver' }),
    previewBox,
    error,
    h('div', { class: 'row' }, [
      h('button', { class: 'small-button primary', text: 'Guardar', attrs: { type: 'submit' } }),
      smallButton('Cancelar', onDone),
    ]),
  ])
}

export function messagesSection(ctx: AdminContext): HTMLElement {
  const container = h('section', { class: 'admin-section' })
  const now = new Date(ctx.now())

  const showList = () => {
    const messages = [...ctx.session.content.messages].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    container.replaceChildren(
      h('h2', { text: 'Mensajes' }),
      smallButton('＋ Nuevo mensaje', () => showForm(null), 'primary'),
      ...(messages.length === 0 ? [h('p', { class: 'hint', text: 'Todavía no hay mensajes.' })] : []),
      h(
        'ul',
        { class: 'admin-list' },
        messages.map((m) =>
          h('li', {}, [
            h('p', { class: 'item-title', text: [m.emoji, m.title].filter(Boolean).join(' ') }),
            h('p', {
              class: 'hint',
              text: `${STYLE_LABELS[m.style]} · ${formatNoted(new Date(m.createdAt), now)}${m.archivedAt ? ' · Archivado' : ''}`,
            }),
            h('div', { class: 'row' }, [
              smallButton('Editar', () => showForm(m)),
              smallButton(m.archivedAt ? 'Desarchivar' : 'Archivar', () =>
                ctx.edit(setArchived(ctx.session.content, m.id, m.archivedAt ? null : ctx.now())),
              ),
              smallButton('Borrar', () => {
                ctx.edit(moveToTrash(ctx.session.content, 'message', m.id, ctx.now()))
                ctx.toast('Lo mandaste a la papelera.')
              }, 'danger'),
            ]),
          ]),
        ),
      ),
    )
  }

  const showForm = (message: Message | null) => {
    container.replaceChildren(messageForm(ctx, message, ctx.rerender))
    container.querySelector('input')?.focus()
  }

  showList()
  return container
}
