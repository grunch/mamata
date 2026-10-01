import { h } from '../../app/ui.ts'
import { formatNoted } from '../../shared/dates.ts'
import type { TrashItem } from '../../shared/model.ts'
import type { AdminContext } from '../context.ts'
import { restoreFromTrash } from '../draft.ts'
import { smallButton } from '../forms.ts'

const KIND_LABEL: Record<TrashItem['kind'], string> = {
  message: 'Mensaje',
  reminder: 'Recordatorio',
  giftCard: 'Tarjeta',
}

function itemTitle(entry: TrashItem): string {
  return entry.kind === 'giftCard' ? entry.item.label : entry.item.title
}

export function trashSection(ctx: AdminContext): HTMLElement {
  const now = new Date(ctx.now())
  const entries = ctx.session.content.trash
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => Date.parse(b.entry.deletedAt) - Date.parse(a.entry.deletedAt))

  return h('section', { class: 'admin-section' }, [
    h('h2', { text: 'Papelera' }),
    h('p', { class: 'hint', text: 'Lo que borrás queda acá y se puede recuperar.' }),
    entries.length === 0 && h('p', { class: 'hint', text: 'La papelera está vacía.' }),
    h(
      'ul',
      { class: 'admin-list' },
      entries.map(({ entry, index }) =>
        h('li', {}, [
          h('p', { class: 'item-title', text: itemTitle(entry) }),
          h('p', { class: 'hint', text: `${KIND_LABEL[entry.kind]} · borrado ${formatNoted(new Date(entry.deletedAt), now)}` }),
          smallButton('Recuperar', () => {
            ctx.edit(restoreFromTrash(ctx.session.content, index))
            ctx.toast('Recuperado. Acordate de publicar.')
          }),
        ]),
      ),
    ),
  ])
}
