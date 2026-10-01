// ⚙️ Ajustes: los nombres que usa la app ("¡Hola, Marta!", "Pedile a Fer…").
// Guardar publica el perfil (kind 36003) como cualquier otro cambio.
import { h } from '../../app/ui.ts'
import type { AdminContext } from '../context.ts'
import { field, formError, showError, textInput } from '../forms.ts'

const DEFAULT_ADMIN_NAME = 'tu familiar'

export function namesSection(ctx: AdminContext): HTMLElement {
  const { content } = ctx.session
  const userName = textInput(content.userName, { autocomplete: 'off' })
  const adminName = textInput(content.adminName === DEFAULT_ADMIN_NAME ? '' : content.adminName, { autocomplete: 'off' })
  const error = formError()
  const missing = !content.userName.trim()

  const save = (event: Event) => {
    event.preventDefault()
    const user = userName.value.trim()
    if (!user) return showError(error, 'Falta el nombre de quien usa la app.')
    ctx.edit({ ...ctx.session.content, userName: user, adminName: adminName.value.trim() || DEFAULT_ADMIN_NAME })
    ctx.toast('Nombres guardados.')
  }

  return h('section', { class: 'admin-section' }, [
    h('h2', { text: 'Ajustes' }),
    missing && h('p', { class: 'warning', text: 'Completá los nombres: la app los usa para saludar y para nombrarte.' }),
    h('form', { class: 'admin-form', on: { submit: save } }, [
      field('Nombre de quien usa la app', userName, 'Así la saluda: "¡Hola, Marta!".'),
      field('Tu nombre (así te nombra la app)', adminName, 'Por ejemplo: "Pedile a Fer que te habilite". Si lo dejás vacío dice "tu familiar".'),
      error,
      h('button', { class: 'small-button primary', text: 'Guardar nombres', attrs: { type: 'submit' } }),
    ]),
  ])
}
