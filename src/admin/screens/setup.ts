// Entrar al panel: pegando la nsec del admin o con una extensión de Nostr (NIP-07).
import { nsecEncode } from 'nostr-tools/nip19'
import { generateSecretKey } from 'nostr-tools/pure'
import { h } from '../../app/ui.ts'
import type { Profile } from '../../shared/nostr/events.ts'
import { parseSecretKey } from '../../shared/nostr/signer.ts'
import { field, formError, showError, textInput } from '../forms.ts'
import type { SignerSetting } from '../settings.ts'

export interface SetupResult {
  setting: SignerSetting
  // Solo se usan si todavía no hay nada publicado.
  names: Profile
}

export function setupScreen(onSubmit: (result: SetupResult) => Promise<string | null>, initialError?: string): HTMLElement {
  // new-password: que el gestor de contraseñas del navegador no la ofrezca en otros sitios.
  const nsec = textInput('', { type: 'password', autocomplete: 'new-password', spellcheck: 'false' })
  const userName = textInput('', { autocomplete: 'off' })
  const adminName = textInput('', { autocomplete: 'off' })
  const error = formError()
  if (initialError) showError(error, initialError)

  // Clave nueva para Mamata: se muestra una sola vez para guardarla.
  const newKeyBox = h('div', { class: 'new-key warning', attrs: { hidden: '' } })
  const generate = () => {
    const value = nsecEncode(generateSecretKey())
    nsec.value = value
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(value)
        showError(error, 'Clave copiada. Pegala en tu gestor de contraseñas antes de seguir.')
      } catch {
        showError(error, 'No pude copiarla: seleccioná el texto y copialo a mano.')
      }
    }
    newKeyBox.replaceChildren(
      h('p', { text: 'Esta es tu clave nueva. Guardala ya en tu gestor de contraseñas: si la perdés, no vas a poder editar lo publicado.' }),
      h('p', { class: 'key-text', text: value }),
      h('button', { class: 'small-button secondary', text: 'Copiar clave', attrs: { type: 'button' }, on: { click: () => void copy() } }),
    )
    newKeyBox.hidden = false
  }

  const names = (): Profile => ({
    userName: userName.value.trim() || 'Marta',
    adminName: adminName.value.trim() || 'tu familiar',
  })

  const enter = async (setting: SignerSetting) => {
    error.hidden = true
    const problem = await onSubmit({ setting, names: names() })
    if (problem) showError(error, problem)
  }

  const submitNsec = (event: Event) => {
    event.preventDefault()
    const value = nsec.value.trim()
    if (!parseSecretKey(value)) return showError(error, 'Eso no parece una clave privada de Nostr (empieza con nsec1).')
    void enter({ mode: 'nsec', nsec: value })
  }

  return h('main', { class: 'admin-screen' }, [
    h('h1', { text: 'Panel de Mamata' }),
    h('p', { text: 'Para publicar hace falta firmar con tu clave de Nostr.' }),
    h('form', { class: 'admin-form', on: { submit: submitNsec } }, [
      field('Clave privada (nsec)', nsec, 'Se guarda solo en este navegador. Más seguro: usar una extensión (abajo).'),
      h('button', {
        class: 'small-button secondary',
        text: 'Generar una clave nueva',
        attrs: { type: 'button' },
        on: { click: generate },
      }),
      newKeyBox,
      h('button', { class: 'small-button primary', text: 'Entrar con la nsec', attrs: { type: 'submit' } }),
      h('p', { class: 'hint', text: 'O, si tenés una extensión como nos2x:' }),
      h('button', {
        class: 'small-button secondary',
        text: 'Usar extensión de Nostr',
        attrs: { type: 'button' },
        on: { click: () => void enter({ mode: 'nip07' }) },
      }),
      h('fieldset', {}, [
        h('legend', { text: 'Solo si todavía no hay nada publicado' }),
        field('Nombre de quien usa la app', userName),
        field('Tu nombre (así te nombra la app)', adminName),
      ]),
      error,
    ]),
  ])
}
