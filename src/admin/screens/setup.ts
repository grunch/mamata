// Primera vez en este navegador: token de GitHub + clave (o generar una nueva).
import { h } from '../../app/ui.ts'
import { generateKey } from '../../shared/crypto.ts'
import { field, formError, showError, textInput } from '../forms.ts'
import { parseKeyInput, type AdminSettings } from '../settings.ts'

const TOKEN_HELP_URL = 'https://github.com/settings/personal-access-tokens/new'

export interface SetupResult extends AdminSettings {
  userName: string
  adminName: string
}

export function setupScreen(onSubmit: (result: SetupResult) => Promise<string | null>, initialError?: string): HTMLElement {
  // new-password: que el gestor de contraseñas del navegador no lo autocomplete en otro lado.
  const token = textInput('', { type: 'password', autocomplete: 'new-password', spellcheck: 'false' })
  const key = textInput('', { spellcheck: 'false' })
  const userName = textInput('', { autocomplete: 'off' })
  const adminName = textInput('', { autocomplete: 'off' })
  const error = formError()
  if (initialError) showError(error, initialError)

  const onGenerate = async () => {
    key.value = await generateKey()
    showError(error, 'Clave nueva generada. Usala solo si todavía no publicaste nada.')
  }

  const submit = async (event: Event) => {
    event.preventDefault()
    error.hidden = true
    const parsedKey = parseKeyInput(key.value)
    if (!token.value.trim()) return showError(error, 'Falta el token de GitHub.')
    if (!parsedKey) return showError(error, 'La clave no es válida. Pegá el link de vinculación o la clave.')
    const problem = await onSubmit({
      token: token.value.trim(),
      key: parsedKey,
      userName: userName.value.trim() || 'Marta',
      adminName: adminName.value.trim() || 'tu familiar',
    })
    if (problem) showError(error, problem)
  }

  return h('main', { class: 'admin-screen' }, [
    h('h1', { text: 'Panel de Mamata' }),
    h('p', { text: 'Esto se guarda solo en este navegador.' }),
    h('form', { class: 'admin-form', on: { submit: (e) => void submit(e) } }, [
      field('Token de GitHub', token, 'Token de alcance fino, con permiso "Contents: Read and write" solo sobre grunch/mamata.'),
      h('a', { text: 'Crear un token en GitHub ↗', attrs: { href: TOKEN_HELP_URL, target: '_blank', rel: 'noopener noreferrer' } }),
      field('Clave', key, 'Pegá el link de vinculación (https://mamata.live/#k=…) o la clave sola.'),
      h('button', {
        class: 'small-button secondary',
        text: 'Es la primera vez: generar una clave nueva',
        attrs: { type: 'button' },
        on: { click: () => void onGenerate() },
      }),
      h('fieldset', {}, [
        h('legend', { text: 'Solo si todavía no hay nada publicado' }),
        field('Nombre de quien usa la app', userName),
        field('Tu nombre (así te nombra la app)', adminName),
      ]),
      error,
      h('button', { class: 'small-button primary', text: 'Entrar', attrs: { type: 'submit' } }),
    ]),
  ])
}
